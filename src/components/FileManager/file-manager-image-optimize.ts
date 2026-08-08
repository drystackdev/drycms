const OPTIMIZED_IMAGE_MIME = "image/webp";
const OPTIMIZED_IMAGE_EXTENSION = "webp";
const OPTIMIZED_IMAGE_MAX_WIDTH = 1024;
export const OPTIMIZED_IMAGE_QUALITY = 0.82;
/** Bounds for the Media page's optimize-dialog quality slider - WebP below
 * ~0.6 starts showing visible blocking for a typical photo, so the range
 * stops there rather than going all the way down to 0. */
export const OPTIMIZE_QUALITY_MIN = 0.6;
export const OPTIMIZE_QUALITY_MAX = 1;
export const OPTIMIZABLE_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
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

/** Same eligibility check as `canOptimizeUploadImage`, but for a
 * `FileEntry.ext` (an already-stored file, not one about to be uploaded) -
 * used by the Media page's per-file "Optimize" dialog. */
export function canOptimizeStoredImage(ext: string | undefined): boolean {
  return !!ext && OPTIMIZABLE_IMAGE_EXTENSIONS.has(ext.toLowerCase());
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

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
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
      quality,
    );
  });
}

export interface OptimizeUploadImageOptions {
  /** @default OPTIMIZED_IMAGE_MAX_WIDTH (1024) - Magic Write's image-context
   * picker (`status/magic-write.md` decision #3) calls this with `240`
   * instead: vision API token cost scales with pixel count, not
   * quality/file size, and "recognize what's in the photo" doesn't need
   * anywhere near upload-quality resolution. */
  maxWidth?: number;
  /** @default OPTIMIZED_IMAGE_QUALITY (0.82) */
  quality?: number;
}

export async function optimizeUploadImage(file: File, options?: OptimizeUploadImageOptions): Promise<File> {
  const maxWidth = options?.maxWidth ?? OPTIMIZED_IMAGE_MAX_WIDTH;
  const quality = options?.quality ?? OPTIMIZED_IMAGE_QUALITY;
  const decoded = await decodeImage(file);
  try {
    const scale = Math.min(1, maxWidth / decoded.width);
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not prepare this image.");

    context.drawImage(decoded.image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, quality);
    return new File([blob], optimizedUploadName(file.name), {
      type: OPTIMIZED_IMAGE_MIME,
      lastModified: file.lastModified,
    });
  } finally {
    decoded.close();
  }
}

/** Reads natural pixel dimensions without keeping the decode result open -
 * used by the Media page's optimize dialog to seed its width/height inputs
 * from the stored file's real size. */
export async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const decoded = await decodeImage(file);
  decoded.close();
  return { width: decoded.width, height: decoded.height };
}

function canvasToBlobAs(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The browser could not process this image."));
        return;
      }
      resolve(blob);
    }, mime);
  });
}

export interface RenderResizedImageOptions {
  width: number;
  height: number;
  /** Omitted = re-rasterize at the new size but keep `file`'s own mime type.
   * `"webp"` re-encodes through `OPTIMIZED_IMAGE_MIME` at `quality` instead. */
  format?: "webp";
  /** Only meaningful with `format: "webp"`. @default OPTIMIZED_IMAGE_QUALITY */
  quality?: number;
}

/** Resizes (and optionally re-encodes to WebP) an already-stored image to an
 * exact width/height - unlike `optimizeUploadImage`, the caller picks the
 * target size directly instead of a max-width to scale down to. Backs the
 * Media page's per-file "Optimize" dialog, which edits a file already sitting
 * in storage rather than one about to be uploaded. */
export async function renderResizedImage(file: File, options: RenderResizedImageOptions): Promise<Blob> {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const decoded = await decodeImage(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not prepare this image.");
    context.drawImage(decoded.image, 0, 0, width, height);
    if (options.format === "webp") {
      return await canvasToBlob(canvas, options.quality ?? OPTIMIZED_IMAGE_QUALITY);
    }
    return await canvasToBlobAs(canvas, file.type || "image/png");
  } finally {
    decoded.close();
  }
}
