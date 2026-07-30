import {
  DryEditerComponent,
  type InferShape,
  type PropsBuilder,
} from "drycms/components/RichTextField/register-component";

const colorTextProps = (p: PropsBuilder) =>
  p({
    color: p.string().default("#e11d48"),
  });

function ColorText({
  color,
}: InferShape<ReturnType<typeof colorTextProps>>) {
  return (
    <div className="color-text" style={{ color: color || "#e11d48" }}>
      <style>{`
        .color-text {
          border-left: 3px solid currentColor;
          padding-inline-start: 0.75rem;
        }
      `}</style>
      <slot />
    </div>
  );
}

export default DryEditerComponent({
  name: "color-text",
  label: "Colored text",
  description:
    "Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.",
  type: "block",
  shadow: true,
  children: true,
  props: colorTextProps,
  component: ColorText,
});
