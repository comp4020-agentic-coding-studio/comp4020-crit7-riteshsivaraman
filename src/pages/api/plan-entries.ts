import type { APIRoute } from "astro";
import { addPlanEntry, listCourses } from "../../lib/db";
import { TERMS } from "../../lib/terms";

// A plain HTML form POSTs here to place a seeded course into a term. The
// 303 redirect makes it work with no client-side JavaScript --- the
// submitting page re-renders from the database, same shape as the removed
// guestbook's messages.ts.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const courseCode = String(form.get("courseCode") ?? "");
  const termIndex = Number(form.get("termIndex"));

  const courseExists = listCourses().some((course) => course.code === courseCode);
  const termInRange = Number.isInteger(termIndex) && termIndex >= 0 && termIndex < TERMS.length;

  if (courseExists && termInRange) {
    addPlanEntry(courseCode, termIndex);
  }

  return redirect("/", 303);
};
