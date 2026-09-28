# ANU Degree Planner — Crit 7 build plan

<!-- Working plan for this week's build. Not a spec, not the process account —
     those are spec/README.md and PROCESS.md respectively. This is just the
     implementation plan, kept here so it survives between sessions. -->

## Context

Crit 7's brief: pick an ANU system that reliably ruins your week and build the
full-stack replacement, wired end to end, on the Astro + Drizzle + SQLite
starter. Picked course/degree planning — ANU prerequisites nest into genuine
conjunctions-of-disjunctions (confirmed live: COMP2600 requires
`(COMP1110 OR COMP1140 OR COMP1510 OR COMP2750) AND (MATH1005 OR MATH1014 OR
MATH1116)`; COMP3600 requires `24 units of COMP AND (6 units of MATH OR
COMP1600)`, plus a separate incompatibility with COMP6466) — and a student
currently has to hold that structure in their head. The POC models a small
real slice of it: a handful of real CS-major courses, a term-by-term plan
builder, and a dependency graph that shows which prerequisites are and aren't
satisfied by the current plan. Cutoff is Wed 30 Sep 08:30, so scope is
deliberately narrow: no auth, no multi-user, no live catalogue — a static
seeded slice, single implicit plan, framework-free rendering (matches what the
starter already does).

## What gets removed

The guestbook is the starter's placeholder feature and is explicitly meant to
go: `src/lib/schema.ts` (`messages` table), `src/lib/events.ts` (SSE bus),
`src/pages/api/messages.ts`, `src/pages/api/events.ts`, the guestbook markup
in `src/pages/index.astro`, and `spec/guestbook.test.ts`. No SSE/live-update
mechanism is being carried over — this is a single-user planning tool, not a
shared feed, so the bus's single-instance limitation is moot and dropping it
is a real scope cut worth stating in `PROCESS.md`.

## Data model (`src/lib/schema.ts`)

- `courses`: `code` (PK text, e.g. `"COMP2600"`), `subject` (text, e.g.
  `"COMP"` — used for unit-count rules), `title`, `units` (int).
- `requisiteNodes`: self-referential tree per course. `id` (PK autoincrement),
  `courseCode` (FK → courses.code, the course this rule tree belongs to),
  `parentId` (nullable FK → requisiteNodes.id — null means root), `kind`
  (`"AND" | "OR" | "COURSE" | "UNIT_COUNT"`), `refCourseCode` (nullable, for
  `COURSE`), `unitSubject` (nullable text, for `UNIT_COUNT`), `unitCount`
  (nullable int, for `UNIT_COUNT`). Trees are shallow (≤2 levels for the
  seeded slice) so they're fetched flat per course and assembled in TS rather
  than via a recursive SQL CTE.
- `incompatibilities`: `courseCode`, `blockedByCode` — pairs, kept separate
  from the AND/OR tree since "you must not have completed X" is a different
  kind of check than "you must have completed X".
- `planEntries`: `id` (PK), `courseCode` (FK), `termIndex` (int, 0-based
  across a fixed term list e.g. Y1S1..Y3S2). One implicit global plan, same
  single-state spirit as the guestbook it replaces.

Run `pnpm db:generate` after writing the schema; commit the generated
migration + snapshot under `drizzle/` per the existing workflow (comment at
the top of `schema.ts` documents this).

## Seed data

A small real slice, seeded once at boot if `courses` is empty (in
`src/lib/db.ts`, alongside the existing `migrate()` call) — a plain TS
array of literal rows, not a separate script:

- COMP1100 (Programming as Problem Solving, 6u COMP) — incompatible with
  COMP1130
- COMP1140 (Structured Programming Advanced, 6u COMP) — requires COMP1130,
  incompatible with COMP1110/COMP6710/COMP7710
- MATH1013, MATH1014 (6u MATH each) — 1000-level math options
- COMP2600 (Formal Methods for Software Engineering, 6u COMP) — requires
  `(COMP1100 OR COMP1140) AND (MATH1013 OR MATH1014)` (adapted to the courses
  actually seeded)
- COMP3600 (Algorithms, 6u COMP) — requires `24 units of COMP AND (6 units of
  MATH OR COMP1600)`, incompatible with COMP6466
- 2–3 more to make the graph non-trivial (e.g. COMP2100, COMP2120) with their
  real requisite text pulled the same way.

Every seeded requisite is real text confirmed from
`programsandcourses.anu.edu.au` this session — not invented — so `README.md`
can honestly say so.

## Rule engine (`src/lib/requisites.ts`)

Pure functions, unit-testable without the DB:
- `evaluateNode(node, plannedBefore: Set<string>, unitsBefore: Map<string,
  number>): boolean` — recurses AND/OR/COURSE/UNIT_COUNT.
- `isSatisfied(courseCode, planEntries, termIndex)`: builds `plannedBefore`
  and `unitsBefore` from every `planEntries` row with `termIndex` strictly
  before the given one, evaluates the course's root node(s), and separately
  checks `incompatibilities` against courses planned in *any* term.

This is the logic actually worth testing — it's the part a bug in would
silently mis-validate a real plan.

## API routes (`src/pages/api/*.ts`)

Same pattern as the removed `messages.ts`: form POST → mutate → redirect,
following existing Astro `APIRoute` conventions.
- `POST /api/plan-entries` — add `{ courseCode, termIndex }`.
- `POST /api/plan-entries/remove` — remove by id.

## Pages

- `src/pages/index.astro` — **Plan Builder**: one column per term, a form to
  add a seeded course into a term, and a satisfied/violated badge per placed
  course computed server-side via `isSatisfied`. Link to `/graph/`.
- `src/pages/graph/index.astro` — **Dependency graph**: server-rendered
  inline SVG (no client framework/library — Astro emits the SVG markup
  directly from `courses`/`requisiteNodes`/current plan state). Layout is a
  simple longest-path layering (compute each course's depth = 1 +
  max(depth of its COURSE-kind prerequisites), group into columns by depth)
  implemented in `src/lib/graph-layout.ts`. Nodes are boxes per course; edges
  are lines from each COURSE-kind leaf to its dependent course, colored green
  if that branch is currently satisfied by the plan and gray/red otherwise;
  where a node has multiple children under one AND/OR parent, a small
  connector label (`"AND"`/`"OR"`) sits at the junction.
- Both new routes added to `spec/routes.ts` so the invariants/axe suite
  covers them (nav landmark, single h1, alt text n/a for SVG but landmarks
  still apply, viewport, lang, title).

## Tests (`spec/`)

- `spec/requisites.test.ts` — unit tests of `evaluateNode`/`isSatisfied`
  against the real seeded rules (e.g. COMP2600 is satisfied only once both
  an intro-programming course *and* a 1000-level math course are placed in
  an earlier term; COMP3600 needs the unit-count branch to actually sum
  units correctly).
- `spec/plan.test.ts` — HTTP-level, same shape as the deleted
  `guestbook.test.ts`: POST a plan entry, reload `/`, assert the course
  shows up in its term — this is the literal "core flow persists across a
  reload" spec line.
- Delete `spec/guestbook.test.ts`.
- Leave `invariants.test.ts` and `readme.test.ts` untouched (they read
  `spec/routes.ts` and `README.md` respectively).

## Docs

- `README.md` — replace the template: what this is, which real ANU
  requisite text it's built from and where it was pulled from, what's
  enforced (`spec/*.test.ts`) vs judged (does the graph actually make the
  structure easier to see — a crit judgement call), and the stated scope
  cuts (static slice not the live catalogue, single implicit plan, no auth).
- `CLAUDE.md` (project, currently empty) — rules for this build: schema
  changes always paired with `pnpm db:generate` + a passing `pnpm check`
  before calling a change done; seeded requisite data must trace to a real
  ANU page fetched this session, not invented; keep rendering
  framework-free (no React/D3 added) since the layered-layout approach
  doesn't need it.
- `PROCESS.md` / `reflections/crit-7.md` — filled in at the end once the
  build is done, citing the actual commits.

## Verification

- `pnpm db:generate` runs clean and the migration matches `schema.ts`.
- `pnpm check` (typecheck + `astro build` + vitest) passes, including the new
  `requisites.test.ts` and `plan.test.ts`, with `invariants.test.ts` and
  `readme.test.ts` still green against the new routes/README.
- Manual check via `pnpm dev` (or `pnpm preview` against the build): add a
  course to a term, reload, confirm it's still there and its badge reflects
  the real prerequisite state; visit `/graph/` and confirm edges flip color
  as courses are added/removed from the plan.
- Redeploy to Fly (`mise exec -- flyctl deploy --remote-only --ha=false -a
  comp4020-crit7-riteshsivaraman`, already authenticated) and re-check the
  live URL once the feature is in a demoable state.

## Design system

- Every page uses `src/layouts/Base.astro` (props: `title`, optional
  `current: "plan" | "graph"`) and styles only via the tokens and classes in
  `src/styles/anu.css` (container, page-heading, data-table, panel, btn-primary/
  btn-secondary, field/label/input/select, badge-satisfied/pending/unmet,
  alert-*). The graph uses `--status-satisfied|pending|unmet` for node/edge
  colours.
- No ad-hoc colours, fonts, shadows or radii in page markup or `<style>`
  blocks. Only structural layout (grid/flex arrangement) may be page-local.
- If a builder needs a style that doesn't exist, report it as missing
  rather than adding it; the foundation owner adds it to `anu.css`.
- No real ANU crest/logo or trademarked imagery; the wordmark is plain text.
