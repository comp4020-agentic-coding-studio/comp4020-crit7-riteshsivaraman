# Learnings

Stack-specific gotchas, found the hard way, as they come up. Append-only ---
if one turns out to be wrong, add a correction entry, don't delete the
original.

## `pnpm check` can fail on a stale `dist/`, not your code

After rewriting `schema.ts`/`db.ts`/`index.astro` and regenerating the
migration, `rm -rf .data && pnpm check` failed 14 tests: missing `<nav>`,
wrong `<h1>` count, axe violations, and a 404 on `/readme/` --- symptoms of a
broken or empty page being served. Rerunning as `rm -rf .data dist && pnpm
check` passed clean, and two further clean-`.data`-only runs since have
stayed clean.

Read as: `astro build` writing into an existing `dist/` didn't fully clear
whatever `spec/global-setup.ts` had already served up from the pre-rewrite
build (guestbook-era `index.astro`/API routes), so the invariants suite was
briefly checking the old build, not the new one. Not a DB seed race ---
that would reproduce on every fresh-`.data` run, and it hasn't recurred once
`dist/` was clean the first time. Lesson: after a page/route rewrite (not
just a schema change), clear `dist/` too, not only `.data/`, before trusting
`pnpm check`.

## Weak-assertion class: asserting on text that also appears in unrelated markup

A persistence test asserted `toContain(courseCode)` to check that adding a
course actually inserted a row, but the course code also appears in the
plan-builder form's `<select>` of course options --- so the assertion still
passed even with the insert removed entirely (the page rendered the option
list regardless of whether the entry persisted). Found by mutating the
insert out and confirming the test still went green for the wrong reason.
Lesson: when asserting a persisted entity rendered on a page that also
renders a catalogue/options list containing the same identifiers, assert on
markup that is unique to the persisted instance (e.g. its row/badge
structure, or a scoped selector), not a bare substring match on an ID that
appears elsewhere on the same page.

## Orphaned dev server class: a background dev server left running caused a later `rm -rf .data` to unlink the live DB out from under it

Agents left `astro dev` background servers running on ports after finishing
a task (seen on 4399 and 4411), then a later step's `rm -rf .data` deleted
the SQLite file those servers still had open --- the server kept running
against an unlinked file handle with no error surfaced, so the app looked
fine until the process finally restarted or the file was queried directly.
Lesson: always stop any dev server you started before finishing a task, and
before any `rm -rf .data` (or similar), check `lsof -i` for listeners on the
ports this project uses and treat a hit as a stop-and-report, not something
to delete under.

## Astro 7's `astro dev` daemonizes: the shell command returns while the server keeps running

In W0, `pnpm dev --port 4411` printed "Dev server running at
http://localhost:4411 (pid N)" and exited 0 straight away, with the server
still listening in the background. So a backgrounded `pnpm dev` finishing
does not mean the server stopped, and killing the shell doesn't stop it.
Stop it with `pnpm exec astro dev stop` (it prints the pid it stopped), then
confirm with `lsof -nP -i :4411` that nothing is in `LISTEN` (a browser's
leftover `CLOSE_WAIT` sockets are fine). Same bug class as the orphaned dev
server entry above, with a new way in.

## An `.astro` page's `<style>` doesn't reach markup rendered by a Preact island

In the W1 kit page, classes defined in `kit.astro`'s `<style>` styled the
Astro markup but not identical class names rendered inside the
`client:load` island: Astro scopes page styles with a `data-astro-cid-*`
attribute that island output never carries, and nothing warns. Shared
classes belong in `src/styles/anu.css` (or `planner.css`/`graph.css`); a
page-local `<style>` that must reach an island needs `is:global`.

## Browser checks at 375px: the Chrome window won't resize that small, and effects lag

`resize_window` to 375×812 left `innerWidth` at 1512 (the window has a
minimum width), so a "375px screenshot" of the page would have silently been
the desktop layout. Check `innerWidth` after resizing; to get a real 375px
viewport, load the page in a same-origin `<iframe>` 375×812 (media queries
follow the iframe). Separately, in the automated tab Preact `useEffect`s
(scheduled on animation frames) ran up to ~1s late, so a focus/unmount
assertion read immediately after a key press looked failed when it wasn't.
Wait ~1s before asserting focus return, and re-read before calling a bug.

## Two redundant guards hide each other from mutation testing

In the B engine, `previewPlacement` dropped the course's own existing entry
*and* the UNITS/COURSE counter skipped same-code entries. Mutating either
one alone left every test green, because the other still did the job; a
first mutation pass reported both as survivors. Fix was to keep one guard
(the self-exclusion in the counter) and add tests that only it can pass
(a retake entry in an earlier term; previewing a move of a planned
course). Lesson: a mutation that survives may mean a redundant defence,
not a missing test; decide which one owns the rule and delete the other,
or the suite can never show that the rule is enforced.

## `vitest run` on one spec file still boots the built server

`vitest.config.ts` sets `globalSetup: spec/global-setup.ts`, which spawns
`dist/server/entry.mjs`, so even a pure unit spec fails (or runs slow) with
no fresh build. For fast parser/engine loops use a scratch config outside
the repo with only `test.include` set, e.g. `pnpm exec vitest run --config
/tmp/x/vitest.config.ts --root . spec/parser.test.ts`, then finish with
`rm -rf dist && pnpm check` as usual. (vitest 4 has no `--globalSetup` CLI
flag to override it.)

## P&C course pages not offered in 2026 answer 302, not 404

Fetching `programsandcourses.anu.edu.au/2026/course/<CODE>` for codes such
as COMP2420, COMP3120, POLS2011, ACCT2101 returned HTTP 302 (a redirect)
rather than 404. A scraper that only treats 404 as "missing, fall back to
2025" would follow the redirect and parse whatever page it lands on. Treat
a 3xx on a course URL as missing for that year.

## better-sqlite3 turns foreign keys ON by default, so a table rebuild fails inside migrate()

Migration 0001 rebuilds `courses` (create `__new_courses`, copy, drop,
rename). Against a v1 database it failed at `DROP TABLE courses` because
`plan_entries` references it: better-sqlite3 is compiled with
`SQLITE_DEFAULT_FOREIGN_KEYS=1`, so FKs were on even though v1 never set the
pragma (the "v1 FKs were decorative" note in PLAN.md §2.3 is wrong --- they
were enforced all along). The sqlite3 CLI defaults them OFF, so the same SQL
applied fine by hand, which hid it. And `PRAGMA foreign_keys` is a no-op
inside a transaction, which drizzle's migrator opens, so the SQL file can't
fix it itself. Fix: `db.ts` sets `foreign_keys = OFF` before `migrate()`,
`ON` after, then runs `PRAGMA foreign_key_check` and refuses to boot on any
row. Only an empty-DB test would never have seen this; the boot-sync test
against a synthesized v1 DB is what caught it.

## Astro answers a form-typed request with no/foreign Origin with 403 before your handler runs

A test that POSTs `application/x-www-form-urlencoded` to check the app's own
415 `UNSUPPORTED_MEDIA` got 403 instead: Astro's `checkOrigin` rejects
form content types from a missing or foreign `Origin` first. The 415 path
is only reachable same-origin, so the test sends `Origin: <base>` like a
browser would. Both layers are real defences; just know which one a test is
exercising.

## A catalogue sensor can be pre-empted by the boot guard it duplicates

Mutating `catalogue/*.json` (a 0-unit course, an unknown period, a wrong
subject count) made `spec/catalogue.test.ts` "not go red" in a mutation
harness --- because `global-setup.ts`'s server refused to boot first
(`catalogue-sync.ts` validates every course), so no test ran at all. The
suite was red, but not for the reason being checked. Re-run such mutations
with a scratch config that has no `globalSetup` (see the vitest entry above)
to see the data test itself go red.
