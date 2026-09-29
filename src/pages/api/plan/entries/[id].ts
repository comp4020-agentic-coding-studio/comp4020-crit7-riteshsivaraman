import type { APIRoute } from "astro";
import { deleteEntry, getCourse, getPlan, inTransaction, moveEntry, replaceEntryCode } from "../../../../lib/db";
import {
  ApiFailure,
  handle,
  json,
  neighbourhoodCodes,
  parseEntryId,
  plannerState,
  readJsonBody,
  assertCareer,
  assertFits,
  uniqueViolation,
  validatePosition,
} from "../../../../lib/planner-state";

// { year, period, slot } --- move an entry of THIS plan; or { code } --- swap
// its course in place (the card's pencil). The graph's
// "Move to semester..." uses it (the client picks the first free slot).
export const PATCH: APIRoute = ({ request, params, locals }) =>
  handle(async () => {
    const body = await readJsonBody(request);
    const planId = locals.planId;
    const id = parseEntryId(params.id);
    const before = neighbourhoodCodes(getPlan(planId));
    try {
      inTransaction(() => {
        const plan = getPlan(planId);
        const entry = plan.entries.find((e) => e.id === id);
        if (!entry) throw new ApiFailure("NOT_FOUND", "No such entry in this plan.");
        if (body.code !== undefined) {
          // { code } swaps the course in place: same term and slot, same checks as adding
          const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
          if (!/^[A-Z]{4}\d{4}$/.test(code)) throw new ApiFailure("INVALID", "code must be a course code like COMP1100.");
          if (code === entry.code) return;
          const course = getCourse(code);
          if (!course || course.retired) throw new ApiFailure("UNKNOWN_COURSE", `${code} is not in the catalogue.`);
          if (plan.entries.some((e) => e.code === code)) throw new ApiFailure("ALREADY_PLANNED", `${code} is already in your plan.`);
          assertCareer(plan, code, course.level);
          // its own old cells count as free: fit the new course over the plan without it
          assertFits({ ...plan, entries: plan.entries.filter((e) => e.id !== id) }, code, entry);
          replaceEntryCode(planId, id, code);
          return;
        }
        const pos = validatePosition(plan, body);
        if (entry.year === pos.year && entry.period === pos.period && entry.slot === pos.slot) return;
        assertFits(plan, entry.code, pos, id); // its own cells count as free
        moveEntry(planId, id, pos);
      });
    } catch (err) {
      throw uniqueViolation(err) ?? err;
    }
    return json(plannerState(planId, before));
  });

export const DELETE: APIRoute = ({ request, params, locals }) =>
  handle(async () => {
    await readJsonBody(request, { allowEmpty: true });
    const id = parseEntryId(params.id);
    const before = neighbourhoodCodes(getPlan(locals.planId));
    if (!deleteEntry(locals.planId, id)) throw new ApiFailure("NOT_FOUND", "No such entry in this plan.");
    return json(plannerState(locals.planId, before));
  });
