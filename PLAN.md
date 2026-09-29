# ANU Degree Planner — plan v2 (redesign)

<!-- Working plan, not a spec. v1 (single global plan, 8 hand-seeded courses,
     server-rendered SVG graph) is in git history at 066bf80. This file is the
     planning pass CLAUDE.md asks for before any build; the tracks below are
     meant to run as separate sessions, so every cross-track contract is fixed
     HERE. A track that needs a contract changed stops and says so --- it does
     not edit another track's file or quietly widen a type. -->

## 0. Why v2

v1 worked end to end but read as a prototype: a `<select>` of 8 courses, six
bare columns, "Satisfied/Unmet" badges with no reason, and a separate graph
page that never showed incompatibilities (COMP1100--COMP1130 was invisible).
A first-time visitor could not tell what to do. v2 is a redesign first and a
data/engine upgrade second.

## 1. Goals and non-goals

**Goals**

1. **Self-explanatory on first load.** A student who has never seen the app
   adds a course, sees a requisite problem explained in plain English, and
   finds the graph --- without reading the README.
2. **Professional polish.** Linear/Notion-grade: cards, generous spacing,
   crisp type, subtle motion, in ANU black/gold. No ANU crest or logo.
3. **Vertical semester planner.** 3 years (Y1S1..Y3S2) by default, add/remove
   a year, optional summer row per year, 4 slots per semester row (2 per
   summer row). Click an empty slot → inline search popover → click to place.
   No dropdowns for course selection.
4. **Violations on the card.** Red/amber border + one short reason; hover or
   focus shows the full detail (requisites in plain English, semesters
   offered, summary, units).
5. **Graph as a view toggle** inside the planner (grid ↔ graph), force-directed
   (d3-force), drag/zoom/pan, hover highlights a neighbourhood, arrows show
   direction, AND/OR/incompatibility each visibly distinct, with a legend.
   The graph shows the plan only: planned courses as full nodes, courses
   their rules reference as faded ghost nodes. Courses can be **added** from
   the graph (search, then pick a semester) and **moved** to another
   semester from a node's side panel.
6. **Every ANU course** (all subjects, undergraduate and postgraduate ---
   expect ~3,000--5,000), scraped once from programsandcourses.anu.edu.au
   into committed seed data, synced into the DB on every boot (upsert).
   Because the catalogue is too big to ship to the browser, **search,
   placement previews and course detail are server-side API calls**; the
   page embeds only the plan's neighbourhood (§3.3).
7. **Richer requisites**: level-scoped unit counts, corequisites, unit counts
   from a named list; warn-only info for permission code / program / WAM.
   Anything else stays unmodelled with the official text shown. Never guessed.
8. **Per-browser plans** via an anonymous cookie. No login.

**Non-goals** (say so in README when shipped)

- Degree/major completion rules ("you need 48 units of 3000-level"). v2
  validates courses, not programs.
- Accounts, plan sharing links, multiple plans per browser, export.
- Live catalogue fetching at runtime; winter/autumn/spring sessions as rows
  (offerings in those sessions are shown as text, not placeable rows).
- Program/major structures (majors, minors, specialisations) as objects ---
  only courses are scraped.
- Overloading a semester beyond 4 slots; drag-and-drop between slots or
  onto graph positions. Moving a course is the graph side panel's "Move to
  semester…" action (`PATCH /api/plan/entries/:id`, first free slot in the
  target term); in the grid it is remove and re-add.
- A subject-wide graph (all of COMP, all of MATH). The graph is plan-only.
- Dark mode. Tokens are structured so it can be added later; not built now.
- A no-JS editing path. SSR renders the plan read-only without JS; editing
  needs the Preact islands.

## 2. Data model and migrations

### 2.1 Where each piece of state lives

| State | Lives in | Survives reload / restart / redeploy? |
|---|---|---|
| Catalogue (courses, rules, offerings) | `catalogue/<SUBJECT>.json` + `catalogue/index.json` at repo root (committed) → synced to `courses` table on boot | yes (rebuilt from the file every boot) |
| Catalogue version | `meta` row `catalogue_version` | yes |
| Browser identity | `dp_plan` cookie (httpOnly) | yes, until the browser clears cookies |
| Plan shape (years, summer rows) | `plans` row keyed by cookie value | yes (volume) |
| Placed courses | `plan_entries` rows keyed by `plan_id` | yes (volume) |
| Grid vs graph view | URL `?view=graph` (`history.replaceState`) | reload yes; not per-plan |
| Open popover, hover, graph positions | Preact component state | no, by design |

Nothing plan-related goes in `localStorage`.

### 2.2 Schema (`src/lib/schema.ts`, owned by track A)

```ts
export const meta = sqliteTable("meta", {
  key: text().primaryKey(),              // "catalogue_version", "catalogue_synced_at"
  value: text().notNull(),
});

export const courses = sqliteTable("courses", {
  code: text().primaryKey(),             // "COMP2100"
  subject: text().notNull(),             // "COMP"
  number: int().notNull(),               // 2100
  level: int().notNull(),                // 2000  (= floor(number / 1000) * 1000)
  title: text().notNull(),
  units: int().notNull(),
  summary: text().notNull(),             // <= 280 chars, sentence-trimmed
  description: text().notNull(),         // full P&C description text
  offeredJson: text("offered_json").notNull(),          // JSON Period[]
  requisiteText: text("requisite_text"),                // verbatim P&C text, null if none
  ruleJson: text("rule_json"),                          // JSON Rule | null
  parseStatus: text("parse_status").notNull(),          // ParseStatus
  incompatibleJson: text("incompatible_json").notNull(), // JSON string[] (symmetric)
  origin: text().notNull(),              // "catalogue" | "referenced"
  sourceUrl: text("source_url").notNull(),
  catalogueYear: int("catalogue_year").notNull(),       // 2026, or 2025 fallback
  retired: int().notNull().default(0),   // 1 = no longer in catalogue/
});

export const plans = sqliteTable("plans", {
  id: text().primaryKey(),               // cookie value, 22-char base64url
  years: int().notNull().default(3),     // 1..6
  summerYearsJson: text("summer_years_json").notNull().default("[]"), // JSON number[]
  createdAt: int("created_at").notNull(),
  updatedAt: int("updated_at").notNull(),
});

export const planEntries = sqliteTable("plan_entries", {
  id: int().primaryKey({ autoIncrement: true }),
  planId: text("plan_id").notNull().references(() => plans.id),
  courseCode: text("course_code").notNull().references(() => courses.code),
  year: int().notNull(),                 // 1-based
  period: text().notNull(),              // PlanPeriod
  slot: int().notNull(),                 // 0..SLOTS[period]-1
}, (t) => [
  uniqueIndex("plan_slot_uq").on(t.planId, t.year, t.period, t.slot),
  uniqueIndex("plan_course_uq").on(t.planId, t.courseCode),
]);
```

**Why the rule is a JSON column, not the v1 `requisite_nodes` table:** the
catalogue is read-only reference data that is always read whole, never
queried by node, and must be upserted atomically per course on every boot.
A flat node table makes that sync a delete-and-reinsert of child rows with
id bookkeeping; a JSON column is one `INSERT … ON CONFLICT DO UPDATE` per
course. The rule is validated by a type guard at catalogue build time and
again at boot (`assertRule`), so a malformed rule fails the build, not a
request. `requisite_nodes` and `incompatibilities` are dropped.

### 2.3 Migration `0001` (track A)

`pnpm db:generate` produces the table rebuilds; A then **hand-reviews and
edits** the generated SQL (drizzle-kit's SQLite rebuilds use
`__new_<table>` + `INSERT … SELECT`) to do the backfill below, and commits
the SQL + snapshot. Order inside the migration:

1. `CREATE TABLE meta`, `CREATE TABLE plans`.
2. Rebuild `courses` with the new columns. Existing 8 rows are copied with
   placeholder defaults (`summary=''`, `offered_json='[]'`,
   `parse_status='none'`, `origin='catalogue'`, `catalogue_year=2026`,
   `number`/`level` derived with `CAST(substr(code,5) AS INTEGER)`); boot
   sync overwrites them immediately after.
3. `INSERT INTO plans VALUES ('legacy', 3, '[]', <now>, <now>)` --- v1 had one
   global plan with no owner. Its rows are kept (the migration trail keeps old
   state, per `schema.ts`'s own rule) under a plan no cookie can reach.
4. Rebuild `plan_entries`: `INSERT OR IGNORE INTO __new_plan_entries SELECT
   id, 'legacy', course_code, term_index/2 + 1, CASE term_index%2 WHEN 0
   THEN 'S1' ELSE 'S2' END, row_number() OVER (PARTITION BY term_index
   ORDER BY id) - 1 FROM plan_entries WHERE <slot < 4>` (use a CTE for the
   slot filter). `OR IGNORE` drops v1 duplicates the new unique index forbids.
5. `DROP TABLE requisite_nodes; DROP TABLE incompatibilities;`

A verifies the migration against a **copy of a v1 database** (build v1 at
066bf80, add 3 entries, copy `.data/app.db`, boot v2 against the copy), not
only against an empty DB.

`db.ts` additionally sets `PRAGMA foreign_keys = ON` after `migrate()` (v1
never enabled it, so the FKs were decorative).

### 2.4 Boot sync (replaces the "insert if empty" guard in `db.ts`)

```ts
// src/lib/catalogue-sync.ts (A) --- called from db.ts after migrate()
export function syncCatalogue(db: DB, file: CatalogueFile): SyncReport;
export interface SyncReport { upserted: number; retired: number; version: string; changed: boolean }
```

- One transaction: upsert every course in `catalogue/` with
  `retired = 0`; set `retired = 1` for any `courses` row whose code is not in
  the file (never delete --- `plan_entries` references it); write
  `meta.catalogue_version = file.version` and `catalogue_synced_at`.
- Runs every boot but **skips the upsert when `meta.catalogue_version`
  already equals `index.json`'s version** (thousands of rows; keeps cold
  starts on the auto-stopping 256 MB machine fast). A version change
  upserts everything in one transaction with a prepared statement (target
  < 2 s for 5,000 rows; measured, and noted in LEARNINGS.md if slower).
  Logs one line:
  `catalogue sync: 4213 upserted, 0 retired, version ab12cd34 (changed)` or
  `catalogue sync: up to date (ab12cd34)`.
- Catalogue files are read with `fs` from `./catalogue/` relative to the
  process cwd (`/app` in the image), not `import`ed, so the multi-MB JSON is
  never bundled into the server entry. The Dockerfile copies `catalogue/`
  into the runtime stage next to `drizzle/`. No `process.env` involved.
- After sync, `db.ts` loads the catalogue once into an in-memory
  `CatalogueIndex` (immutable at runtime); requests read that, which came
  from the DB, which came from the file.

### 2.5 Requisite and course types (`src/lib/contracts.ts`, Wave 0)

```ts
export type Period = "S1" | "S2" | "SUMMER" | "WINTER" | "AUTUMN" | "SPRING";
export type PlanPeriod = "S1" | "S2" | "SUMMER";           // placeable rows
export const SLOTS: Record<PlanPeriod, number> = { S1: 4, S2: 4, SUMMER: 2 };
export const MAX_YEARS = 6;

export type ParseStatus = "none" | "parsed" | "partial" | "unparsed";
//  none      = course has no requisite text
//  parsed    = every clause became a modelled node. A course whose requisite
//              text contains only incompatibilities (no prerequisite or
//              corequisite rule) is "parsed" with rule: null; "none" means the
//              text is empty or absent.
//  partial   = tree contains >=1 UNMODELLED node
//  unparsed  = rule is a single UNMODELLED node

export type InfoKind = "PERMISSION" | "PROGRAM" | "GRADE";

export type Rule =
  | { kind: "AND"; children: Rule[] }                      // children.length >= 2
  | { kind: "OR"; children: Rule[] }                       // children.length >= 2
  | {
      kind: "COURSE";
      code: string;
      concurrent: boolean;   // true = "completed or currently studying" (same term ok)
    }
  | {
      kind: "UNITS";
      min: number;                // units required, e.g. 12
      subject?: string;           // "COMP"; omitted = any subject
      levels?: number[];          // [2000] or [3000, 4000]; omitted = any level
      from?: string[];            // named course list; if present subject/levels are ignored
      concurrent: boolean;        // same-term courses count
    }
  | {
      kind: "INFO";               // warn-only: evaluates as met, surfaces an info badge
      info: InfoKind;
      text: string;               // verbatim clause
      programs?: string[];        // PROGRAM only, e.g. ["HCOMP", "AACOM"]
      wam?: number;               // GRADE only, e.g. 70
    }
  | { kind: "UNMODELLED"; text: string };                   // verbatim clause, never guessed

export interface CatalogueCourse {
  code: string; subject: string; number: number; level: number;
  title: string; units: number;
  summary: string;               // embedded for islands
  offered: Period[];             // [] = no offering listed for catalogueYear
  requisiteText: string | null;
  rule: Rule | null;
  parseStatus: ParseStatus;
  incompatible: string[];        // symmetric closure, computed at build
  origin: "catalogue" | "referenced";
  sourceUrl: string;
  catalogueYear: number;
  retired: boolean;
}
// On disk: catalogue/index.json = CatalogueIndexFile; catalogue/<SUBJECT>.json =
//   (CatalogueCourse & { description: string })[] sorted by code.
export type CatalogueIndexFile = {
  version: string;               // sha256 over all subject files, first 8 hex
  scrapedAt: string; source: string;
  subjects: { subject: string; name: string; count: number }[];
};
export type CatalogueFile = CatalogueIndexFile & {
  courses: (CatalogueCourse & { description: string })[];   // what the loader assembles
};
```

Parser contract (B): a node is emitted only when a grammar production
matches the **whole** clause. Anything else becomes `UNMODELLED` with the
verbatim clause. Assumed-knowledge text is not a rule and is dropped from
`rule` (kept in `requisiteText`). Incompatibility clauses go to
`incompatible`, never into `rule`.

## 3. Contracts between tracks

### 3.1 Engine API (`src/lib/engine/index.ts`, B; stubbed in Wave 0)

Pure: no `node:` imports, no DB. With the full catalogue it runs on the
server (the browser never holds the whole catalogue); staying pure keeps it
unit-testable and lets the graph island evaluate its embedded
neighbourhood if needed.

```ts
export type TermKey = `Y${number}-${PlanPeriod}`;          // "Y2-S1"
export function termOrder(year: number, period: PlanPeriod): number; // Y1S1 < Y1S2 < Y1SUMMER < Y2S1
export interface CatalogueIndex { byCode: Map<string, CatalogueCourse>; version: string }
export function indexCatalogue(courses: CatalogueCourse[], version: string): CatalogueIndex;

export type Severity = "error" | "warning" | "info";
export type Issue =
  | { kind: "MISSING_REQUISITE"; severity: "error"; short: string; missing: Rule }   // "Needs COMP1100 first"
  | { kind: "INCOMPATIBLE"; severity: "error"; short: string; with: string }         // "Incompatible with COMP1130"
  | { kind: "NOT_OFFERED"; severity: "warning"; short: string; period: PlanPeriod } // "Not offered in S2"
  | { kind: "NO_OFFERING_LISTED"; severity: "warning"; short: string }              // "No 2026 offering listed"
  | { kind: "UNMODELLED"; severity: "warning"; short: string; text: string }        // "Check official requisites"
  | { kind: "RETIRED"; severity: "warning"; short: string }                         // "No longer in catalogue"
  | { kind: "INFO"; severity: "info"; short: string; info: InfoKind; text: string };// "Permission code needed"

export type TriState = "met" | "unmet" | "unknown";
export interface ClauseResult {           // mirrors the Rule tree, for the detail popover
  rule: Rule; state: TriState; english: string; children?: ClauseResult[];
}
export interface EntryStatus {
  entryId: number; code: string;
  state: "ok" | "warning" | "violation";  // worst severity: error→violation, warning→warning
  issues: Issue[];                        // sorted error, warning, info; issues[0].short goes on the card
  clauses: ClauseResult | null;
}
export interface PlanEvaluation {
  entries: Record<number, EntryStatus>;   // keyed by entry id
  unitsByTerm: Record<TermKey, number>;
  totalUnits: number;
  problemCount: number;                   // entries with state !== "ok"
  catalogueVersion: string;
}
export function evaluatePlan(plan: Plan, cat: CatalogueIndex): PlanEvaluation;
export type PlacementPreview = { state: EntryStatus["state"]; issues: Issue[] };
export function previewPlacement(code: string, year: number, period: PlanPeriod,
  plan: Plan, cat: CatalogueIndex): PlacementPreview;
export function dependentsOf(code: string, cat: CatalogueIndex): string[];  // reverse index, built in indexCatalogue
export function describeRule(rule: Rule, cat: CatalogueIndex): string;  // plain English
export function parseRequisiteText(raw: string): { rule: Rule | null; incompatible: string[]; status: ParseStatus };
// Lowest free slot index in (year, period), or null if full. Doesn't check the
// term exists in the plan; callers do. D uses it for graph add/move, E to
// disable full semesters in its picker.
export function firstFreeSlot(plan: Plan, year: number, period: PlanPeriod): number | null;
```

All types above and in §3.2--§3.4 are declared in `src/lib/contracts.ts`;
`engine/index.ts` implements the functions and re-exports the engine types.

Evaluation semantics (B's tests pin every line):

- "Before" = entries with `termOrder` strictly less than the entry's term.
  `concurrent: true` also counts the same term.
- `COURSE`: met iff the code is placed before (or same term if concurrent).
- `UNITS`: sum `units` of qualifying courses placed before; qualifying =
  in `from` if given, else matches `subject` (if given) and `level ∈ levels`
  (if given). A course never counts toward its own requisite.
- `AND`: unmet if any child unmet; else unknown if any unknown; else met.
  `OR`: met if any child met; else unknown if any unknown; else unmet.
- `INFO` → met + an `INFO` issue. `UNMODELLED` → unknown + an `UNMODELLED`
  warning. A root that evaluates `unknown` yields a warning, never an error.
- Incompatible: error if any code in `incompatible` is placed in **any** term.
- Offerings: `NOT_OFFERED` if `offered` is non-empty and lacks the period;
  `NO_OFFERING_LISTED` if `offered` is empty.
- `short` strings are ≤ 32 characters, generated by the engine, never by UI.

### 3.2 Plan state and HTTP API (A)

```ts
export interface PlanEntry { id: number; code: string; year: number; period: PlanPeriod; slot: number }
export interface Plan { years: number; summerYears: number[]; entries: PlanEntry[] }
export interface PlannerState { plan: Plan; evaluation: PlanEvaluation; catalogueAdditions?: CatalogueCourse[] }
export type ApiError = { error:
  "INVALID" | "UNKNOWN_COURSE" | "SLOT_TAKEN" | "ALREADY_PLANNED" | "YEAR_NOT_EMPTY" | "NOT_FOUND" | "UNSUPPORTED_MEDIA";
  message: string; entries?: number };
```

Identity: `src/middleware.ts` reads `dp_plan`; if absent, generates 16 random
bytes (base64url) and sets it `HttpOnly; SameSite=Lax; Path=/;
Max-Age=34560000` plus `Secure` when the request is https. It exposes
`Astro.locals.planId`. The `plans` row is created **lazily on first
mutation**, so crawlers and the invariants suite don't create rows; a GET
for an unknown id returns the default empty plan (3 years, no summers).

Every mutating route requires `Content-Type: application/json` (else 415
`UNSUPPORTED_MEDIA`). Astro's origin check only covers form content types,
so the JSON requirement + SameSite=Lax is the CSRF defence --- a cross-site
page can't send a JSON body without a CORS preflight this app never answers.
Every success response is the full `PlannerState` so islands never
re-derive state locally.

| Method + path | Body | Success | Errors |
|---|---|---|---|
| `GET /api/plan` | --- | 200 `PlannerState` | --- |
| `PATCH /api/plan` | `{ years?: number; summerYears?: number[]; discardEntries?: boolean }` | 200 | 400 `INVALID`; 409 `YEAR_NOT_EMPTY` (`entries` = count that would be lost) unless `discardEntries: true` |
| `DELETE /api/plan` | --- | 200 (entries cleared, shape reset to default) | --- |
| `POST /api/plan/entries` | `{ code; year; period; slot }` | 201 | 400 `INVALID` (bad term/slot, year > years, SUMMER year not in summerYears), 404 `UNKNOWN_COURSE` (incl. retired), 409 `SLOT_TAKEN`, 409 `ALREADY_PLANNED` |
| `PATCH /api/plan/entries/:id` | `{ year; period; slot }` | 200 | 400 `INVALID` (same checks as POST), 404 `NOT_FOUND` (id not in *this* plan), 409 `SLOT_TAKEN`. **Required**: the graph's "Move to semester…" uses it (client picks the first free slot) |
| `DELETE /api/plan/entries/:id` | --- | 200 | 404 `NOT_FOUND` |
| `GET /api/courses/search?q=&year=&period=&limit=` | --- | 200 `{ results: SearchResult[] }` (limit ≤ 20, default 8). `year` + `period` are both given (grid slot) or both omitted (graph "Add course"); omitted → every `preview` is `null` | 400 `INVALID` (incl. only one of `year`/`period`) |
| `GET /api/courses/:code` | --- | 200 `CourseDetailPayload` | 404 `UNKNOWN_COURSE` |
| `GET /api/events` | --- | 200 `text/event-stream`: one `: ok` comment line, then close. **Stub only** --- exists solely for the CI deploy check in `.github/workflows/checks.yml` (reads the first bytes); the app never calls it | --- |

```ts
export interface SearchResult {
  course: CatalogueCourse;                     // no description
  preview: PlacementPreview | null;            // previewPlacement for (year, period) vs this cookie's plan; null without a term
  inPlan: TermKey | null;
}
export interface CourseDetailPayload {
  course: CatalogueCourse & { description: string };
  english: string | null;                      // describeRule(rule)
  dependents: string[];                        // courses this one unlocks
}
```

Search is an in-memory scan of the `CatalogueIndex` (a few thousand titles
per keystroke is trivial; no FTS table). Empty `q` returns suggestions:
`Ready` + offered-this-period courses from the **subjects already in the
plan** (COMP if the plan is empty), lowest level first. Ranking lives in
`src/lib/course-search.ts` (A): exact code → code prefix → subject match
(`MATH` lists MATH courses) → title word prefix → title contains; ties:
`Ready` first, then level, then code. Without a term (graph search) there
is no `Ready`: the tie-break drops it, and empty-`q` suggestions are
not-yet-planned courses from the plan's subjects, lowest level first.

Removing a summer row with entries uses the same `YEAR_NOT_EMPTY` flow.
Requisite violations **never** reject a request --- the plan is the
student's; the app only advises.

Files (A): `src/pages/api/plan/index.ts`, `src/pages/api/plan/entries.ts`,
`src/pages/api/plan/entries/[id].ts`. v1's `src/pages/api/plan-entries.ts`
and `.../plan-entries/remove.ts` are deleted.

### 3.3 What the server embeds for islands

`src/pages/index.astro` (D) calls A's

```ts
// src/lib/planner-state.ts (A) --- server-only (imports db.ts; reads no process.env itself)
export function getPlannerBootstrap(planId: string): PlannerBootstrap;
export interface PlannerBootstrap {
  catalogue: CatalogueCourse[];          // the plan's NEIGHBOURHOOD only: planned courses, every code
                                         // their rules reference, their incompatibles, and their
                                         // dependents (dependentsOf); no `description`
  catalogueMeta: { version: string; scrapedAt: string; source: string };
  state: PlannerState;
}
```

and passes it as the single prop of `<Planner client:load bootstrap={…}
initialView={"grid" | "graph"} />`. Budget: serialized bootstrap ≤ 150 KB
raw for a 24-course plan (checked by a D test). Because each mutation can
change the neighbourhood, plan-route responses also carry
`catalogueAdditions` (courses newly in the neighbourhood), which
`Planner.tsx` merges into its index. Full `description` comes from `GET
/api/courses/:code` when a detail popover first opens (cached in component
state).

### 3.4 Component boundaries

```
src/pages/index.astro (D)       h1, toolbar SSR shell, <Planner client:load>
└─ Planner.tsx (D)              owns PlannerState, view toggle, API calls, live region
   ├─ Toolbar.tsx (D)           ViewToggle, units summary, problems chip, reset
   ├─ FirstRun.tsx (D)          empty-plan guide
   ├─ GridView.tsx (D)          YearBlock → TermRow → Slot | CourseCard
   │   ├─ SearchPopover.tsx (D) combobox → GET /api/courses/search
   │   └─ CourseCard.tsx (D)
   ├─ CourseDetail.tsx (D)      detail body, shared by card hover AND graph panel
   └─ graph/GraphView.tsx (E)   lazy: import("./graph/GraphView")
       ├─ graph/model.ts (E)    pure: catalogue + evaluation → nodes/edges
       ├─ graph/Legend.tsx (E)
       ├─ graph/SemesterPicker.tsx (E) year+period chooser for add/move; full terms disabled
       ├─ graph/TextView.tsx (E) accessible edge list / SSR fallback
       └─ (renders D's SearchPopover via renderSearch, D's CourseDetail via renderDetail)
```

```ts
// D performs every mutation; E only reads the outcome (close picker / show error).
export type MutationOutcome = { ok: true } | { ok: false; error: ApiError };
// What E hands D's SearchPopover through renderSearch: a term-less search.
export interface GraphSearchProps { onPick(code: string): void; onClose(): void }
// GraphView props (E implements, D renders)
export interface GraphViewProps {
  catalogue: CatalogueIndex;
  state: PlannerState;
  focusCode: string | null;              // shared with grid: the course being traced
  onFocusCode(code: string | null): void;
  renderDetail(code: string): preact.ComponentChild;  // D passes <CourseDetail/>
  renderSearch(props: GraphSearchProps): preact.ComponentChild; // D passes <SearchPopover/> (term-less)
  // D picks firstFreeSlot and POSTs /api/plan/entries; a full term resolves
  // to SLOT_TAKEN without a request.
  onAddEntry(code: string, year: number, period: PlanPeriod): Promise<MutationOutcome>;
  // D picks firstFreeSlot in the target term and PATCHes /api/plan/entries/:id.
  onMoveEntry(entryId: number, year: number, period: PlanPeriod): Promise<MutationOutcome>;
}
// CourseDetail props (D implements, E renders via renderDetail)
export interface CourseDetailProps { course: CatalogueCourse; status: EntryStatus | null; cat: CatalogueIndex }
```

`focusCode` lives in `Planner.tsx`, so tracing a course in the grid and
switching to graph keeps it highlighted (and vice versa). Planner.tsx is the
only file that calls the plan API: the graph adds and moves courses through
`onAddEntry` / `onMoveEntry`, and gets the new state back as its `state`
prop. `SearchPopover` gets a term-less mode for `renderSearch` (no status
pills; `In plan · Y1 S2` rows still disabled).

## 4. Design spec

### 4.1 Direction

Subject: an ANU undergraduate in week 1 of enrolment, trying to answer "can I
take this, and when?". The page's one job: make requisite structure visible
where the decision is made. Register: calm, precise tooling (Linear/Notion),
not a university portal. Colour is reserved for **problems** and for **the
course you're looking at** --- a healthy plan is almost monochrome. Gold means
"yours / selected / focus", red means "this is wrong", amber means "check
this". Nothing else is coloured.

**Signature: the requisite trace.** Hover or focus any course (grid card or
graph node) and the plan answers "what does this depend on, and what does it
clash with": prerequisite cards get a solid gold ring and a tiny `needs`
tag, courses it unlocks get a dashed gold ring and an `unlocks` tag,
incompatible cards get a red ring and `clashes` tag, everything else fades to
45 %. The same neighbourhood logic drives the graph's hover highlight, so the
two views teach each other. This is the one bold move; everything around it
stays quiet.

**Type signature:** course codes are set in a monospace face with tabular
figures everywhere they appear (cards, search, graph nodes, detail) --- codes
read like part numbers, and it makes `COMP2100` vs `COMP2120` scannable.

### 4.2 Tokens (track C replaces `src/styles/anu.css`; names below are the contract)

```css
/* colour --- light only; contrast on --surface noted */
--ink:            #111111;  /* primary text 18.9:1; app bar bg; planned graph node */
--ink-2:          #3F3F46;  /* secondary text 10.4:1 */
--muted:          #5B5B63;  /* meta text 6.6:1 */
--placeholder:    #71717A;  /* input placeholder 4.8:1 */
--canvas:         #F6F6F7;  /* page background */
--surface:        #FFFFFF;  /* cards, popovers, rows */
--surface-2:      #FAFAFA;  /* term row label column, hover wash */
--line:           #E4E4E7;  /* hairlines, card border */
--line-strong:    #D4D4D8;  /* empty-slot dashed border, inputs */
--gold:           #BE830E;  /* fills, rings, borders, focus ONLY --- never text on white (3.1:1) */
--gold-text:      #8F6100;  /* gold text on white 5.4:1 */
--gold-wash:      #FBF3E2;  /* selected / hover wash */
--danger:         #B42318;  /* error text & icon */
--danger-line:    #D92D20;  /* violation border (3:1+ non-text) */
--danger-wash:    #FEF3F2;
--warn:           #B54708;  /* warning text 5.4:1 --- deliberately more orange than gold */
--warn-line:      #E07B12;
--warn-wash:      #FFF8EB;
--info:           #3F3F46;  /* info badges are neutral, not coloured */
--info-wash:      #F4F4F5;
--edge-met:       #8F6100;  --edge-unmet: #D92D20;  --edge-idle: #A1A1AA;

/* type */
--font-ui:   "Geist Variable", system-ui, sans-serif;
--font-code: "Geist Mono Variable", ui-monospace, monospace;
/* size/line: */
--t-xs: 12px/16px;  --t-sm: 13px/20px;  --t-base: 14px/20px;  --t-md: 16px/24px;
--t-lg: 20px/28px;  --t-xl: 28px/34px;  /* h1 only; weight 600, tracking -0.02em */
/* weights: 400 body, 500 labels/buttons, 600 headings + course codes */

/* space (4px base) */
--s-1:4px --s-2:8px --s-3:12px --s-4:16px --s-5:20px --s-6:24px --s-8:32px --s-10:40px --s-14:56px

/* shape */
--r-sm: 6px (slots, inputs, chips)   --r-md: 10px (cards)   --r-lg: 14px (popovers, panels)
--shadow-1: 0 1px 2px rgb(17 17 17 / .06);
--shadow-2: 0 2px 6px rgb(17 17 17 / .08), 0 8px 24px -4px rgb(17 17 17 / .14);

/* motion */
--ease: cubic-bezier(.2,.8,.2,1);  --d-fast: 120ms;  --d-base: 180ms;  --d-slow: 240ms;
--focus: 0 0 0 2px var(--surface), 0 0 0 4px var(--gold);   /* box-shadow ring */
```

Fonts are self-hosted via `@fontsource-variable/geist` and
`@fontsource-variable/geist-mono` (npm, bundled by Astro --- no external
font CDN). `font-variant-numeric: tabular-nums` on `.code`, units and
counts.

**Sensor (C):** `spec/design-tokens.test.ts` fails if any file under `src/`
other than `src/styles/anu.css` contains a hex colour, `rgb(`, `hsl(`, a
`font-family`, or a `box-shadow` literal. D and E may write structural CSS
(`grid`, `flex`, sizes, positions) in `src/styles/planner.css` /
`src/styles/graph.css` using tokens only. A needed token that doesn't exist
is reported to C, not added locally.

### 4.3 Page layout (desktop ≥ 1024px)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ANU Degree Planner                                     How it works  About│  app bar #111, 56px, 1px gold bottom line
└──────────────────────────────────────────────────────────────────────────┘
  Your degree plan                                    [ Grid | Graph ]  ⋯     h1 + ViewToggle + overflow (Reset plan)
  36 units planned · ▲ 2 problems · Saved in this browser                    subline; problems chip opens list
  ┌ FirstRun (only when plan is empty) ─────────────────────────────────┐
  └─────────────────────────────────────────────────────────────────────┘
  YEAR 1 ─────────────────────────────────────────────────────── 24u ───
  ┌──────┬──────────────┬──────────────┬──────────────┬──────────────┐
  │ S1   │ COMP1100     │ COMP1600     │ + Add course │ + Add course │ 12u
  │      │ Programming… │ Foundations… │              │              │
  ├──────┼──────────────┼──────────────┼──────────────┼──────────────┤
  │ S2   │ COMP1110  ▌  │ …            │              │              │ 6u
  │      │ ⨯ Needs COMP1100 or COMP1130 first                         │
  └──────┴──────────────┴──────────────┴──────────────┴──────────────┘
    + Add summer session
  YEAR 2 …
  YEAR 3 …                                                 Remove year 3
  [ + Add year ]
```

Max content width 1120px, gutter 24px (16px ≤ 640px). Each year is a
`--surface` panel (`--r-lg`, `--line` border, `--shadow-1`); term rows
inside are separated by hairlines; the term label column (72px,
`--surface-2`, `--font-code` `--t-sm` `--muted`) reads `S1` / `S2` /
`Summer`. Row unit total right-aligned in `--font-code --t-xs --muted`.

### 4.4 Component inventory and states

**AppBar (C, Base.astro).** `--ink` bg, wordmark "ANU Degree Planner" 15px
600 white, nav links `How it works` (opens FirstRun guide as a popover when
the plan isn't empty) and `About` (/readme/), `--muted`-on-dark `#A1A1AA`
→ white on hover, `aria-current` = white + 2px gold underline. `<nav
aria-label="Main">`. Footer: one line, `--muted`, "Student-built, not an
official ANU service. Catalogue from Programs and Courses, scraped
<date>."

**Slot (empty).** min-height 76px, `--r-sm`, 1px dashed `--line-strong`,
label "+ Add course" `--t-sm --muted`. It is a `<button>` with
`aria-label="Add course to Year 1, Semester 1, slot 3"`.
- hover: border solid `--gold`, bg `--gold-wash`, label `--gold-text`, `--d-fast`.
- focus-visible: `--focus` ring (plus hover styling).
- open (popover attached): solid `--gold` border, `aria-expanded="true"`.
- first-run hint: on an empty plan, Y1 S1 slot 1 shows "Click to add your
  first course" and a single soft gold pulse (1 cycle, 1.2s; none under
  reduced motion).

**CourseCard.** `--surface`, 1px `--line`, `--r-md`, padding 12px, min-height
76px. Anatomy: row 1 `COMP2100` (`--font-code` 13px 600 `--ink`) + `6u`
right (`--font-code --t-xs --muted`); row 2 title `--t-sm --ink-2`, 2-line
clamp; row 3 offering chips (`S1` `S2`, `--t-xs`, `--info-wash`, the chip
for the card's own period is `--gold-wash`/`--gold-text`); issue strip (see
states). Remove: 24px `×` icon button top-right, `aria-label="Remove
COMP2100 from Year 2, Semester 1"`, visible on hover/focus-within (always on
touch).
- ok: as above. Hover lifts: `--shadow-1`→`--shadow-2`, translateY(-1px).
- violation: 1px `--danger-line` border + 3px inset left bar
  `--danger-line`; strip `⨯ Needs COMP1100 first` in `--danger` `--t-xs`
  600 on `--danger-wash`; `+1 more` if more issues.
- warning: 1px dashed `--warn-line` border; strip `▲ Not offered in S2`
  `--warn` on `--warn-wash`. (Dashed vs solid + icon shape means colour is
  never the only signal.)
- info: no border change; `ⓘ Permission code needed` chip `--info` on
  `--info-wash`. Shown alongside any error/warning strip.
- traced (signature): `needs` = 2px solid `--gold` ring + tag; `unlocks` =
  2px dashed `--gold` ring + tag; `clashes` = 2px solid `--danger-line`
  ring + tag; others `opacity: .45`. `--d-base` fade.
- just placed: scale .96→1 + opacity 0→1, `--d-slow`. Other cards whose
  status changed because of the placement cross-fade their strip.
- removing: opacity→0, scale .98, `--d-fast`, then the slot appears.

**CourseDetail (hover card).** Opens after 300ms hover or immediately on
focus; closes on leave/blur/Esc. 340px, `--surface`, `--r-lg`, `--shadow-2`,
padding 16px. Content order: code + title (`--t-md` 600); `6 units ·
2000-level · Offered S1, S2`; **Requisites** --- the `ClauseResult` tree as
plain English, each clause prefixed ✓ (met, `--ink-2`), ✗ (unmet,
`--danger`), ? (unknown, `--warn`), nested with 12px indent and "all of" /
"one of" headers; **Incompatible with** chips (red if placed); info badges;
summary (`--t-sm --ink-2`); for partial/unparsed: disclosure "Official
wording" showing `requisiteText` verbatim; link "View on Programs and
Courses ↗". Has `role="dialog"`-free tooltip semantics: it's
`aria-describedby` content of the card (a non-modal disclosure), and on
touch it opens as a bottom sheet on tap.

**SearchPopover.** Anchored below the slot (flip above if no room), 380px,
`--r-lg`, `--shadow-2`, enter: opacity 0→1 + translateY(4px)→0 + scale
.98→1, `--d-base`. Input autofocused, placeholder "Search code or name ---
e.g. COMP2100 or algorithms". Results (max 8 visible, scrolls): `COMP2100`
mono · title · `6u` · status pill:
`Ready` (neutral ✓) / `Needs COMP1100` (`--danger`) / `Not offered S2`
(`--warn`) / `Clashes with COMP1130` (`--danger`) / `In plan · Y1 S2`
(disabled, not selectable). Results and statuses come from `GET
/api/courses/search` for this slot's term (ranking in §3.2), debounced
120ms, stale requests aborted; while loading, previous results stay and a
2px gold progress line runs under the input (nothing shown under 200ms).
Empty query shows **"Suggested for Year 2, Semester 1"**. No results: "No
ANU course matches 'xyz'. Try a code like MATH1013 or a word from the
title." Network error: "Search is unavailable. Check your connection and
try again." with a Retry button. Placing: optimistic insert of a skeleton card, then
replace with server state; on API error, revert and show an inline message
in the row ("Couldn't add COMP2100: that slot is already taken.").

**ViewToggle.** Segmented control, 2 options `Grid` `Graph` with icons,
`role="tablist"`, the active tab `--surface` with `--shadow-1` on a
`--info-wash` track; indicator slides `--d-base`. Updates `?view=` via
`history.replaceState`. Arrow keys move between tabs.

**Problems chip.** `▲ 2 problems` (`--warn`) or `⨯` if any error
(`--danger`); hidden at zero. Opens a list popover: one row per problem
entry (`COMP1110 · Y1 S2 · Needs COMP1100 or COMP1130 first`); choosing a
row closes it, switches to Grid if needed, scrolls to and focuses the card.

**Year controls.** `+ Add summer session` (text button under a year's S2,
`--muted` → `--ink`), `Remove summer` inside the summer row label,
`Remove year N` on the last year only, `+ Add year` (secondary button,
disabled at 6 with tooltip "Plans go up to 6 years"). Removing a non-empty
year/summer: confirm popover "Remove Year 3 and its 4 courses?" [Remove
year] [Cancel] → `discardEntries: true`.

**FirstRun (empty plan only).** A single `--surface` panel above Year 1,
not a modal:
> **Plan your degree one semester at a time.**
> 1. Click any empty slot and search for a course by code or name.
> 2. Cards flag problems as you go --- missing prerequisites, clashes,
>    semesters a course isn't offered.
> 3. Hover a course to trace what it needs and what it unlocks. Switch to
>    **Graph** to see the whole web.
>
> [Start with COMP1100 in Year 1, Semester 1]   Your plan is saved in this browser.

The numbers encode a real sequence (the first-use flow), so they're earned.
The button places COMP1100 via the normal API. Once the plan has ≥1 entry
the panel is gone; `How it works` in the app bar reopens its content as a
popover.

**Graph view (E).** Full-width panel, height `min(72vh, 760px)`,
`--surface`, `--r-lg`. SVG rendered by Preact; `d3-force` computes
positions; `d3-zoom` (wheel/pinch/drag-pan) and `d3-drag` (node drag, pins
while dragging, releases on drop) attach behaviour.
- Scope: the plan only, no scope control. Planned courses are full nodes;
  unplanned courses their rules reference (prerequisites, corequisites,
  `from`-list members) and their incompatibles are **ghost** nodes; hubs as
  below. Dependents-only courses are not drawn. Everything comes from the
  embedded neighbourhood (§3.3); the graph makes no catalogue requests. Node
  search box (top-left): type a code → centre + focus it.
- **Add course** (button, top-left beside the node search): opens D's
  SearchPopover via `renderSearch`; picking a course opens `SemesterPicker`
  (every placeable term in the plan, `Y1 S1` … incl. summer rows; full
  terms disabled with "Full"); choosing a term calls `onAddEntry` → first
  free slot. Errors show inline in the picker ("Couldn't add COMP2100:
  that semester is full.").
- **Course node:** pill, height 28px, padding 0 10px, code in
  `--font-code` 12px 600. Planned = `--ink` fill, white text. Ghost (not
  planned) = `--surface` fill, 1px dashed `--line-strong`, `--ink-2` text,
  whole node at 55 % opacity (full on hover/focus). Planned with
  violation = + 2px `--danger-line` ring; warning = + 2px dashed
  `--warn-line` ring. Hover/focus = 2px `--gold` ring, cursor grab.
- **OR hub:** 18px circle, `--surface`, 1px `--ink-2`, label `OR` 9px 600.
  Alternatives point into the hub; one arrow leaves the hub to the course.
  AND needs no hub: several separate arrows into the course *are* the AND.
- **Units hub:** rounded rect, `--info-wash`, `--t-xs`, text
  `12u · 2000-level COMP` (or `6u from 4 courses`); for `from` lists the
  listed courses point into it.
- **Info/unmodelled:** not nodes; shown as a `ⓘ` / `?` badge on the course
  node and in the side panel.
- **Edges** (all curved slightly, 1.5px):
  - prerequisite: solid, arrowhead at the dependent course.
  - corequisite (`concurrent`): dashed `4 3`, arrowhead, label-less (legend
    explains "can be taken together").
  - incompatible: `--danger-line` dotted `1 4`, **no arrowhead**, a `⊘`
    marker at the midpoint; one edge per pair, always shown
    when either end is visible. Solid red + thicker (2.5px) when both are
    planned.
  - colour by state: `--edge-met` when satisfied by the plan, `--edge-unmet`
    when the dependent is planned and this branch is unmet (OR branches
    grey out once the OR is met --- v1's group-level rule, kept),
    `--edge-idle` otherwise.
- **Forces:** `forceLink` distance 70 (hub links 40), `forceManyBody`
  −260, `forceCollide` (node half-width + 8), and a weak `forceX` (0.06)
  pulling 1000-level left → 4000-level right, so direction reads
  left-to-right while the layout stays organic. Settles in ~1.5s; alpha
  re-heats gently (0.3) on drag.
- **Hover/focus a node:** its node, direct requisite nodes, hubs, dependents
  and incompatibles stay full opacity with their edges thickened; all else
  fades to 15 %. The side panel (right, 320px; bottom sheet < 768px)
  renders `renderDetail(code)` plus one action under it: planned node →
  **Move to semester…** (SemesterPicker; its current term and full terms
  disabled; → `onMoveEntry`); ghost node → **Add to semester…**
  (SemesterPicker → `onAddEntry`). Click pins the focus; Esc or background
  click clears it. Shares `focusCode` with the grid.
- **Legend** (bottom-left floating card, collapsible, open by default on
  first graph visit per session): Planned course · Not in plan (faded) · Needs
  (solid arrow) · Can take together (dashed arrow) · One of (OR hub) · Units
  rule · Can't take both (red dotted ⊘) · Satisfied / Missing / Not yet
  relevant colours.
- Controls (bottom-right): `+` `−` `Fit` icon buttons, 32px, `aria-label`s.
- **Text view** link ("Show as list") swaps the SVG for `TextView`: per
  course, "COMP2100 needs: COMP1110 or COMP1140 (met); 6 units of
  1000-level MATH (missing). Can't be taken with COMP6442." This is also
  the SSR output for `?view=graph` before the island hydrates.

### 4.5 Responsive (verify at 375 × 812 in a real browser)

- ≤ 640px: term row becomes label-above-slots; slots in a 2 × 2 grid
  (summer 2 × 1); cards full cell width; unit total moves next to the label.
  No horizontal page scroll anywhere.
- SearchPopover and CourseDetail become bottom sheets (full width,
  `max-height: 75vh`, 14px top radius, drag handle, backdrop
  `rgb(17 17 17 / .32)` via token `--scrim`). Detail opens on tap of the
  card body; remove `×` always visible (44 × 44 hit area).
- Toolbar wraps: h1 on its own line, toggle + overflow on the next,
  subline third.
- Graph: full width, 70vh, pinch-zoom and one-finger pan; legend collapsed
  to a `Legend` button; side panel is a bottom sheet.
- All interactive targets ≥ 44 × 44 on touch (`@media (pointer: coarse)`).

### 4.6 Motion

Only three kinds, all using `--ease`: hover/press feedback (`--d-fast`),
surfaces entering/leaving (`--d-base`: popovers, sheets, toggle indicator),
placement/removal and trace fades (`--d-slow`). No page-load choreography,
no parallax, no looping animation except the one-cycle first-run pulse.
`prefers-reduced-motion: reduce`: all transforms off, opacity transitions
capped at 80ms, graph simulation runs 300 ticks synchronously before first
paint and does not animate (drag still works, without re-heat drift).

### 4.7 Accessibility

- Slot `<button>` → opens SearchPopover; focus moves to the input. Pattern:
  ARIA 1.2 combobox (`role="combobox"`, `aria-controls` listbox,
  `aria-activedescendant`). ↑/↓ move, Enter places, Esc closes and returns
  focus to the slot, Tab closes. After placing, focus goes to the new card.
- Card is an `<article aria-labelledby>`; the issue strip text is real text
  (not `title`), and the card's accessible description includes all issues.
  Detail opens on focus. After removal, focus moves to the now-empty slot.
- Grid keyboard: Tab order is row by row, slot by slot. (No roving
  tabindex in the grid --- 24–40 stops is acceptable and predictable.)
- Graph: the SVG is `role="application"` with an `aria-label`; one node in
  tab order (roving tabindex), arrow keys move to the nearest node in that
  direction, Enter pins focus, Esc clears. The Text view is the full
  non-visual equivalent and is one click away. SemesterPicker is a
  listbox of terms (disabled terms `aria-disabled`); Enter chooses, Esc
  closes and returns focus to the button that opened it.
- A polite `aria-live` region in `Planner.tsx` announces results: "COMP2100
  added to Year 2, Semester 1. 1 problem: Needs COMP1100 first." /
  "COMP2100 removed. COMP3600 now has a problem."
- Contrast: every text token above is ≥ 4.5:1 on its background; gold is
  never text on white; rings/borders ≥ 3:1. Checked with axe **in a real
  browser with `color-contrast` enabled** (the jsdom suite disables it).
- Exactly one `<h1>` per page (islands render none); `<nav>` in Base.

## 5. Build tracks

### 5.1 File ownership (no file has two owners)

| Track | Owns (create / edit / delete) |
|---|---|
| **W0 contracts** | `src/lib/contracts.ts`; `package.json` + `pnpm-lock.yaml` (installs `@astrojs/preact`, `preact`, `d3-force`, `d3-zoom`, `d3-drag`, `d3-selection`, `@types/d3-*`, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`); `astro.config.ts` (add preact integration); `tsconfig.json` (jsx settings); `spec/fixtures/catalogue-mini.json` (v1's 8 courses in the new shape); stubs: `src/lib/engine/index.ts`, `src/components/graph/GraphView.tsx` --- ownership of the two stubs passes to B and E at Wave 1. |
| **A data** | `scripts/scrape-catalogue.ts`, `scripts/build-catalogue.ts`, `catalogue/**` (subject files, `index.json`, `raw/<SUBJECT>.json`, `report.json`), `src/lib/course-search.ts`, `spec/search.test.ts`, `.dockerignore`, `src/lib/schema.ts`, `drizzle/**`, `src/lib/db.ts`, `src/lib/catalogue-sync.ts`, `src/lib/planner-state.ts`, `src/middleware.ts`, `src/env.d.ts`, `src/pages/api/**` (deletes v1 routes), `src/lib/seed-data.ts` (delete), `Dockerfile`, `.gitignore`, `spec/catalogue.test.ts`, `spec/boot-sync.test.ts`, `spec/plan-api.test.ts`, `spec/plan.test.ts` (delete), `spec/contracts-fixture.test.ts` |
| **B engine** | `src/lib/engine/**` (index, evaluate, describe, parse, terms), `src/lib/requisites.ts` + `src/lib/terms.ts` (delete), `spec/requisites.test.ts`, `spec/parser.test.ts`, `spec/fixtures/requisite-texts.json` |
| **C design** | `src/styles/anu.css`, `src/styles.css` (delete), `src/layouts/Base.astro`, `src/pages/readme.astro` (move onto Base; fix "Guestbook" nav), `src/components/ui/**` (Button, IconButton, Chip, Popover/Sheet primitive with positioning + focus return, SegmentedControl, Tooltip), `public/` icons, `src/pages/kit.astro` (branch-only, deleted before merge), `spec/design-tokens.test.ts` |
| **D planner** | `src/pages/index.astro`, `src/components/planner/**` (Planner, Toolbar, FirstRun, GridView, TermRow, Slot, CourseCard, SearchPopover, CourseDetail, api client), `src/styles/planner.css`, `spec/planner-ssr.test.ts` |
| **E graph** | `src/components/graph/**`, `src/styles/graph.css`, `src/lib/graph-layout.ts` (delete), `src/pages/graph/index.astro` (becomes a 301 to `/?view=graph`), `spec/graph-layout.test.ts` (delete), `spec/graph-model.test.ts`, `spec/routes.ts` |
| **F integrate** | `README.md`, `PROCESS.md`, `reflections/**`, `LEARNINGS.md` appends (any track may *append* to LEARNINGS.md --- append-only makes this safe; nobody edits existing entries), deploy + prod checks |

`spec/invariants.test.ts`, `spec/readme.test.ts`, `spec/global-setup.ts`,
`fly.toml`, `.github/**` are course-managed: nobody edits them (see §6 Q2).

### 5.2 Waves

```
W0  contracts (1 short session, blocks everything)
W1  A data ─┐   B engine ─┐   C design        ← three parallel sessions
            │             │
            └─ A's build-catalogue step waits for B's parseRequisiteText
W2  D planner      E graph                    ← two parallel sessions (need A API, B engine, C primitives)
W3  F integrate                               ← one session
```

- In W1, A builds and tests against `spec/fixtures/catalogue-mini.json`
  (the v1 8 courses in the new shape, written in W0) until B's parser
  lands, then runs `build-catalogue` for real. B needs only raw strings (the
  REQUISITES.md examples + `catalogue/raw/*.json` once A commits it).
- D and E may start W2 as soon as A's API routes and B's `evaluatePlan`
  pass their tests; C's primitives can land during W2 (D/E code against the
  class names in §4.2/§4.4).
- Each track works on its own branch (`v2-a-data`, …) and merges to main
  in wave order; a merge runs `rm -rf dist && pnpm check` first (stale-dist
  learning), after checking no dev server holds `.data` (`lsof -i :4321
  -i :4399 -i :4411`).

### 5.3 Definition of done (every track)

Common to all: `rm -rf dist && pnpm check` green; every new test mutated on
purpose once (break the code it guards, see it go red for the right reason,
restore) with the mutation named in the commit message; no dev server left
running; `process.env` touches annotated server-only / client.

**W0 contracts.** `pnpm check` green with stubs; `contracts.ts` exports every
type in §2.5/§3 verbatim; a Preact "hello" island renders in dev (proves the
integration) and is then removed.

**A data.**
- Scraper discovers **every course in the 2026 catalogue, all subjects**
  (the catalogue search's JSON endpoint if it has one --- inspect its network
  requests --- else the paged HTML listing), records the listing total in
  `report.json`, fetches each course page at ≤ 1 req/s with an identifying
  User-Agent (~1--1.5 h for ~4,000 pages), caches raw HTML in
  `.cache/pandc/` (gitignored) so the run is **resumable**, and falls back
  to 2025 on 404, recording `catalogueYear`. Requisite codes outside the
  2026 listing are fetched too (`origin: "referenced"`). Codes that 404 in
  both years are listed in the report, never fabricated.
  `catalogue/raw/<SUBJECT>.json` commits the *extracted text fields* only
  (not HTML), so parser re-runs never hit the network.
- Trial on 3 subjects (COMP, MATH, ENGN) end to end first; only then launch
  the full run in the background and monitor it.
- `report.json`: totals, fetch failures, counts by `parseStatus` **per
  subject**, and every partial/unparsed course with its text, for Ritesh to
  eyeball.
- `spec/catalogue.test.ts`: course count = listing total − reported
  failures, failures ≤ 1 %; every course has units > 0, level matches code;
  every `COURSE`/`from` code in a rule exists in the catalogue or is listed
  dead in the report; incompatibility is symmetric; COMP1100↔COMP1130 and
  MATH1013 present; `version` matches the subject files.
- `src/pages/api/events.ts` stub (§3.2); `spec/plan-api.test.ts` asserts it
  returns `text/event-stream` with a non-empty body (the same condition the
  CI step checks), and is listed in `spec/routes.ts`.
- `spec/search.test.ts`: ranking order in §3.2; `MATH` returns MATH
  courses; empty query suggests only `Ready` + offered courses from the
  plan's subjects; previews are per cookie (two jars, same query, different
  previews); no `year`/`period` → every `preview` is `null`; only one of
  them → 400.
- `spec/boot-sync.test.ts`: spawns the built server against (a) an empty DB
  and (b) a DB left by the v1 schema with 3 legacy entries; asserts course
  count, `meta.catalogue_version`, legacy entries under plan `legacy`, and
  that a course removed from the file becomes `retired = 1` not deleted.
- `spec/plan-api.test.ts`: two cookie jars get independent plans; add →
  GET shows it; restart the server process on the same DB → still there;
  415 on form content type; every 4xx in §3.2; a violation still returns
  201; `PATCH /api/plan/entries/:id` moves an entry to another term and the
  move survives a server restart (checked on the entry's `year`/`period`). Assertions scoped to the entry (`plan.entries[].id`), not substring
  matches (weak-assertion learning).
- sqlite3: after a browser add, `sqlite3 .data/app.db "PRAGMA
  wal_checkpoint(FULL); SELECT plan_id, course_code, year, period, slot FROM
  plan_entries; SELECT * FROM meta;"` shows the row with `plan_id` equal to
  the `dp_plan` cookie (read it in devtools).
- Dockerfile: runtime stage installs `sqlite3` so `flyctl ssh console -C
  "sqlite3 /data/app.db …"` works in prod.

**B engine.**
- `spec/requisites.test.ts`, table-driven, one block per node kind and per
  rule in §3.1's semantics list, including: corequisite same-term met /
  strictly-earlier-only for non-concurrent; level-scoped UNITS ignores other
  levels and other subjects; `from` UNITS counts only listed courses; a
  course never counts toward itself; INFO never makes state `violation`;
  UNMODELLED → `unknown` → warning; tri-state AND/OR truth table (all 9
  pairs each); summer ordering (Y1SUMMER is before Y2S1, after Y1S2);
  incompatibility in a later term still errors; `short` ≤ 32 chars.
- `spec/parser.test.ts` against golden fixtures made from real P&C strings
  (every example quoted in REQUISITES.md §2 + ≥ 20 more from
  `catalogue-raw.json`), each with the expected Rule; plus a "never guess"
  suite: strings with an unrecognised clause must yield `UNMODELLED` for
  that clause verbatim.
- `describeRule` snapshot for COMP2100, COMP2120 (coreq), COMP2700
  (level-scoped), COMP4610 (`from`), COMP4450 (PROGRAM + UNITS).
- Engine files import nothing from `node:*` or `db.ts` (test greps imports).
- Mutations: flip `concurrent` handling; drop the level filter; make OR
  `unknown` short-circuit wrong. Each must go red.

**C design.**
- `anu.css` implements every token in §4.2 and the classes D/E consume;
  header comment lists contrast ratios measured, not claimed.
- Base.astro: app bar, footer, font imports, `<nav>`, skip link "Skip to
  plan". readme.astro uses Base (readme test still green).
- `spec/design-tokens.test.ts` green (and goes red when a hex is pasted
  into a component --- that's its mutation).
- Real browser (claude-in-chrome): C mounts every primitive and state on
  a branch-only `src/pages/kit.astro`, screenshots at 1280 and 375, runs
  axe-core in the page with `color-contrast` on → 0 violations, then
  deletes the page before merging (it is never a shipped route).

**D planner.**
- `spec/planner-ssr.test.ts` (HTTP against the built server, with a cookie
  jar): empty plan SSR contains the FirstRun panel and 6 term rows; after
  adding COMP1110 alone, SSR shows a card for that entry with the text
  "Needs" in its issue strip (scoped to the card's `data-entry-id`); after
  adding COMP1100 + COMP1130, both cards show "Incompatible with";
  bootstrap payload ≤ 150 KB with a 24-course plan, and it does **not**
  contain a course unrelated to the plan (guards against someone embedding
  the whole catalogue).
- Implements `onAddEntry` / `onMoveEntry` (first free slot via
  `firstFreeSlot`; full term → `SLOT_TAKEN` without a request) and the
  term-less SearchPopover for `renderSearch`. A test drives both callbacks
  against the built server and checks the returned plan, not just `ok`.
- Real browser, fresh profile, **keyboard only**: Tab to Y1S1 slot → Enter
  → type "1100" → Enter → card appears, focus on it; add COMP1110 to Y1S1 →
  red "Needs…" strip; move nothing, add COMP1130 → both clash; hover trace
  rings visible; reload → identical; open the site in a second
  (incognito) window → empty plan; add/remove year and summer incl. the
  non-empty confirm; 375px run of the same flow with no horizontal scroll;
  axe in-page with contrast on → 0 violations. Screenshots saved for
  PROCESS.md.
- sqlite3 check (A's command) after the browser flow matches what the page
  shows, entry for entry.

**E graph.**
- `spec/graph-model.test.ts` (pure): OR rule → one hub, n in-edges, 1 out;
  AND → n direct edges, no hub; `concurrent` → `coreq` edge kind; UNITS →
  units hub; incompatibility → exactly one undirected edge per pair even
  though both courses list it; the graph includes planned courses as full
  nodes and referenced/incompatible unplanned courses as ghosts, and nothing
  else (a dependents-only course is absent); OR branch goes idle once the
  OR is met; SemesterPicker's term list marks full terms disabled and, for
  a move, the entry's own term.
- `spec/routes.ts`: `["/", "/readme/", "/?view=graph"]`; a test asserts
  `GET /graph/` → 301 `Location: /?view=graph`.
- Real browser: toggle Grid → Graph → reload keeps graph; drag a node,
  wheel-zoom, pan, Fit; hover COMP2100 → neighbourhood highlighted + side
  panel text; with COMP1100 and COMP1130 planned, the red ⊘ edge between
  them is visible; Add course → search → pick semester → node turns
  planned; ghost node → Add to semester…; planned node → Move to semester…
  → grid shows it in the new term and `sqlite3` shows the new
  `year`/`period`; a full semester is disabled in the picker; legend
  readable; keyboard node navigation;
  reduced-motion emulation → no drift; 375px pinch/pan works, no page
  scroll hijack; axe in-page 0 violations. d3 is absent from the grid
  view's initial JS (check network panel: GraphView chunk loads only on
  toggle).

**F integrate.**
- README rewritten (what it is, the catalogue source + scrape date, what's
  modelled vs warn-only vs unmodelled with counts from the report, non-goals).
- Deploy (`mise exec -- flyctl deploy --remote-only --ha=false -a
  comp4020-crit7-riteshsivaraman`); boot log shows the sync line; prod
  `sqlite3 /data/app.db "SELECT value FROM meta WHERE key='catalogue_version'"`
  matches `catalogue/index.json`; the browser flow from D repeated on the live URL;
  entry survives a `flyctl machine restart` and a redeploy (checked in
  sqlite3, not just the page).

## 6. Risks and open questions

**Risks**
- *P&C scrape shape.* The site may render course lists client-side or
  rate-limit, and ~4,000 pages is a long run. Mitigation: resumable raw
  cache, 1 req/s, 3-subject trial first, commit `catalogue/raw/` so the
  scrape happens once. If discovery fails, A stops and reports ---
  no hand-typed catalogue.
- *Parser coverage.* Requisite prose varies a lot between colleges, far
  less uniform than COMP's; expect a large `partial` share outside CECC. That's acceptable by design (amber "check official
  requisites" + verbatim text), and the report makes it visible.
- *`@astrojs/preact` vs Astro 7.* W0 proves the integration first; if it
  doesn't build, stop before any island is written.
- *Repo/image size.* Subject JSON likely totals 5--15 MB; fine for git and
  the image, but measure after the trial run and record it.
- *Graph hairball.* Mostly gone now the graph is plan-only (a 24-course
  plan plus its ghosts and hubs is well under 100 nodes). Still timebox E's
  force tuning; the Text view is the fallback.
- *Move/add races.* The client picks the first free slot from its copy of
  the plan; if another tab filled it, the server's 409 `SLOT_TAKEN` comes
  back through `MutationOutcome` and the picker shows it. No retry loop.
- *WAL + sqlite3.* Always `PRAGMA wal_checkpoint(FULL)` before trusting a
  sqlite3 read right after a write. Never `rm -rf .data` under a running
  dev server.
- *Cookie loss* = plan loss. Stated in the UI ("Saved in this browser") and
  README; accepted for v2.

**Questions for Ritesh**
- None open. (Resolved: `/api/events` is kept as a stub owned by A so the
  course-managed CI deploy check passes unmodified --- Ritesh, 2026-09-30.)

## Contract changelog

(Append here when a track needs a contract in §2.5/§3 changed; all
downstream tracks rebase before continuing.)

- 2026-09-30, before any build: scope widened from COMP-only to every ANU
  course (Ritesh). Catalogue moved to `catalogue/`, sharded by subject;
  search, previews and detail became server APIs (§3.2); bootstrap embeds
  the plan neighbourhood only; graph "All COMP" scope became subject
  scope.
- 2026-09-30, before any build: `GET /api/events` added as a stub for the
  CI deploy check (Ritesh); the workflow is left untouched.
- 2026-09-30, W0: graph shows plan-only + ghost nodes; add/move from graph
  (Ritesh). Subject scope and `GET /api/courses?subject=` dropped;
  `GraphViewProps` gains `renderSearch`, `onAddEntry`, `onMoveEntry`
  (`MutationOutcome`, `GraphSearchProps`); engine gains `firstFreeSlot`;
  `PATCH /api/plan/entries/:id` is required; search `year`/`period` become
  optional as a pair and `SearchResult.preview` is `null` without them;
  `PlacementPreview` names the preview shape. Affects A (search, PATCH
  tests), B (`firstFreeSlot`), D (callbacks, term-less search), E.
- 2026-09-30, after W0: incompatibility-only text -> parseStatus 'parsed'; contracts-fixture test owned by A (orchestrator).
