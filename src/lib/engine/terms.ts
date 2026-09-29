// Term arithmetic for the plan grid (PLAN.md §3.1). Replaces v1's fixed
// six-term list in src/lib/terms.ts: a plan now has 1..MAX_YEARS years, each
// with S1 and S2 rows and an optional SUMMER row after S2.
//
// Browser-safe: no node: imports, no DB, no environment variables.

import { SLOTS, type Plan, type PlanEntry, type PlanPeriod, type TermKey } from "../contracts";

const PERIOD_RANK: Record<PlanPeriod, number> = { S1: 0, S2: 1, SUMMER: 2 };

/** Y1S1 < Y1S2 < Y1SUMMER < Y2S1 */
export function termOrder(year: number, period: PlanPeriod): number {
  return year * 3 + PERIOD_RANK[period];
}

export function termKey(year: number, period: PlanPeriod): TermKey {
  return `Y${year}-${period}`;
}

/** Every term row the plan shows, in order. */
export function planTerms(plan: Plan): { year: number; period: PlanPeriod }[] {
  const terms: { year: number; period: PlanPeriod }[] = [];
  for (let year = 1; year <= plan.years; year++) {
    terms.push({ year, period: "S1" }, { year, period: "S2" });
    if (plan.summerYears.includes(year)) terms.push({ year, period: "SUMMER" });
  }
  return terms;
}

// ---------------------------------------------------------------------------
// Footprints. A course can take more than one slot and more than one term:
//  - an ANU "annual course" (its summary says so; COMP3770 is "6+6") runs in
//    two consecutive semesters, at its listed units in EACH;
//  - any other course over 6 units is split over two consecutive semesters
//    (12u -> 1 slot in each, 24u -> 2 slots in each);
//  - two-term courses go S1 -> S2 of the same year, or S2 -> S1 of the next
//    year; summer never spans.
// Width is ceil(units per term / 6) adjacent slots, at the same slot indices
// in both terms. One plan_entries row is the anchor (first term, first slot);
// the other cells are derived here, so the grid, server and engine agree.
// ---------------------------------------------------------------------------

export interface Cell {
  year: number;
  period: PlanPeriod;
  slot: number;
}
/** What a course costs in the grid: listed units, and whether ANU runs it as an annual course. */
export interface Load {
  units: number;
  annual: boolean;
}
export type LoadOf = (code: string) => Load;
const SINGLE: Load = { units: 6, annual: false };
const SIX: LoadOf = () => SINGLE;

const ANNUAL = /\bannual course\b|completed twice, in consecutive semesters/i;
/** Load from catalogue fields (units + the one-line summary). */
export function loadOf(course: { units: number; summary?: string } | undefined): Load {
  if (!course) return SINGLE;
  return { units: course.units, annual: ANNUAL.test(course.summary ?? "") };
}

/** Terms, slots per term, and units per term for a course anchored in `period`. */
export function spanOf(load: Load, period: PlanPeriod): { terms: 1 | 2; width: number; unitsPerTerm: number } {
  if (period !== "SUMMER") {
    if (load.annual) return { terms: 2, width: Math.max(1, Math.ceil(load.units / 6)), unitsPerTerm: load.units };
    if (load.units > 6) return { terms: 2, width: Math.max(1, Math.ceil(load.units / 12)), unitsPerTerm: load.units / 2 };
  }
  return { terms: 1, width: Math.max(1, Math.ceil(load.units / 6)), unitsPerTerm: load.units };
}

/** Total units a course is worth over its whole footprint. */
export function totalUnits(load: Load, period: PlanPeriod): number {
  const { terms, unitsPerTerm } = spanOf(load, period);
  return terms * unitsPerTerm;
}

/** The term a two-term course continues into. */
export function nextTerm(year: number, period: PlanPeriod): { year: number; period: PlanPeriod } | null {
  if (period === "S1") return { year, period: "S2" };
  if (period === "S2") return { year: year + 1, period: "S1" };
  return null;
}

/** Every cell a course anchored at (year, period, slot) covers, anchor first. */
export function cellsOf(anchor: Cell, load: Load): Cell[] {
  const { terms, width } = spanOf(load, anchor.period);
  const rows = [{ year: anchor.year, period: anchor.period }];
  const next = terms === 2 ? nextTerm(anchor.year, anchor.period) : null;
  if (next) rows.push(next);
  return rows.flatMap((r) => Array.from({ length: width }, (_, i) => ({ ...r, slot: anchor.slot + i })));
}

/** The last term a course occupies: it counts as completed after this. */
export function endTerm(anchor: Cell, load: Load): { year: number; period: PlanPeriod } {
  const cells = cellsOf(anchor, load);
  const last = cells[cells.length - 1];
  return { year: last.year, period: last.period };
}

export const cellKey = (c: Cell) => `${c.year}-${c.period}-${c.slot}`;

/** cell key ("1-S2-0") -> the entry covering it. */
export function occupancy(plan: Plan, loadOf: LoadOf = SIX): Map<string, PlanEntry> {
  const map = new Map<string, PlanEntry>();
  for (const e of plan.entries) for (const c of cellsOf(e, loadOf(e.code))) map.set(cellKey(c), e);
  return map;
}

export type Fit = { ok: true; cells: Cell[] } | { ok: false; cell: Cell; reason: "outside" | "taken"; by?: PlanEntry };

/**
 * Can a course with `load` be anchored at `anchor`? Every covered cell must
 * be a real row of the plan, inside the row's slots, and free (cells held by
 * `ignoreId`, the entry being moved, count as free).
 */
export function fits(plan: Plan, anchor: Cell, load: Load, loadOf: LoadOf = SIX, ignoreId?: number): Fit {
  const cells = cellsOf(anchor, load);
  const rows = new Set(planTerms(plan).map((t) => termKey(t.year, t.period)));
  const taken = occupancy(plan, loadOf);
  for (const c of cells) {
    if (!rows.has(termKey(c.year, c.period)) || c.slot < 0 || c.slot >= SLOTS[c.period]) {
      return { ok: false, cell: c, reason: "outside" };
    }
    const by = taken.get(cellKey(c));
    if (by && by.id !== ignoreId) return { ok: false, cell: c, reason: "taken", by };
  }
  return { ok: true, cells };
}

/** Plain-English reason a placement does not fit, for API errors. */
export function fitMessage(code: string, load: Load, anchor: PlanPeriod, fit: Extract<Fit, { ok: false }>): string {
  const { terms, width } = spanOf(load, anchor);
  const need =
    terms === 2 || width > 1
      ? ` ${code} needs ${width} slot${width === 1 ? "" : "s"}${terms === 2 ? " in each of two consecutive semesters" : ""}.`
      : "";
  const term = `Year ${fit.cell.year} ${fit.cell.period === "SUMMER" ? "Summer" : fit.cell.period}`;
  const why =
    fit.reason === "taken"
      ? `${term} slot ${fit.cell.slot + 1} is taken by ${fit.by?.code ?? "another course"}`
      : fit.cell.slot >= SLOTS[fit.cell.period]
        ? `it would run past the last slot of ${term}`
        : `${term} isn't in your plan`;
  return `There isn't room for ${code} there.${need} ${why}.`;
}

/**
 * Lowest slot in (year, period) where a course with `load` fits, or null.
 * Slots are 0-based (0..SLOTS[period]-1, as in plan_entries.slot).
 */
export function firstFreeSlot(
  plan: Plan,
  year: number,
  period: PlanPeriod,
  load: Load = SINGLE,
  loadOf: LoadOf = SIX,
  ignoreId?: number,
): number | null {
  for (let slot = 0; slot < SLOTS[period]; slot++) {
    if (fits(plan, { year, period, slot }, load, loadOf, ignoreId).ok) return slot;
  }
  return null;
}
