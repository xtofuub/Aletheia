import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-signal bg-signal text-graphite-950 hover:bg-signal-strong focus-visible:outline-signal",
  secondary:
    "border-border-strong bg-surface-raised text-text-primary hover:bg-surface-hover focus-visible:outline-signal",
  ghost:
    "border-transparent bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:outline-signal",
  danger:
    "border-danger/50 bg-danger/10 text-danger-strong hover:bg-danger/15 focus-visible:outline-danger",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  icon: "size-9 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "secondary",
      size = "md",
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-control border font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 outline-none active:translate-y-px disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = "Button";
