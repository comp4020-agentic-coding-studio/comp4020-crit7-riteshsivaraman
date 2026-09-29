// Popover / Sheet primitive (PLAN.md §4.4, §4.5, §4.7).
//
// <Popover> floats next to an anchor (flips above when there's no room below,
// clamps to the viewport, follows scroll/resize/content size) and becomes a
// bottom <Sheet> at <= 640px. <Sheet> is always a bottom sheet (graph side
// panel on mobile). Both portal to <body>, so a parent's overflow never clips
// them.
//
// Behaviour the consumer gets for free:
//   - Esc closes the topmost open surface (reason "escape").
//   - Pointer-down outside panel AND anchor closes it ("outside"); the scrim
//     does the same in sheet mode. Dragging the sheet handle down closes it
//     ("dismiss").
//   - Focus: on open moves to `initialFocus`; Tab loops inside the panel, or
//     closes it when `closeOnTab` ("tab"). On close, focus returns to the
//     anchor (or `returnFocus`, or whatever was focused at open) --- unless
//     the user already moved focus somewhere else on purpose.
// The consumer owns `open`; onClose only reports why it should close.
// Browser code --- no environment variables, no server imports.
import type { ComponentChildren, PointerEventHandler, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { computePosition, type Placement } from "./position";

export type CloseReason = "escape" | "outside" | "tab" | "dismiss";

interface SurfaceProps {
  open: boolean;
  onClose(reason: CloseReason): void;
  children: ComponentChildren;
  /** accessible name (or use labelledBy) */
  label?: string;
  labelledBy?: string;
  id?: string;
  /** "dialog" (default) for interactive content; "none" for a hover card
   *  that is the anchor's aria-describedby target (CourseDetail). Sheet mode
   *  is always a modal dialog. */
  role?: "dialog" | "none";
  /** where focus goes on open. Default "first" focusable (else the panel). */
  initialFocus?: RefObject<HTMLElement> | "first" | "panel" | "none";
  /** false: never move focus on close. A ref: return there instead of the anchor. */
  returnFocus?: boolean | RefObject<HTMLElement>;
  /** Tab / Shift+Tab closes (combobox search) instead of looping. */
  closeOnTab?: boolean;
  class?: string;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
}

export interface PopoverProps extends SurfaceProps {
  anchor: RefObject<HTMLElement>;
  placement?: Placement;
  /** px, or "anchor" to match the anchor's width. Default: content width. */
  width?: number | "anchor";
  /** "auto" (default): bottom sheet at <= 640px. "never": always float. */
  sheet?: "auto" | "never";
}

export type SheetProps = SurfaceProps;

const SHEET_QUERY = "(max-width: 640px)";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open surfaces, newest last: only the topmost reacts to Esc / outside clicks.
const stack: object[] = [];

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Keep the surface mounted through its leave animation. */
function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    else if (mounted) {
      const t = setTimeout(() => setMounted(false), 400); // fallback if animationend never fires
      return () => clearTimeout(t);
    }
  }, [open, mounted]);
  const onAnimationEnd = (e: AnimationEvent) => {
    if (!open && e.target === e.currentTarget) setMounted(false);
  };
  return { present: open || mounted, state: open ? "open" : "closed", onAnimationEnd };
}

const focusables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert") && el.getClientRects().length > 0);

function Surface(props: SurfaceProps & { mode: "popover" | "sheet"; anchor?: RefObject<HTMLElement>; placement?: Placement; width?: number | "anchor" }) {
  const { open, onClose, mode, anchor, children } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const token = useRef({}).current;
  const { present, state, onAnimationEnd } = usePresence(open);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpen = useRef(false);

  // --- open/close focus management -------------------------------------
  useEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      openerRef.current = document.activeElement as HTMLElement | null;
      stack.push(token);
      const panel = panelRef.current;
      const f = props.initialFocus ?? "first";
      if (panel && f !== "none") {
        const target = f === "panel" ? panel : f === "first" ? (focusables(panel)[0] ?? panel) : (f.current ?? panel);
        target.focus({ preventScroll: true });
      }
    } else if (!open && wasOpen.current) {
      wasOpen.current = false;
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      if (props.returnFocus !== false) {
        const active = document.activeElement;
        const panel = panelRef.current;
        const focusIsOurs = !active || active === document.body || (panel?.contains(active) ?? false);
        const target =
          typeof props.returnFocus === "object" ? props.returnFocus.current : (anchor?.current ?? openerRef.current);
        if (focusIsOurs && target?.isConnected) target.focus({ preventScroll: true });
      }
    }
  }, [open]);

  useEffect(() => () => {
    const i = stack.indexOf(token);
    if (i >= 0) stack.splice(i, 1);
  }, []);

  // --- Esc + outside pointer ------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const isTop = () => stack[stack.length - 1] === token;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTop()) {
        e.stopPropagation();
        onCloseRef.current("escape");
      }
    };
    const onDown = (e: PointerEvent) => {
      if (mode === "sheet" || !isTop()) return; // the scrim handles sheets
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.current?.contains(t)) return;
      onCloseRef.current("outside");
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, mode]);

  // --- anchored positioning (popover mode) ---------------------------------
  useLayoutEffect(() => {
    if (!present || mode !== "popover" || !anchor) return;
    const panel = panelRef.current;
    if (!panel) return;
    let frame = 0;
    const update = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      if (props.width === "anchor") panel.style.width = `${a.width}px`;
      else if (typeof props.width === "number") panel.style.width = `${props.width}px`;
      const chrome = panel.offsetHeight - panel.clientHeight;
      const natural = panel.scrollHeight + chrome;
      const p = computePosition(a, { width: panel.offsetWidth, height: natural }, props.placement ?? "bottom-start", window.innerWidth, window.innerHeight);
      panel.style.top = `${p.top}px`;
      panel.style.left = `${p.left}px`;
      panel.style.setProperty("--popover-max-h", `${p.maxHeight}px`);
      panel.dataset.side = p.side;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const ro = new ResizeObserver(schedule);
    ro.observe(panel);
    for (const child of Array.from(panel.children)) ro.observe(child);
    if (anchor.current) ro.observe(anchor.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      ro.disconnect();
    };
  }, [present, mode, props.width, props.placement]);

  // --- sheet: lock page scroll ---------------------------------------------
  useEffect(() => {
    if (!open || mode !== "sheet") return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { html.style.overflow = prev; };
  }, [open, mode]);

  // --- sheet: drag the handle down to dismiss ------------------------------
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const onHandleDown = (e: PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panelRef.current?.setAttribute("data-dragging", "");
  };
  const onHandleMove = (e: PointerEvent) => {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    panelRef.current?.style.setProperty("--sheet-drag", `${drag.current.dy}px`);
  };
  const onHandleUp = () => {
    const d = drag.current;
    drag.current = null;
    const panel = panelRef.current;
    panel?.removeAttribute("data-dragging");
    panel?.style.removeProperty("--sheet-drag");
    if (d && d.dy > 80) onCloseRef.current("dismiss");
  };

  // --- Tab: loop, or close --------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    if (props.closeOnTab) {
      e.preventDefault();
      onCloseRef.current("tab");
      return;
    }
    const items = focusables(panel);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!present || typeof document === "undefined") return null;

  const isSheet = mode === "sheet";
  const role: "dialog" | undefined = isSheet || props.role !== "none" ? "dialog" : undefined;
  const common = {
    ref: panelRef,
    id: props.id,
    role,
    "aria-modal": isSheet ? true : undefined,
    "aria-label": props.label,
    "aria-labelledby": props.labelledBy,
    tabIndex: -1,
    "data-state": state,
    onKeyDown,
    onAnimationEnd,
    onPointerEnter: props.onPointerEnter,
    onPointerLeave: props.onPointerLeave,
  };

  return createPortal(
    isSheet ? (
      <>
        <div class="scrim" data-state={state} onClick={() => onCloseRef.current("outside")} aria-hidden="true" />
        <div {...common} class={["sheet", props.class].filter(Boolean).join(" ")}>
          <div class="sheet__handle" aria-hidden="true" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} />
          <div class="sheet__content">{children}</div>
        </div>
      </>
    ) : (
      <div {...common} class={["popover", props.class].filter(Boolean).join(" ")} data-side="bottom">
        {children}
      </div>
    ),
    document.body,
  );
}

export function Popover({ sheet = "auto", ...props }: PopoverProps) {
  const small = useMedia(SHEET_QUERY);
  return <Surface {...props} mode={sheet === "auto" && small ? "sheet" : "popover"} />;
}

export function Sheet(props: SheetProps) {
  return <Surface {...props} mode="sheet" />;
}
