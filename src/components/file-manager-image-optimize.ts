const OPTIMIZED_IMAGE_MIME = "image/webp";
const OPTIMIZED_IMAGE_EXTENSION = "webp";
const OPTIMIZED_IMAGE_MAX_WIDTH = 1024;
const OPTIMIZED_IMAGE_QUALITY = 0.82;
const OPTIMIZABLE_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const OPTIMIZABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface DecodedUploadImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function canOptimizeUploadImage(file: File): boolean {
  if (OPTIMIZABLE_IMAGE_TYPES.has(file.type.toLowerCase())) return true;
  return OPTIMIZABLE_IMAGE_EXTENSIONS.has(fileExtension(file.name));
}

export function optimizedUploadName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.${OPTIMIZED_IMAGE_EXTENSION}`;
}

async function decodeImage(file: File): Promise<DecodedUploadImage> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to HTMLImageElement decoding below.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not optimize this image."));
          return;
        }
        if (blob.type !== OPTIMIZED_IMAGE_MIME) {
          reject(new Error("This browser did not return a WebP image."));
          return;
        }
        resolve(blob);
      },
      OPTIMIZED_IMAGE_MIME,
      OPTIMIZED_IMAGE_QUALITY,
    );
  });
}

export async function optimizeUploadImage(file: File): Promise<File> {
  const decoded = await decodeImage(file);
  try {
    const scale = Math.min(1, OPTIMIZED_IMAGE_MAX_WIDTH / decoded.width);
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not prepare this image.");

    context.drawImage(decoded.image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas);
    return new File([blob], optimizedUploadName(file.name), {
      type: OPTIMIZED_IMAGE_MIME,
      lastModified: file.lastModified,
    });
  } finally {
    decoded.close();
  }
}
