import type { APIRoute } from "astro";
import { searchCourses } from "../../../lib/course-search";
import { getCatalogue, getCatalogueCourses, getPlan, subjectNames } from "../../../lib/db";
import { previewPlacement } from "../../../lib/engine/index";
import { ApiFailure, handle, isPlanPeriod, json } from "../../../lib/planner-state";

// GET ?q=&year=&period=&limit= --- server-side search over the in-memory
// catalogue (the browser never holds it). year + period come as a pair (a
// grid slot: previews against this cookie's plan) or not at all (graph
// "Add course": every preview is null).
export const GET: APIRoute = ({ url, locals }) =>
  handle(() => {
    const p = url.searchParams;
    const q = p.get("q") ?? "";
    const rawLimit = p.get("limit");
    const limit = rawLimit === null || rawLimit === "" ? 8 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ApiFailure("INVALID", "limit must be 1-20.");
    const rawYear = p.get("year");
    const rawPeriod = p.get("period");
    const hasYear = rawYear !== null && rawYear !== "";
    const hasPeriod = rawPeriod !== null && rawPeriod !== "";
    if (hasYear !== hasPeriod) throw new ApiFailure("INVALID", "Give both year and period, or neither.");
    let term: { year: number; period: "S1" | "S2" | "SUMMER" } | null = null;
    if (hasYear && hasPeriod) {
      const year = Number(rawYear);
      if (!/^\d+$/.test(rawYear) || year < 1 || year > 6 || !isPlanPeriod(rawPeriod)) {
        throw new ApiFailure("INVALID", "year must be 1-6 and period one of S1, S2, SUMMER.");
      }
      term = { year, period: rawPeriod };
    }
    const plan = getPlan(locals.planId);
    const cat = getCatalogue();
    const results = searchCourses(getCatalogueCourses(), q, {
      plan,
      term,
      limit,
      subjectNames,
      preview: (code) => previewPlacement(code, term?.year ?? 1, term?.period ?? "S1", plan, cat),
    });
    return json({ results });
  });
