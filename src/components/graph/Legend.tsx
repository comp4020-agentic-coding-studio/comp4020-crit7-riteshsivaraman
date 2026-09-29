// Graph legend (PLAN.md §4.4): bottom-left floating card, collapsible, open
// by default on the first graph visit of a session (collapsed on small
// screens). Swatches reuse the graph's own classes so they can't drift.
// Browser code --- reads no environment variables (sessionStorage only).

import { useEffect, useState } from "preact/hooks";
import { IconChevronDown } from "../ui";

const KEY = "dp-graph-legend";

function Line({ cls, arrow, mid }: { cls: string; arrow?: string; mid?: boolean }) {
  return (
    <svg class="legend__swatch" viewBox="0 0 36 12" aria-hidden="true">
      <path class={`gedge ${cls}`} d="M2 6H32" marker-end={arrow ? `url(#gm-arrow-${arrow})` : undefined} />
      {mid && (
        <g class="gedge__ban" transform="translate(17 6)">
          <circle r="4.5" />
          <path d="M-3 3L3 -3" />
        </g>
      )}
    </svg>
  );
}

export default function Legend() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      const small = window.matchMedia("(max-width: 640px)").matches;
      const seen = sessionStorage.getItem(KEY);
      setOpen(seen === null ? !small : seen === "open");
    } catch {
      /* storage blocked: keep default */
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        sessionStorage.setItem(KEY, o ? "closed" : "open");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  return (
    <div class={`legend${open ? " is-open" : ""}`}>
      <button type="button" class="legend__toggle" aria-expanded={open} aria-controls="graph-legend" onClick={toggle}>
        Legend <IconChevronDown class="legend__chev" />
      </button>
      {open && (
        <ul id="graph-legend" class="legend__list">
          <li><span class="legend__pill legend__pill--planned code">COMP</span>In your plan</li>
          <li><span class="legend__pill legend__pill--ghost code">COMP</span>Not in plan (faded)</li>
          <li><Line cls="gedge--prereq gedge--idle" arrow="idle" />Needs (points to the course)</li>
          <li><Line cls="gedge--coreq gedge--idle" arrow="idle" />Can take together</li>
          <li><span class="legend__hub">OR</span>One of these</li>
          <li><span class="legend__units">12u</span>Units rule</li>
          <li><Line cls="gedge--incompatible gedge--clash" mid />Can't take both</li>
          <li><Line cls="gedge--prereq gedge--met" arrow="met" />Satisfied</li>
          <li><Line cls="gedge--prereq gedge--unmet" arrow="unmet" />Missing</li>
          <li><Line cls="gedge--prereq gedge--idle" arrow="idle" />Not yet relevant</li>
        </ul>
      )}
    </div>
  );
}
