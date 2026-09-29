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
