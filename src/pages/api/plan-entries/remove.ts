import type { APIRoute } from "astro";
import { removePlanEntry } from "../../../lib/db";

// A plain HTML form POSTs here to take a course back out of the plan.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const id = Number(form.get("id"));

  if (Number.isInteger(id)) {
    removePlanEntry(id);
  }

  return redirect("/", 303);
};
