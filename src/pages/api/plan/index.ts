import type { APIRoute } from "astro";
import { MAX_YEARS } from "../../../lib/contracts";
import { getPlan, inTransaction, resetPlan, updatePlanShape } from "../../../lib/db";
import { cellsOf } from "../../../lib/engine/index";
import { ApiFailure, handle, json, neighbourhoodCodes, plannerState, readJsonBody, serverLoadOf } from "../../../lib/planner-state";

// This browser's plan (PLAN.md §3.2). Every success is the full PlannerState.

export const GET: APIRoute = ({ locals }) => handle(() => json(plannerState(locals.planId)));

// { years?, summerYears?, discardEntries? } --- change the plan's shape. Losing
// entries (a removed year, or a removed summer row) needs discardEntries.
export const PATCH: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const body = await readJsonBody(request);
    const planId = locals.planId;
    const before = neighbourhoodCodes(getPlan(planId));
    inTransaction(() => {
      const plan = getPlan(planId);
      const years = body.years ?? plan.years;
      if (typeof years !== "number" || !Number.isInteger(years) || years < 1 || years > MAX_YEARS) {
        throw new ApiFailure("INVALID", `years must be an integer 1-${MAX_YEARS}.`);
      }
      const rawSummers = body.summerYears ?? plan.summerYears.filter((y) => y <= years);
      if (
        !Array.isArray(rawSummers) ||
        !rawSummers.every((y) => typeof y === "number" && Number.isInteger(y) && y >= 1 && y <= years)
      ) {
        throw new ApiFailure("INVALID", `summerYears must be a list of years 1-${years}.`);
      }
      if (body.discardEntries !== undefined && typeof body.discardEntries !== "boolean") {
        throw new ApiFailure("INVALID", "discardEntries must be a boolean.");
      }
      const summerYears = [...new Set(rawSummers as number[])].sort((a, b) => a - b);
      // Any cell outside the new shape loses the course (a two-term course
      // anchored in the last kept year can run into a removed one).
      const lost = plan.entries.filter((e) =>
        cellsOf(e, serverLoadOf(e.code)).some((c) => c.year > years || (c.period === "SUMMER" && !summerYears.includes(c.year))),
      );
      if (lost.length > 0 && body.discardEntries !== true) {
        throw new ApiFailure(
          "YEAR_NOT_EMPTY",
          `That would remove ${lost.length} planned course${lost.length === 1 ? "" : "s"}. Send discardEntries: true to confirm.`,
          lost.length,
        );
      }
      updatePlanShape(planId, { years, summerYears }, lost.map((e) => e.id));
    });
    return json(plannerState(planId, before));
  });

// Clear every entry and reset the shape to the default (3 years, no summers).
export const DELETE: APIRoute = ({ request, locals }) =>
  handle(async () => {
    await readJsonBody(request, { allowEmpty: true });
    const before = neighbourhoodCodes(getPlan(locals.planId));
    resetPlan(locals.planId);
    return json(plannerState(locals.planId, before));
  });
