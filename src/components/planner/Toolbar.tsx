// Toolbar (PLAN.md §4.3/§4.4): view toggle, units summary, problems chip
// (opens a list; picking a row focuses that card), overflow menu with Reset.
// Browser + SSR safe: no environment variables.
import { useRef, useState } from "preact/hooks";
import type { CatalogueIndex, PlannerState } from "../../lib/contracts";
import { Button, Chip, IconButton, IconError, IconGraph, IconGrid, IconMore, IconWarn, Popover, SegmentedControl } from "../ui";
import { termShort } from "./api";

export type View = "grid" | "graph";

export interface ToolbarProps {
  state: PlannerState;
  cat: CatalogueIndex;
  view: View;
  onView(v: View): void;
  onJump(entryId: number): void;
  onReset(): Promise<void>;
}

export function Toolbar({ state, view, onView, onJump, onReset }: ToolbarProps) {
  const { evaluation, plan } = state;
  const problemsRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const bad = plan.entries
    .map((e) => ({ e, s: evaluation.entries[e.id] }))
    .filter((x) => x.s && x.s.state !== "ok")
    .sort((a, b) => (a.s.state === "violation" ? 0 : 1) - (b.s.state === "violation" ? 0 : 1));
  const anyError = bad.some((x) => x.s.state === "violation");
  const n = evaluation.problemCount;

  return (
    <div class="toolbar">
      <p class="toolbar__summary">
        <span class="num"><strong>{evaluation.totalUnits}</strong> units planned</span>
        <span aria-hidden="true" class="toolbar__dot">·</span>
        {n > 0 ? (
          <Chip
            ref={problemsRef}
            tone={anyError ? "danger" : "warn"}
            icon={anyError ? <IconError size={12} /> : <IconWarn size={12} />}
            onClick={() => setProblemsOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={problemsOpen}
          >
            {n} problem{n === 1 ? "" : "s"}
          </Chip>
        ) : plan.entries.length > 0 ? (
          <span>No problems found</span>
        ) : null}
        {(n > 0 || plan.entries.length > 0) && <span aria-hidden="true" class="toolbar__dot">·</span>}
        <span class="muted">Saved in this browser</span>
      </p>
      <div class="toolbar__actions">
        <SegmentedControl<View>
          label="View"
          value={view}
          onChange={onView}
          options={[
            { value: "grid", label: "Grid", icon: <IconGrid size={14} />, controls: "planner-panel" },
            { value: "graph", label: "Graph", icon: <IconGraph size={14} />, controls: "planner-panel" },
          ]}
        />
        <IconButton ref={moreRef} label="More actions" icon={<IconMore />} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => { setConfirmReset(false); setMoreOpen((o) => !o); }} />
      </div>

      <Popover open={problemsOpen} anchor={problemsRef} onClose={() => setProblemsOpen(false)} label="Problems in your plan" width={380}>
        <div class="popover__header">Problems in your plan</div>
        <ul class="problems">
          {bad.map(({ e, s }) => {
            const first = s.issues.find((i) => i.severity !== "info") ?? s.issues[0];
            return (
              <li key={e.id}>
                <button
                  type="button"
                  class={`problems__row problems__row--${s.state}`}
                  onClick={() => { setProblemsOpen(false); onJump(e.id); }}
                >
                  {s.state === "violation" ? <IconError size={14} /> : <IconWarn size={14} />}
                  <span class="code">{e.code}</span>
                  <span class="muted">{termShort(e.year, e.period)}</span>
                  <span class="problems__why">{first?.short}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>

      <Popover open={moreOpen} anchor={moreRef} onClose={() => setMoreOpen(false)} label="More actions" placement="bottom-end" width={260}>
        <div class="popover__body menu">
          {confirmReset ? (
            <>
              <p class="menu__text">Clear every course and go back to 3 years? This can't be undone.</p>
              <div class="menu__actions">
                <Button variant="danger" size="sm" onClick={async () => { await onReset(); setMoreOpen(false); }}>Reset plan</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost" block onClick={() => setConfirmReset(true)} aria-disabled={plan.entries.length === 0 && plan.years === 3 && plan.summerYears.length === 0 ? "true" : undefined}>
                Reset plan…
              </Button>
              <a class="btn btn--ghost btn--block" href="/readme/">About this planner</a>
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}
