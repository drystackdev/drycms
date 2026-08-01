import { useState } from "preact/hooks";
import {
  DryComponent,
  type InferShape,
  type PropsBuilder,
} from "../components/RichTextField/register-component.js";
import css from "./Carousel/style.css?raw";


const SAMPLE_IMAGES = [
  "https://picsum.photos/seed/site-carousel-1/480/280",
  "https://picsum.photos/seed/site-carousel-2/480/280",
  "https://picsum.photos/seed/site-carousel-3/480/280",
];
const carouselProps = (p: PropsBuilder) =>
  p({
    images: p.images().default(SAMPLE_IMAGES),
    caption: p.string(),
  });

function Carousel({
  images,
  caption,
}: InferShape<ReturnType<typeof carouselProps>>) {
  const [index, setIndex] = useState(0);
  const list = images && images.length > 0 ? images : SAMPLE_IMAGES;
  const current = Math.min(index, list.length - 1);

  return (
    <div className="carousel">
      <div className="carousel__content">
        <button
          type="button"
          onClick={() => setIndex((i) => (i - 1 + list.length) % list.length)}
        >
          ‹
        </button>

        <img src={list[current]} alt={caption || `Slide ${current + 1}`} />

        <button
          type="button"
          style={{ right: 1 }}
          onClick={() => setIndex((i) => (i + 1) % list.length)}
        >
          ›
        </button>
      </div>

      {caption ? <p className="carousel__caption">{caption}</p> : null}
    </div>
  );
}

export default DryComponent({
  label: "Carousel",
  description:
    "An inline image carousel with prev/next controls and an optional caption.",
  type: "inline",
  props: carouselProps,
  style: css,
  component: Carousel,
});
