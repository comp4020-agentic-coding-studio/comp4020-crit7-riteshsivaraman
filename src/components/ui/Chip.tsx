// Chip: small labelled token. `.chip` + tone `.chip--gold|danger|warn|info|outline`,
// `.chip--lg` for 24px. Pass `onClick` to get a <button class="chip"> (e.g. the
// problems chip); otherwise it's a <span>. Colour is never the only signal:
// pair danger/warn with their icon (IconError / IconWarn).
// Browser + SSR safe --- no environment variables.
import type { ButtonHTMLAttributes, ComponentChildren, HTMLAttributes, Ref } from "preact";
import { forwardRef } from "preact/compat";

export type ChipTone = "neutral" | "gold" | "danger" | "warn" | "info" | "outline";

export interface ChipProps extends Omit<HTMLAttributes<HTMLElement>, "size" | "icon"> {
  tone?: ChipTone;
  size?: "sm" | "lg";
  icon?: ComponentChildren;
  /** render the text in the code face (course codes: `COMP1100`) */
  code?: boolean;
  children?: ComponentChildren;
}

export const Chip = forwardRef<HTMLElement, ChipProps>(function Chip(
  { tone = "neutral", size = "sm", icon, code, class: cls, className, children, onClick, ...rest },
  ref,
) {
  const classes = ["chip", tone !== "neutral" && `chip--${tone}`, size === "lg" && "chip--lg", cls, className].filter(Boolean).join(" ");
  const body = (
    <>
      {icon}
      {code ? <span class="code">{children}</span> : children}
    </>
  );
  if (onClick) {
    return (
      <button ref={ref as Ref<HTMLButtonElement>} type="button" class={classes} onClick={onClick} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
        {body}
      </button>
    );
  }
  return <span ref={ref as Ref<HTMLSpanElement>} class={classes} {...(rest as HTMLAttributes<HTMLSpanElement>)}>{body}</span>;
});
