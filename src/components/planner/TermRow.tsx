// TermRow (PLAN.md §4.3): label column, SLOTS[period] slots, unit total.
// Browser + SSR safe: no environment variables.
import type { ComponentChildren } from "preact";
import type { CatalogueIndex, MutationOutcome, PlanEntry, PlannerState, PlanPeriod } from "../../lib/contracts";
import { SLOTS } from "../../lib/contracts";
import { CourseCard, type Trace } from "./CourseCard";
import { Slot } from "./Slot";
import { termShort } from "./api";
import { cellKey, loadOf, nextTerm, occupancy, spanOf } from "../../lib/engine/index";

export interface TermRowProps {
  year: number;
  period: PlanPeriod;
  state: PlannerState;
  cat: CatalogueIndex;
  traceOf(code: string): Trace;
  fresh: number | null;
  hintSlot: boolean;
  labelExtra?: ComponentChildren;
  onTrace(code: string | null): void;
  onAdd(code: string, year: number, period: PlanPeriod, slot: number): Promise<MutationOutcome>;
  onMove(entryId: number, year: number, period: PlanPeriod, slot: number): Promise<MutationOutcome>;
  onRemove(entry: PlanEntry): void;
}

const LABEL: Record<PlanPeriod, string> = { S1: "S1", S2: "S2", SUMMER: "Summer" };
const LONG: Record<PlanPeriod, string> = { S1: "Semester 1", S2: "Semester 2", SUMMER: "Summer session" };

export function TermRow(p: TermRowProps) {
  const units = p.state.evaluation.unitsByTerm[`Y${p.year}-${p.period}`] ?? 0;
  const loads = (code: string) => loadOf(p.cat.byCode.get(code));
  const taken = occupancy(p.state.plan, loads);
  // Walk the row's slots: a free slot is a Slot; the first cell of a course in
  // this row is its card (spanning `width` slots); the rest of its cells are skipped.
  const cells: ComponentChildren[] = [];
  for (let slot = 0; slot < SLOTS[p.period]; slot++) {
    const e = taken.get(cellKey({ year: p.year, period: p.period, slot }));
    if (!e) {
      cells.push(<Slot key={`s${slot}`} year={p.year} period={p.period} slot={slot} hint={p.hintSlot && slot === 0} onAdd={p.onAdd} onMove={p.onMove} />);
      continue;
    }
    if (slot !== e.slot) continue; // covered by the card already pushed
    const load = loads(e.code);
    const { terms, width, unitsPerTerm } = spanOf(load, e.period);
    const anchorRow = e.year === p.year && e.period === p.period;
    const next = nextTerm(e.year, e.period);
    const other = anchorRow ? (next ? termShort(next.year, next.period) : "") : termShort(e.year, e.period);
    cells.push(
      <CourseCard
        key={`e${e.id}`}
        entry={e}
        course={p.cat.byCode.get(e.code)}
        status={p.state.evaluation.entries[e.id]}
        cat={p.cat}
        trace={p.traceOf(e.code)}
        fresh={p.fresh === e.id && anchorRow}
        onTrace={p.onTrace}
        onRemove={p.onRemove}
        span={{ width, part: terms === 2 ? (anchorRow ? 1 : 2) : null, other, unitsHere: unitsPerTerm }}
        career={p.state.plan.career}
      />,
    );
  }
  return (
    <div class={`term term--${p.period.toLowerCase()}`} role="group" aria-label={`Year ${p.year}, ${LONG[p.period]}`} data-term={`Y${p.year}-${p.period}`}>
      <div class="term__label">
        <span class="code term__name" aria-hidden="true">{LABEL[p.period]}</span>
        <span class="num term__units term__units--inline" aria-hidden="true">{units}u</span>
        {p.labelExtra}
      </div>
      <div class="term__slots">{cells}</div>
      <span class="num term__units term__units--end">{units}u<span class="visually-hidden"> units</span></span>
    </div>
  );
}
