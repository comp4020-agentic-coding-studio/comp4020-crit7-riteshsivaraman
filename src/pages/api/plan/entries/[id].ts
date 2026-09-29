import type { APIRoute } from "astro";
import { deleteEntry, getPlan, inTransaction, moveEntry } from "../../../../lib/db";
import {
  ApiFailure,
  handle,
  json,
  neighbourhoodCodes,
  parseEntryId,
  plannerState,
  readJsonBody,
  uniqueViolation,
  validatePosition,
} from "../../../../lib/planner-state";

// { year, period, slot } --- move an entry of THIS plan. The graph's
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
        const pos = validatePosition(plan, body);
        const occupant = plan.entries.find((e) => e.year === pos.year && e.period === pos.period && e.slot === pos.slot);
        if (occupant && occupant.id !== id) throw new ApiFailure("SLOT_TAKEN", "That slot is already taken.");
        if (!occupant) moveEntry(planId, id, pos);
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
