# Orchestrator handoff (2026-09-30)

## Role

The orchestrator only communicates and dispatches: it spawns background
subagents (Agent tool) for all work, never edits code itself.

- **Models**: Sonnet for mechanical work (commits, merges, checks, docs);
  Opus for judgement (design, planning, tricky bugs).
- Keep own context small; don't re-paste prompts.
- **Reporting style** (Ritesh's CLAUDE.md): two bullet lists —
  "What happened" / "What I need from you".

**Lessons learned:**

- Separate interactive Claude sessions refuse orders relayed from the
  orchestrator claiming Ritesh's approval (correctly) — prefer background
  subagents over peer sessions.
- Parallel tracks must each use their own git worktree
  (`git worktree add ../crit7-<track> -b <branch>`) or they collide on
  `.data/`, `dist/`, and uncommitted files.
- Background subagents must be told to stop any dev server they start and
  to use distinct ports.

## State at handoff

- `main` at `0b2232a` (nothing pushed; repo private, deploys manual via
  `flyctl deploy`).
- `PLAN.md` v2 is committed on `main`:
  - `cd869a3` — v2 plan: redesign, full COMP catalogue, richer requisites.
  - `2b3f65e` — catalogue widened to **every ANU course**, all subjects,
    UG+PG, ~3-5k courses; scraper ≤1 req/s, resumable, trial run on
    COMP/MATH/ENGN first, per-subject files under `catalogue/`;
    search/detail served via server APIs (`/api/courses/search`,
    `/api/courses/:code`, `/api/courses?subject=`); initial page embed
    capped at 150 KB; graph gets a "Subject" view.
  - `0b2232a` — keep a stub `GET /api/events` returning a `: ok` SSE
    comment so the CI `checks.yml` deploy probe passes; owned by track A.
  - `PLAN.md` §6 (open questions) is now empty.
- **v1 done and merged**: schema + seed (~6 courses) + requisite engine
  (AND/OR/COURSE/UNIT_COUNT + incompatibilities), ANU design tokens
  (`src/styles/anu.css`) + `Base.astro` layout, plan builder page
  (`index.astro` + `/api/plan-entries` routes, `spec/plan.test.ts`), graph
  page (`/graph/`, `graph-layout.ts`, OR-group status fix).
  `pnpm check`: 51/51 tests, 0 type errors.
- `LEARNINGS.md` has entries on stale `dist/`, a weak `toContain` assertion
  caught by mutation testing, and orphaned dev servers + `rm -rf .data`.
- `REQUISITES.md`: taxonomy of ANU COMP requisite types vs. engine support
  (being committed by the plan agent).
- Data map explainer HTML at
  `/tmp/artifact-scratch/degree-planner-data-map.html` — not published: the
  Artifact tool refuses because session auth uses `ANTHROPIC_AUTH_TOKEN`
  (needs unset + `/login` with claude.ai).
- **Key data findings**:
  - Only `plan_entries` is mutable.
  - Boot seed inserts only when the `courses` table is empty (catalogue
    changes never reach prod — v2 fixes this).
  - Migrations run at boot.
  - WAL mode (sqlite3 reads right after a write may look stale).
  - One global plan currently (v2 → per-browser cookie).
  - No client JS in v1.
  - Only `process.env` use is `DATABASE_PATH`, server-only.
- A dev server may be running on port 4600 (Ritesh started it; stop with
  `pnpm astro dev stop`).
- Sessions 23 and 78 (old peer builder/orchestrator) should be closed;
  session 94 already closed.

## Ritesh's v1 verdict

Rudimentary, unpolished, not self-explanatory. UI/UX revamp is the #1
priority — he wants it significantly revamped, professional.

## v2 decisions (all confirmed by Ritesh)

- **Look**: modern SaaS polish in ANU colours (black/gold). No crest.
- **Planner**: stacked semester rows, 3 years default + add/remove rows
  (summer optional), 4 slots per row; click slot → inline search popover
  (no dropdowns).
- Violations shown inline on the course card; hover shows plain-English
  requisites, semesters offered, description + units.
- **Graph**: toggle inside planner; dynamic force-directed (Obsidian-like)
  via d3-force; hover shows requisites in text; intuitive edges; must show
  incompatibilities (v1 missed COMP1100–COMP1130).
- **Stack**: Preact islands + d3-force.
- Per-browser plans (anonymous cookie).
- **Catalogue**: scrape **every ANU course** (all subjects, UG+PG, ~3-5k)
  from Programs & Courses once into a committed seed, per-subject files
  under `catalogue/`; scraper runs ≤1 req/s, is resumable, and is
  trialled on COMP/MATH/ENGN first before the full run; flag unparseable
  entries; boot must upsert the catalogue. Search/detail served via
  server APIs, not a full client-side embed (initial page embed capped at
  150 KB).
- **Engine must add**: level-scoped unit counts, corequisites (same term
  allowed), unit count from a named course list. Warn-only: permission
  code, program enrolment, WAM. Everything else unmodelled, raw text shown.

## In flight at handoff

The plan agent has finished: `PLAN.md` v2 is committed at `0b2232a`.
Awaiting Ritesh's approval of `PLAN.md` at that commit before any build
starts.

**Note for the scraper agent**: before running the full scrape, check
`programsandcourses.anu.edu.au`'s `robots.txt` and terms of use. The full
scrape (every ANU course, all subjects) takes roughly 1-2 hours at the
mandated ≤1 req/s.

## Next steps

1. Ritesh approves `PLAN.md` at `0b2232a`.
2. **W0** contracts session — single session, blocks everything below.
3. **W1** — tracks A (data) / B (engine) / C (design) in parallel, each
   in its own git worktree.
4. **W2** — tracks D (planner UI) / E (graph) in parallel, each in its
   own git worktree.
5. **W3** — track F integrates: README, deploy, prod `sqlite3` checks.
6. File ownership per track is fixed by `PLAN.md` §5.1 — check there
   before starting any track.
