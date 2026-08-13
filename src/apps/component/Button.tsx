import { cva, type VariantProps } from "@component/lib/cva";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium shadow-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3",
        lg: "h-10 rounded-md px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps extends VariantProps<typeof buttonVariants> {
  label: string;
  /** Renders as a link (`<a href={href}>`) instead of a `<button>` - for
   * navigation, e.g. a "Back to home" link. Omit for an action that
   * doesn't navigate anywhere. */
  href?: string;
}

export default function Button({ label, variant, size, href }: ButtonProps) {
  const classes = buttonVariants({ variant, size });
  if (href) {
    return (
      <a href={href} class={classes}>
        {label}
      </a>
    );
  }
  return (
    <button type="button" class={classes}>
      {label}
    </button>
  );
}

export const defaultProps: ButtonProps = { label: "Button", variant: "default", size: "default" };
