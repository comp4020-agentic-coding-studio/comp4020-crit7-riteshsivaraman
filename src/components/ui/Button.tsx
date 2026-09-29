// Button (PLAN.md §4.4). Classes are the contract: `.btn` + one of
// `.btn--primary|secondary|ghost|danger|text`, optional `.btn--sm`/`.btn--block`.
// Plain Astro markup can use the classes directly; islands use this.
// `aria-disabled` keeps the button focusable (so a Tooltip can explain why)
// while swallowing clicks --- prefer it over `disabled` when there's a reason.
// Browser + SSR safe --- no environment variables.
import type { ButtonHTMLAttributes, ComponentChildren } from "preact";
import { forwardRef } from "preact/compat";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "text";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "icon"> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  block?: boolean;
  /** leading icon element, e.g. <IconPlus/> */
  icon?: ComponentChildren;
  type?: "button" | "submit" | "reset";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", block, icon, type = "button", class: cls, className, children, onClick, ...rest },
  ref,
) {
  const softDisabled = rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  return (
    <button
      ref={ref}
      type={type}
      class={["btn", `btn--${variant}`, size === "sm" && "btn--sm", block && "btn--block", cls, className].filter(Boolean).join(" ")}
      onClick={(e) => {
        if (softDisabled) { e.preventDefault(); return; }
        onClick?.(e);
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
