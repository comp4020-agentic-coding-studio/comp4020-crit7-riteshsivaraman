// Term arithmetic for the plan grid (PLAN.md §3.1). Replaces v1's fixed
// six-term list in src/lib/terms.ts: a plan now has 1..MAX_YEARS years, each
// with S1 and S2 rows and an optional SUMMER row after S2.
//
// Browser-safe: no node: imports, no DB, no environment variables.

import { SLOTS, type Plan, type PlanPeriod, type TermKey } from "../contracts";

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

/**
 * Lowest free slot index in (year, period), or null if the term is full.
 * Slots are 0-based (0..SLOTS[period]-1, as in plan_entries.slot).
 */
export function firstFreeSlot(plan: Plan, year: number, period: PlanPeriod): number | null {
  const taken = new Set(
    plan.entries.filter((e) => e.year === year && e.period === period).map((e) => e.slot),
  );
  for (let slot = 0; slot < SLOTS[period]; slot++) {
    if (!taken.has(slot)) return slot;
  }
  return null;
}
