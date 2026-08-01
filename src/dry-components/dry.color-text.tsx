import {
  DryComponent,
  type InferShape,
  type PropsBuilder,
} from "../components/RichTextField/register-component.js";
import dryCarousel from "./dry.carousel.js";

const colorTextProps = (p: PropsBuilder) =>
  p({
    color: p.string().default("#e11d48"),
  });

function ColorText({
  color,
}: InferShape<ReturnType<typeof colorTextProps>>) {
  return (
    <div className="color-text" style={{ color: color || "#e11d48" }}>
      <slot />
    </div>
  );
}

export default DryComponent({
  label: "Colored text",
  description:
    "Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.",
  type: "block",
  style: `
    .color-text {
      border-left: 3px solid currentColor;
      padding-inline-start: 0.75rem;
    }
  `,
  children: `
    <h3>Wraps nested rich text and changes its color</h3>
    <p>Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.</p>
    <p>Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.</p>
    <p>Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.</p>
  `,
  props: colorTextProps,
  component: ColorText,
  refs: [dryCarousel]
});
