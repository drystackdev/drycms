import { useState } from "preact/hooks";
import { ArrowLeftIcon, ArrowRightIcon } from "../icons.js";
import { DryEditerComponent, type InferShape, type PropsBuilder } from "./register-component.js";

const SAMPLE_IMAGES = [
  "https://picsum.photos/seed/dry-carousel-1/480/280",
  "https://picsum.photos/seed/dry-carousel-2/480/280",
  "https://picsum.photos/seed/dry-carousel-3/480/280",
];

const carouselProps = (p: PropsBuilder) =>
  p({
    images: p.array(p.image()).default(SAMPLE_IMAGES),
    caption: p.string(),
  });

type CarouselProps = InferShape<ReturnType<typeof carouselProps>>;

function Carousel({ images, caption }: CarouselProps) {
  const [index, setIndex] = useState(0);
  if (!images || images.length === 0) return <div class="dry-carousel-empty">No images</div>;
  const current = Math.min(index, images.length - 1);

  return (
    <div class="dry-carousel">
      <div class="dry-carousel-viewport">
        <button
          type="button"
          class="ghost sm dry-carousel-nav"
          aria-label="Previous image"
          onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
        >
          <ArrowLeftIcon />
        </button>
        <img class="dry-carousel-image" src={images[current]} alt={caption || `Slide ${current + 1}`} />
        <button
          type="button"
          class="ghost sm dry-carousel-nav"
          aria-label="Next image"
          onClick={() => setIndex((i) => (i + 1) % images.length)}
        >
          <ArrowRightIcon />
        </button>
      </div>
      {caption ? <p class="dry-carousel-caption">{caption}</p> : null}
    </div>
  );
}

/**
 * Demo/validation component for `register-component.ts`'s builder API -
 * not yet wired into a real richtext insert flow (out of scope for now, see
 * `status/register-compoennt.md`), just proves the `p.array(p.image())`
 * ("imagelist") shape type-infers and renders correctly. Rendered directly
 * in `RichTextDemo.tsx`.
 */
export default DryEditerComponent({
  name: "carousel",
  label: "Carousel",
  type: "inline",
  props: carouselProps,
  component: Carousel,
});
