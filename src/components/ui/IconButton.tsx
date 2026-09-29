// IconButton: square, icon-only, always labelled. `.icon-btn` (32px) or
// `.icon-btn--sm` (24px, card remove "×"); `.icon-btn--raised` for floating
// canvas controls; `.icon-btn--danger` for destructive hover. On touch the
// hit area grows to 44 x 44 without changing the drawn size.
// Browser + SSR safe --- no environment variables.
import type { ButtonHTMLAttributes, ComponentChildren } from "preact";
import { forwardRef } from "preact/compat";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "label" | "icon"> {
  /** accessible name, required: an icon alone has none */
  label: string;
  icon: ComponentChildren;
  size?: "sm" | "md";
  tone?: "default" | "raised" | "danger";
  type?: "button" | "submit";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", tone = "default", type = "button", class: cls, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      class={["icon-btn", size === "sm" && "icon-btn--sm", tone !== "default" && `icon-btn--${tone}`, cls, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {icon}
    </button>
  );
});
