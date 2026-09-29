// SegmentedControl (ViewToggle, PLAN.md §4.4): role="tablist", one tab per
// option, roving tabindex, arrow keys / Home / End move AND select
// (automatic activation). The white indicator slides between options
// (--d-base); before hydration the selected tab paints itself, so SSR looks
// the same. Give each option `controls` = the id of the panel it shows.
// Browser + SSR safe --- no environment variables.
import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: ComponentChildren;
  /** id of the tabpanel this option shows */
  controls?: string;
}

export interface SegmentedControlProps<V extends string> {
  label: string;
  options: readonly SegmentOption<NoInfer<V>>[];
  value: V;
  onChange(value: NoInfer<V>): void;
  class?: string;
}

export function SegmentedControl<V extends string>({ label, options, value, onChange, class: cls }: SegmentedControlProps<V>) {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [box, setBox] = useState({ x: 0, w: 0 });

  useLayoutEffect(() => {
    const list = listRef.current;
    const measure = () => {
      const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!el) return;
      setBox({ x: el.offsetLeft, w: el.offsetWidth });
      setReady(true);
    };
    measure();
    if (!list) return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [value]);

  const select = (i: number) => {
    const next = options[(i + options.length) % options.length];
    onChange(next.value);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${base}-${next.value}`)}`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") select(i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") select(i - 1);
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(options.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      class={["segmented", cls].filter(Boolean).join(" ")}
      data-ready={ready ? "" : undefined}
      style={{ "--seg-x": `${box.x}px`, "--seg-w": `${box.w}px` }}
      onKeyDown={onKeyDown}
    >
      <span class="segmented__indicator" aria-hidden="true" />
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            id={`${base}-${o.value}`}
            type="button"
            role="tab"
            class="segmented__option"
            aria-selected={selected}
            aria-controls={o.controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
