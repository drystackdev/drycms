import { useState } from "preact/hooks";
import { DryEditerComponent, type InferShape, type PropsBuilder } from "drycms/components/RichTextField/register-component";

const SAMPLE_IMAGES = [
  "https://picsum.photos/seed/site-carousel-1/480/280",
  "https://picsum.photos/seed/site-carousel-2/480/280",
  "https://picsum.photos/seed/site-carousel-3/480/280",
];

const carouselProps = (p: PropsBuilder) =>
  p({
    images: p.array(p.image()).default(SAMPLE_IMAGES),
    caption: p.string(),
  });

function Carousel({ images, caption }: InferShape<ReturnType<typeof carouselProps>>) {
  const [index, setIndex] = useState(0);
  const list = images && images.length > 0 ? images : SAMPLE_IMAGES;
  const current = Math.min(index, list.length - 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <button type="button" onClick={() => setIndex((i) => (i - 1 + list.length) % list.length)}>
          ‹
        </button>
        <img src={list[current]} alt={caption || `Slide ${current + 1}`} style={{ flex: 1, borderRadius: "0.5rem" }} />
        <button type="button" onClick={() => setIndex((i) => (i + 1) % list.length)}>
          ›
        </button>
      </div>
      {caption ? <p style={{ margin: 0, textAlign: "center" }}>{caption}</p> : null}
    </div>
  );
}

export default DryEditerComponent({
  name: "carousel",
  label: "Carousel",
  type: "inline",
  props: carouselProps,
  shadow: true,
  component: Carousel,
});
