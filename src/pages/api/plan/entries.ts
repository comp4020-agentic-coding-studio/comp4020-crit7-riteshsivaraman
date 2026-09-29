import type { APIRoute } from "astro";
import { inCareer } from "../../../lib/career";
import { getCourse, getPlan, inTransaction, insertEntry } from "../../../lib/db";
import {
  ApiFailure,
  handle,
  json,
  neighbourhoodCodes,
  plannerState,
  readJsonBody,
  assertFits,
  uniqueViolation,
  validatePosition,
} from "../../../lib/planner-state";

// { code, year, period, slot } --- place a course. Requisite problems never
// reject a request (the plan is the student's; the app only advises): a
// violation is still a 201, and the evaluation says what's wrong.
export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const body = await readJsonBody(request);
    const planId = locals.planId;
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^[A-Z]{4}\d{4}$/.test(code)) throw new ApiFailure("INVALID", "code must be a course code like COMP1100.");
    const before = neighbourhoodCodes(getPlan(planId));
    try {
      inTransaction(() => {
        const plan = getPlan(planId);
        const pos = validatePosition(plan, body);
        const course = getCourse(code);
        if (!course || course.retired) throw new ApiFailure("UNKNOWN_COURSE", `${code} is not in the catalogue.`);
        if (plan.entries.some((e) => e.code === code)) {
          throw new ApiFailure("ALREADY_PLANNED", `${code} is already in your plan.`);
        }
        if (plan.career && !inCareer(course.level, plan.career)) {
          throw new ApiFailure(
            "WRONG_CAREER",
            `${code} is a ${course.level >= 5000 ? "postgraduate" : "undergraduate"} course, and this plan is ${plan.career === "ug" ? "undergraduate" : "postgraduate"}.`,
          );
        }
        assertFits(plan, code, pos); // every cell of a multi-slot / two-term course
        insertEntry(planId, { code, ...pos });
      });
    } catch (err) {
      throw uniqueViolation(err) ?? err;
    }
    return json(plannerState(planId, before), 201);
  });
