// GridView (PLAN.md §4.3): Year blocks → term rows → slots/cards, plus the
// year and summer controls. A non-empty removal asks inline first, then
// retries with discardEntries. Browser + SSR safe: no environment variables.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { CatalogueIndex, MutationOutcome, PlanEntry, PlannerState, PlanPeriod } from "../../lib/contracts";
import { MAX_YEARS } from "../../lib/contracts";
import { Button, IconPlus, IconTrash, Tooltip } from "../ui";
import type { Trace } from "./CourseCard";
import { TermRow } from "./TermRow";

export type ShapeChange = { years?: number; summerYears?: number[]; discardEntries?: boolean };

export interface GridViewProps {
  state: PlannerState;
  cat: CatalogueIndex;
  traceOf(code: string): Trace;
  fresh: number | null;
  onTrace(code: string | null): void;
  onAdd(code: string, year: number, period: PlanPeriod, slot: number): Promise<MutationOutcome>;
  onMove(entryId: number, year: number, period: PlanPeriod, slot: number): Promise<MutationOutcome>;
  onRemove(entry: PlanEntry): void;
  onShape(change: ShapeChange): Promise<MutationOutcome>;
}

type Confirm = { what: "year" | "summer"; year: number; count: number; change: ShapeChange };

function ConfirmBar({ c, onYes, onNo }: { c: Confirm; onYes(): void; onNo(): void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { yes.current?.focus(); }, []);
  const noun = `${c.count} course${c.count === 1 ? "" : "s"}`;
  const text = c.what === "year" ? `Remove Year ${c.year} and its ${noun}?` : `Remove the Year ${c.year} summer session and its ${noun}?`;
  return (
    <div class="confirm" role="alertdialog" aria-label={text} onKeyDown={(e) => { if (e.key === "Escape") onNo(); }}>
      <span class="confirm__text">{text}</span>
      <span class="confirm__actions">
        <Button ref={yes} variant="danger" size="sm" onClick={onYes}>{c.what === "year" ? "Remove year" : "Remove summer"}</Button>
        <Button variant="ghost" size="sm" onClick={onNo}>Cancel</Button>
      </span>
    </div>
  );
}

export function GridView(p: GridViewProps) {
  const { plan, evaluation } = p.state;
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const empty = plan.entries.length === 0;

  const shape = async (change: ShapeChange, ask: Omit<Confirm, "count" | "change">) => {
    setError(null);
    const out = await p.onShape(change);
    if (out.ok) { setConfirm(null); return; }
    if (out.error.error === "YEAR_NOT_EMPTY") setConfirm({ ...ask, count: out.error.entries ?? 0, change: { ...change, discardEntries: true } });
    else setError(out.error.message);
  };
  const setSummer = (year: number, on: boolean) => {
    const next = on ? [...plan.summerYears, year].sort((a, b) => a - b) : plan.summerYears.filter((y) => y !== year);
    return shape({ summerYears: next }, { what: "summer", year });
  };

  const years = Array.from({ length: plan.years }, (_, i) => i + 1);
  return (
    <div class="grid-view">
      {years.map((year) => {
        const units = (["S1", "S2", "SUMMER"] as const).reduce((n, per) => n + (evaluation.unitsByTerm[`Y${year}-${per}`] ?? 0), 0);
        const hasSummer = plan.summerYears.includes(year);
        const last = year === plan.years && plan.years > 1;
        const headingId = `year-${year}-heading`;
        const row = (period: PlanPeriod, extra?: ComponentChildren) => (
          <TermRow
            year={year}
            period={period}
            state={p.state}
            cat={p.cat}
            traceOf={p.traceOf}
            fresh={p.fresh}
            hintSlot={empty && year === 1 && period === "S1"}
            labelExtra={extra}
            onTrace={p.onTrace}
            onAdd={p.onAdd}
            onMove={p.onMove}
            onRemove={p.onRemove}
          />
        );
        return (
          <section class="year" aria-labelledby={headingId} key={year} data-year={year}>
            <header class="year__head">
              <h2 class="year__title" id={headingId}>Year {year}</h2>
              <span class="year__rule" aria-hidden="true" />
              <span class="num year__units">{units} units</span>
              {last && (
                <Button variant="text" size="sm" icon={<IconTrash size={14} />} onClick={() => shape({ years: plan.years - 1 }, { what: "year", year })}>
                  Remove year {year}
                </Button>
              )}
            </header>
            {confirm && confirm.year === year && (
              <ConfirmBar c={confirm} onNo={() => setConfirm(null)} onYes={() => shape(confirm.change, confirm)} />
            )}
            <div class="year__panel">
              {row("S1")}
              {row("S2")}
              {hasSummer &&
                row(
                  "SUMMER",
                  <button type="button" class="term__remove" onClick={() => setSummer(year, false)} aria-label={`Remove Year ${year} summer session`}>
                    Remove
                  </button>,
                )}
            </div>
            {!hasSummer && (
              <button type="button" class="add-summer" onClick={() => setSummer(year, true)}>
                <IconPlus size={14} /> Add summer session<span class="visually-hidden"> to Year {year}</span>
              </button>
            )}
          </section>
        );
      })}
      {error && <p class="grid-view__error" role="alert">{error}</p>}
      <div class="grid-view__foot">
        {plan.years >= MAX_YEARS ? (
          <Tooltip content="Plans go up to 6 years">
            <Button variant="secondary" icon={<IconPlus size={14} />} aria-disabled="true">Add year</Button>
          </Tooltip>
        ) : (
          <Button variant="secondary" icon={<IconPlus size={14} />} onClick={() => shape({ years: plan.years + 1 }, { what: "year", year: plan.years + 1 })}>
            Add year {plan.years + 1}
          </Button>
        )}
      </div>
    </div>
  );
}
