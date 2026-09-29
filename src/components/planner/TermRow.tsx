// TermRow (PLAN.md §4.3): label column, SLOTS[period] slots, unit total.
// Browser + SSR safe: no environment variables.
import type { ComponentChildren } from "preact";
import type { CatalogueIndex, MutationOutcome, PlanEntry, PlannerState, PlanPeriod } from "../../lib/contracts";
import { SLOTS } from "../../lib/contracts";
import { CourseCard, type Trace } from "./CourseCard";
import { Slot } from "./Slot";

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
  onRemove(entry: PlanEntry): void;
}

const LABEL: Record<PlanPeriod, string> = { S1: "S1", S2: "S2", SUMMER: "Summer" };
const LONG: Record<PlanPeriod, string> = { S1: "Semester 1", S2: "Semester 2", SUMMER: "Summer session" };

export function TermRow(p: TermRowProps) {
  const entries = p.state.plan.entries.filter((e) => e.year === p.year && e.period === p.period);
  const units = p.state.evaluation.unitsByTerm[`Y${p.year}-${p.period}`] ?? 0;
  const cells = Array.from({ length: SLOTS[p.period] }, (_, slot) => entries.find((e) => e.slot === slot) ?? slot);
  return (
    <div class={`term term--${p.period.toLowerCase()}`} role="group" aria-label={`Year ${p.year}, ${LONG[p.period]}`} data-term={`Y${p.year}-${p.period}`}>
      <div class="term__label">
        <span class="code term__name" aria-hidden="true">{LABEL[p.period]}</span>
        <span class="num term__units term__units--inline" aria-hidden="true">{units}u</span>
        {p.labelExtra}
      </div>
      <div class="term__slots">
        {cells.map((c) =>
          typeof c === "number" ? (
            <Slot key={`s${c}`} year={p.year} period={p.period} slot={c} hint={p.hintSlot && c === 0} onAdd={p.onAdd} />
          ) : (
            <CourseCard
              key={`e${c.id}`}
              entry={c}
              course={p.cat.byCode.get(c.code)}
              status={p.state.evaluation.entries[c.id]}
              cat={p.cat}
              trace={p.traceOf(c.code)}
              fresh={p.fresh === c.id}
              onTrace={p.onTrace}
              onRemove={p.onRemove}
            />
          ),
        )}
      </div>
      <span class="num term__units term__units--end">{units}u<span class="visually-hidden"> units</span></span>
    </div>
  );
}
