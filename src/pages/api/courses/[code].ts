import type { APIRoute } from "astro";
import type { CourseDetailPayload } from "../../../lib/contracts";
import { getCatalogue, getCourse, getCourseDescription } from "../../../lib/db";
import { dependentsOf, describeRule } from "../../../lib/engine/index";
import { ApiFailure, handle, json } from "../../../lib/planner-state";

// One course with its full description, plain-English rule and dependents.
// Fetched when a detail popover first opens. Retired courses are answered
// too (a plan can still hold one); only placing them is refused.
export const GET: APIRoute = ({ params }) =>
  handle(() => {
    const code = (params.code ?? "").toUpperCase();
    const course = getCourse(code);
    const description = getCourseDescription(code);
    if (!course || description === undefined) throw new ApiFailure("UNKNOWN_COURSE", `${code} is not in the catalogue.`);
    const cat = getCatalogue();
    const payload: CourseDetailPayload = {
      course: { ...course, description },
      english: course.rule ? describeRule(course.rule, cat) : null,
      dependents: dependentsOf(code, cat),
    };
    return json(payload);
  });
