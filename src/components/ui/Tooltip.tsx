// Tooltip: short plain-text hint on hover (400ms delay) or keyboard focus
// (immediate); Esc hides it. Wraps ONE element child and adds
// aria-describedby to it, so the hint is also its accessible description.
// For a disabled control with a reason ("Plans go up to 6 years"), give the
// Button `aria-disabled` instead of `disabled` so keyboard users can reach
// it; natively disabled children still get hover via the host.
// Not for rich content: that's a Popover (CourseDetail).
// Browser + SSR safe --- no environment variables.
import { cloneElement, isValidElement, type ComponentChildren, type VNode } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { computePosition, type Side } from "./position";

export interface TooltipProps {
  content: string;
  children: VNode<any>;
  side?: Side;
  /** hover delay in ms */
  delay?: number;
}

export function Tooltip({ content, children, side = "top", delay = 400 }: TooltipProps) {
  const id = useId();
  const hostRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);

  const show = (now: boolean) => {
    window.clearTimeout(timer.current);
    if (now) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    const host = hostRef.current;
    if (!open || !tip || !host) return;
    const target = (host.firstElementChild as HTMLElement | null) ?? host;
    const p = computePosition(target.getBoundingClientRect(), { width: tip.offsetWidth, height: tip.offsetHeight }, `${side}-center`, window.innerWidth, window.innerHeight);
    tip.style.top = `${p.top}px`;
    tip.style.left = `${p.left}px`;
  }, [open, content, side]);

  const child: ComponentChildren = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": [(children.props as { "aria-describedby"?: string })["aria-describedby"], id].filter(Boolean).join(" "),
      })
    : children;

  return (
    <span
      ref={hostRef}
      class="tooltip-host"
      onPointerEnter={(e) => { if (e.pointerType === "mouse") show(false); }}
      onPointerLeave={hide}
      onFocusIn={(e) => { if ((e.target as HTMLElement).matches(":focus-visible")) show(true); }}
      onFocusOut={hide}
    >
      {child}
      {/* The description must exist in the DOM for aria-describedby even when
          hidden, so it's always rendered; only the visible bubble portals. */}
      <span id={id} class="visually-hidden">{content}</span>
      {open && typeof document !== "undefined" &&
        createPortal(<div ref={tipRef} class="tooltip" role="tooltip" aria-hidden="true">{content}</div>, document.body)}
    </span>
  );
}
