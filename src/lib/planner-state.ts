// Server-only (imports db.ts; reads no process.env itself). Everything the
// plan API routes and index.astro share: PlannerState assembly, the plan's
// catalogue neighbourhood (PLAN.md §3.3), request validation and the JSON
// error envelope (§3.2).
import type {
  ApiError,
  CatalogueCourse,
  Plan,
  PlannerBootstrap,
  PlannerState,
  PlanPeriod,
  Rule,
} from "./contracts";
import { MAX_YEARS, SLOTS } from "./contracts";
import { catalogueMeta, getCatalogue, getPlan } from "./db";
import { dependentsOf, evaluatePlan } from "./engine/index";

// ---------------------------------------------------------------------------
// neighbourhood + state
// ---------------------------------------------------------------------------

function ruleCodes(rule: Rule | null, out: Set<string>): void {
  if (!rule) return;
  if (rule.kind === "AND" || rule.kind === "OR") for (const c of rule.children) ruleCodes(c, out);
  else if (rule.kind === "COURSE") out.add(rule.code);
  else if (rule.kind === "UNITS") for (const c of rule.from ?? []) out.add(c);
}

/**
 * Planned courses, every code their rules reference, their incompatibles and
 * their dependents --- the only catalogue the page embeds. No description.
 */
export function neighbourhoodCodes(plan: Plan): Set<string> {
  const codes = new Set<string>();
  if (plan.entries.length === 0) return codes;
  const cat = getCatalogue();
  for (const e of plan.entries) {
    codes.add(e.code);
    const c = cat.byCode.get(e.code);
    if (!c) continue;
    ruleCodes(c.rule, codes);
    for (const x of c.incompatible) codes.add(x);
    for (const d of dependentsOf(e.code, cat)) codes.add(d);
  }
  return codes;
}

function coursesFor(codes: Iterable<string>): CatalogueCourse[] {
  const cat = getCatalogue();
  const out: CatalogueCourse[] = [];
  for (const code of codes) {
    const c = cat.byCode.get(code);
    if (c) out.push(c);
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export function plannerState(planId: string, before?: Set<string>): PlannerState {
  const plan = getPlan(planId);
  const state: PlannerState = { plan, evaluation: evaluatePlan(plan, getCatalogue()) };
  if (before) {
    const after = neighbourhoodCodes(plan);
    state.catalogueAdditions = coursesFor([...after].filter((c) => !before.has(c)));
  }
  return state;
}

export function getPlannerBootstrap(planId: string): PlannerBootstrap {
  const plan = getPlan(planId);
  return {
    catalogue: coursesFor(neighbourhoodCodes(plan)),
    catalogueMeta: { ...catalogueMeta },
    state: { plan, evaluation: evaluatePlan(plan, getCatalogue()) },
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const STATUS: Record<ApiError["error"], number> = {
  INVALID: 400,
  UNKNOWN_COURSE: 404,
  NOT_FOUND: 404,
  SLOT_TAKEN: 409,
  ALREADY_PLANNED: 409,
  YEAR_NOT_EMPTY: 409,
  UNSUPPORTED_MEDIA: 415,
};

export class ApiFailure extends Error {
  readonly body: ApiError;
  constructor(error: ApiError["error"], message: string, entries?: number) {
    super(message);
    this.body = entries === undefined ? { error, message } : { error, message, entries };
  }
}

export function apiError(error: ApiError["error"], message: string, entries?: number): Response {
  const f = new ApiFailure(error, message, entries);
  return json(f.body, STATUS[error]);
}

/**
 * Runs a handler, turning ApiFailure into the §3.2 error envelope. Anything
 * else is a real bug and propagates (Astro answers 500).
 */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiFailure) return json(err.body, STATUS[err.body.error]);
    throw err;
  }
}

/**
 * The CSRF defence (with SameSite=Lax): every mutating route needs a JSON
 * content type, which a cross-site page can't send without a CORS preflight
 * this app never answers. Astro's own origin check only covers form types.
 */
export async function readJsonBody(request: Request, { allowEmpty = false } = {}): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new ApiFailure("UNSUPPORTED_MEDIA", "Send the request body as application/json.");
  }
  const text = await request.text();
  if (text.trim() === "") {
    if (allowEmpty) return {};
    throw new ApiFailure("INVALID", "Request body is empty.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiFailure("INVALID", "Request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiFailure("INVALID", "Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

const PLAN_PERIODS: readonly PlanPeriod[] = ["S1", "S2", "SUMMER"];

export function isPlanPeriod(v: unknown): v is PlanPeriod {
  return typeof v === "string" && (PLAN_PERIODS as readonly string[]).includes(v);
}

export function isYear(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_YEARS;
}

/** A placeable position in *this* plan: term exists, slot in range. */
export function validatePosition(plan: Plan, body: Record<string, unknown>): { year: number; period: PlanPeriod; slot: number } {
  const { year, period, slot } = body;
  if (!isYear(year) || !isPlanPeriod(period)) throw new ApiFailure("INVALID", "year must be 1-6 and period one of S1, S2, SUMMER.");
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SLOTS[period]) {
    throw new ApiFailure("INVALID", `slot must be 0-${SLOTS[period] - 1} for ${period}.`);
  }
  if (year > plan.years) throw new ApiFailure("INVALID", `Year ${year} is not in this plan (it has ${plan.years}).`);
  if (period === "SUMMER" && !plan.summerYears.includes(year)) {
    throw new ApiFailure("INVALID", `Year ${year} has no summer session in this plan.`);
  }
  return { year, period, slot };
}

export function parseEntryId(raw: string | undefined): number {
  const id = Number(raw);
  if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(id)) throw new ApiFailure("NOT_FOUND", "No such entry in this plan.");
  return id;
}

/** Maps a UNIQUE-constraint race to the same error the pre-check gives. */
export function uniqueViolation(err: unknown): ApiFailure | null {
  const msg = err instanceof Error ? err.message : "";
  if (!/UNIQUE constraint failed/.test(msg)) return null;
  if (/course_code/.test(msg)) return new ApiFailure("ALREADY_PLANNED", "That course is already in your plan.");
  return new ApiFailure("SLOT_TAKEN", "That slot is already taken.");
}
