// Cross-track contracts for the v2 planner (PLAN.md §2.5 and §3), fixed in
// Wave 0. Types only plus two constants: no runtime logic, no `node:` imports,
// no DB, no environment variables --- this file is imported by server code AND by the
// browser islands, so it must stay safe to ship to the client.
//
// A track that needs any of this changed stops and says so (PLAN.md contract
// changelog); it does not widen a type here on its own.

import type * as preact from "preact";

// ---------------------------------------------------------------------------
// §2.5 Requisite and course types
// ---------------------------------------------------------------------------

export type Period = "S1" | "S2" | "SUMMER" | "WINTER" | "AUTUMN" | "SPRING";
export type PlanPeriod = "S1" | "S2" | "SUMMER"; // placeable rows
export const SLOTS: Record<PlanPeriod, number> = { S1: 4, S2: 4, SUMMER: 2 };
export const MAX_YEARS = 6;

export type ParseStatus = "none" | "parsed" | "partial" | "unparsed";
//  none      = course has no requisite text
//  parsed    = every clause became a modelled node
//  partial   = tree contains >=1 UNMODELLED node
//  unparsed  = rule is a single UNMODELLED node

export type InfoKind = "PERMISSION" | "PROGRAM" | "GRADE";

export type Rule =
  | { kind: "AND"; children: Rule[] } // children.length >= 2
  | { kind: "OR"; children: Rule[] } // children.length >= 2
  | {
      kind: "COURSE";
      code: string;
      concurrent: boolean; // true = "completed or currently studying" (same term ok)
    }
  | {
      kind: "UNITS";
      min: number; // units required, e.g. 12
      subject?: string; // "COMP"; omitted = any subject
      levels?: number[]; // [2000] or [3000, 4000]; omitted = any level
      from?: string[]; // named course list; if present subject/levels are ignored
      concurrent: boolean; // same-term courses count
    }
  | {
      kind: "INFO"; // not checkable: met + info badge; an OR met only via INFO is an amber warning
      info: InfoKind;
      text: string; // verbatim clause
      programs?: string[]; // PROGRAM only, e.g. ["HCOMP", "AACOM"]
      wam?: number; // GRADE only, e.g. 70
    }
  | { kind: "UNMODELLED"; text: string }; // verbatim clause, never guessed

export interface CatalogueCourse {
  code: string;
  subject: string;
  number: number;
  level: number;
  title: string;
  units: number;
  summary: string; // embedded for islands
  offered: Period[]; // [] = no offering listed for catalogueYear
  requisiteText: string | null;
  rule: Rule | null;
  parseStatus: ParseStatus;
  incompatible: string[]; // symmetric closure, computed at build
  origin: "catalogue" | "referenced";
  sourceUrl: string;
  catalogueYear: number;
  retired: boolean;
}
// On disk: catalogue/index.json = CatalogueIndexFile; catalogue/<SUBJECT>.json =
//   (CatalogueCourse & { description: string })[] sorted by code.
export type CatalogueIndexFile = {
  version: string; // sha256 over all subject files, first 8 hex
  scrapedAt: string;
  source: string;
  subjects: { subject: string; name: string; count: number }[];
};
export type CatalogueFile = CatalogueIndexFile & {
  courses: (CatalogueCourse & { description: string })[]; // what the loader assembles
};

// ---------------------------------------------------------------------------
// §3.1 Engine types (the functions live in src/lib/engine/index.ts, track B)
// ---------------------------------------------------------------------------

export type TermKey = `Y${number}-${PlanPeriod}`; // "Y2-S1"
export interface CatalogueIndex {
  byCode: Map<string, CatalogueCourse>;
  version: string;
}

export type Severity = "error" | "warning" | "info";
export type Issue =
  | { kind: "MISSING_REQUISITE"; severity: "error"; short: string; missing: Rule } // "Needs COMP1100 first"
  | { kind: "INCOMPATIBLE"; severity: "error"; short: string; with: string } // "Incompatible with COMP1130"
  | { kind: "NOT_OFFERED"; severity: "warning"; short: string; period: PlanPeriod } // "Not offered in S2"
  | { kind: "NO_OFFERING_LISTED"; severity: "warning"; short: string } // "No 2026 offering listed"
  | { kind: "UNMODELLED"; severity: "warning"; short: string; text: string } // "Check official requisites"
  // An OR whose checkable branches are all unmet, satisfiable only via an INFO
  // branch. `missing` is that OR; `detail` is plain English for the popover.
  | { kind: "UNVERIFIED_REQUISITE"; severity: "warning"; short: string; missing: Rule; detail: string } // "Needs COMP2100 or a program"
  | { kind: "RETIRED"; severity: "warning"; short: string } // "No longer in catalogue"
  | { kind: "INFO"; severity: "info"; short: string; info: InfoKind; text: string }; // "Permission code needed"

export type TriState = "met" | "unmet" | "unknown";
export interface ClauseResult {
  // mirrors the Rule tree, for the detail popover
  rule: Rule;
  state: TriState;
  english: string;
  children?: ClauseResult[];
}
export interface EntryStatus {
  entryId: number;
  code: string;
  state: "ok" | "warning" | "violation"; // worst severity: error→violation, warning→warning
  issues: Issue[]; // sorted error, warning, info; issues[0].short goes on the card
  clauses: ClauseResult | null;
}
export interface PlanEvaluation {
  entries: Record<number, EntryStatus>; // keyed by entry id
  unitsByTerm: Record<TermKey, number>;
  totalUnits: number;
  problemCount: number; // entries with state !== "ok"
  catalogueVersion: string;
}
export type PlacementPreview = { state: EntryStatus["state"]; issues: Issue[] };

// ---------------------------------------------------------------------------
// §3.2 Plan state and HTTP API (track A)
// ---------------------------------------------------------------------------

export interface PlanEntry {
  id: number;
  code: string;
  year: number;
  period: PlanPeriod;
  slot: number;
}
export interface Plan {
  years: number;
  summerYears: number[];
  entries: PlanEntry[];
}
export interface PlannerState {
  plan: Plan;
  evaluation: PlanEvaluation;
  catalogueAdditions?: CatalogueCourse[];
}
export type ApiError = {
  error:
    | "INVALID"
    | "UNKNOWN_COURSE"
    | "SLOT_TAKEN"
    | "ALREADY_PLANNED"
    | "YEAR_NOT_EMPTY"
    | "NOT_FOUND"
    | "UNSUPPORTED_MEDIA";
  message: string;
  entries?: number;
};

export interface SearchResult {
  course: CatalogueCourse; // no description
  // previewPlacement for (year, period) vs this cookie's plan; null when the
  // search was made without a term (graph "Add course", contract changelog W0)
  preview: PlacementPreview | null;
  inPlan: TermKey | null;
}
export interface CourseDetailPayload {
  course: CatalogueCourse & { description: string };
  english: string | null; // describeRule(rule)
  dependents: string[]; // courses this one unlocks
}

// ---------------------------------------------------------------------------
// §3.3 What the server embeds for islands (built by src/lib/planner-state.ts, A)
// ---------------------------------------------------------------------------

export interface PlannerBootstrap {
  catalogue: CatalogueCourse[]; // the plan's NEIGHBOURHOOD only: planned courses, every code
  // their rules reference, their incompatibles, and their
  // dependents (dependentsOf); no `description`
  catalogueMeta: { version: string; scrapedAt: string; source: string };
  state: PlannerState;
}

// ---------------------------------------------------------------------------
// §3.4 Component boundaries
// ---------------------------------------------------------------------------

// Result of a plan mutation requested by the graph. D (Planner.tsx) performs
// the API call and replaces its PlannerState on success; E only reads the
// outcome to close its picker or show the error inline.
export type MutationOutcome = { ok: true } | { ok: false; error: ApiError };

// What E hands to D's SearchPopover when it renders it via renderSearch. The
// search runs without a term (SearchResult.preview is null); E asks for the
// semester after the pick.
export interface GraphSearchProps {
  onPick(code: string): void;
  onClose(): void;
}

// GraphView props (E implements, D renders)
export interface GraphViewProps {
  catalogue: CatalogueIndex;
  state: PlannerState;
  focusCode: string | null; // shared with grid: the course being traced
  onFocusCode(code: string | null): void;
  renderDetail(code: string): preact.ComponentChild; // D passes <CourseDetail/>
  renderSearch(props: GraphSearchProps): preact.ComponentChild; // D passes <SearchPopover/> (term-less)
  // First free slot in (year, period); D computes it with firstFreeSlot and
  // POSTs /api/plan/entries. A full term resolves to SLOT_TAKEN without a request.
  onAddEntry(code: string, year: number, period: PlanPeriod): Promise<MutationOutcome>;
  // First free slot in the target term; D PATCHes /api/plan/entries/:id.
  onMoveEntry(entryId: number, year: number, period: PlanPeriod): Promise<MutationOutcome>;
  /** undergraduate/postgraduate view: hides the other level's incompatible ghosts */
  career?: "ug" | "pg";
}
// CourseDetail props (D implements, E renders via renderDetail)
export interface CourseDetailProps {
  course: CatalogueCourse;
  status: EntryStatus | null;
  cat: CatalogueIndex;
}
