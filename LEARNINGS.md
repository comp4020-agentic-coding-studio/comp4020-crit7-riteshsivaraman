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
