// Plan + catalogue HTTP client (PLAN.md §3.2). Browser code: runs in the
// Planner island only, reads no environment variables, imports no server
// modules. Planner.tsx is the only caller of the mutating functions.
import type { ApiError, CourseDetailPayload, PlannerState, PlanPeriod, SearchResult } from "../../lib/contracts";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const NETWORK: ApiError = { error: "INVALID", message: "Couldn't reach the server. Check your connection and try again." };

async function call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { ok: false, error: NETWORK };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.ok) return { ok: true, data: payload as T };
  const e = payload as Partial<ApiError> | null;
  return { ok: false, error: e && typeof e.error === "string" ? (e as ApiError) : { error: "INVALID", message: `Request failed (${res.status}).` } };
}

export const api = {
  addEntry: (code: string, year: number, period: PlanPeriod, slot: number) =>
    call<PlannerState>("POST", "/api/plan/entries", { code, year, period, slot }),
  moveEntry: (id: number, year: number, period: PlanPeriod, slot: number) =>
    call<PlannerState>("PATCH", `/api/plan/entries/${id}`, { year, period, slot }),
  removeEntry: (id: number) => call<PlannerState>("DELETE", `/api/plan/entries/${id}`),
  patchPlan: (body: { years?: number; summerYears?: number[]; discardEntries?: boolean }) =>
    call<PlannerState>("PATCH", "/api/plan", body),
  resetPlan: () => call<PlannerState>("DELETE", "/api/plan"),
  search: (q: string, term: { year: number; period: PlanPeriod } | null, signal?: AbortSignal) => {
    const p = new URLSearchParams({ q, limit: "12" });
    if (term) {
      p.set("year", String(term.year));
      p.set("period", term.period);
    }
    return call<{ results: SearchResult[] }>("GET", `/api/courses/search?${p}`, undefined, signal);
  },
  course: (code: string) => call<CourseDetailPayload>("GET", `/api/courses/${encodeURIComponent(code)}`),
};

/** "Year 2, Semester 1" / "Year 1, Summer" */
export function termLabel(year: number, period: PlanPeriod): string {
  return `Year ${year}, ${period === "SUMMER" ? "Summer" : period === "S1" ? "Semester 1" : "Semester 2"}`;
}
/** "Y2 S1" */
export function termShort(year: number, period: PlanPeriod): string {
  return `Y${year} ${period === "SUMMER" ? "Summer" : period}`;
}

/** The plain-English line for an API error, for inline messages. */
export function errorText(verb: "add" | "move" | "remove", code: string, e: ApiError): string {
  const why: Record<ApiError["error"], string> = {
    SLOT_TAKEN: "that slot is already taken",
    ALREADY_PLANNED: "it's already in your plan",
    UNKNOWN_COURSE: "it isn't in the catalogue",
    YEAR_NOT_EMPTY: "that year still has courses",
    NOT_FOUND: "it's no longer in your plan",
    UNSUPPORTED_MEDIA: "the request was malformed",
    INVALID: e.message.replace(/\.$/, ""),
  };
  return `Couldn't ${verb} ${code}: ${why[e.error] ?? e.message}.`;
}
