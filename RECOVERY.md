# Credit-out recovery protocol (crit 7, 2026-09-30)

For when the course budget ($100/week, resets Thu 1 Oct 09:00) runs out
mid-build and Ritesh switches to his personal Claude plan. The crit is due
~4 h after 02:45 AEST on 2026-09-30, so aim for a shipped app, not full scope.

## 0. How you'll know

- Agents or the main session fail with a budget/402 error from
  `strproxy.comp.anu.edu.au`, or background agents stop with no report.
- **Every background agent dies at the same moment**, because they share the
  session's key. Work is only safe if it's committed; each track was told to
  commit in increments.

## 1. Switch credentials (Ritesh, ~2 min)

The course key is set per project in `.claude/settings.local.json` (`env`:
`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL=claude-sonnet-5`).

1. Quit Claude Code.
2. `mv .claude/settings.local.json .claude/settings.local.json.course` (put
   it back after the crit, or on Thursday's reset).
3. Check the shell has no leftovers: `env | grep ANTHROPIC` should be empty
   (note that `ANTHROPIC_MODEL=Sonnet 5` was set in the shell too; `unset` it).
4. Run `claude`, then `/login` with the personal account, then `/model` and pick the model.
5. First prompt: "Read RECOVERY.md and HANDOFF.md, then run §2."

## 2. Triage (new session, ~5 min, read-only)

Run this before dispatching anything:

```sh
cd "…/Crits/comp4020-crit7-riteshsivaraman"
git log --oneline -8 main
git worktree list
for w in ../crit7-a ../crit7-d ../crit7-e; do
  echo "== $w"; git -C "$w" log --oneline main..HEAD; git -C "$w" status --short | head
done
lsof -nP -iTCP -sTCP:LISTEN | grep node   # ignore 4321/4322 (comp4020-ass2)
ps aux | grep -E 'scrape|build-catalogue' | grep -v grep
```

For each track, sort it into one of three states:
- **Done:** final commit plus a green `rm -rf dist && pnpm check` in its worktree. Merge it.
- **Partial, committed:** resume in the same worktree with a fresh agent.
  Tell it which commits exist and what's left, per `PLAN.md` §5.3.
- **Partial, uncommitted:** look at the diff. If it builds, commit it as WIP;
  otherwise `git stash` it (don't discard) and resume from the last commit.

Stop any orphaned dev servers from this repo's worktrees with
`pnpm exec astro dev stop` run in that worktree.

## 3. Track state (update as tracks land)

| Track | Branch / worktree | State |
|---|---|---|
| W0, B, C, amber | merged to main (`91efea9`) | done |
| A data | `v2-a-data` / `../crit7-a` | merged to main (f4669d1), catalogue 869 courses CSS+CBE, version 84be3f66 |
| D planner | `v2-d-planner` / `../crit7-d` | running, port 4441, timebox 75 min |
| E graph | `v2-e-graph` / `../crit7-e` | running, port 4442, timebox 75 min |
| F integrate | none yet | not started |

Merge order: A → D → E → F. Each merge: `rm -rf dist && pnpm install &&
pnpm check` on main; keep every LEARNINGS.md entry from both sides.

## 4. Cut order if time or credit is tight (last thing gets cut first)

1. Keep: planner grid with add/remove, violations on cards, persistence,
   deploy. **This is the minimum shippable app.**
2. Keep if possible: the graph view (plan and ghost nodes, incompatibility edges).
3. Cut first: add/move from inside the graph, summer rows, graph drag polish,
   the 375px sheet polish. Record anything cut in the README's non-goals.

Personal-plan economy: Sonnet for merges, checks, README and deploy; use Opus
only for a broken merge or a real bug. Fewer, longer sessions beat many short
ones.

## 5. Ship checklist (F); each outward step needs Ritesh's yes

1. `rm -rf dist && pnpm check` green on main; `pnpm check:evidence` run.
2. README rewritten per PLAN.md §5.3 F: what it is, source + scrape date,
   **CSS + CBE scope**, modelled / warn-only / unmodelled counts, non-goals.
   `/readme/` must serve all of it (readme.test.ts).
3. **[ask]** `mise exec -- flyctl deploy --remote-only --ha=false -a
   comp4020-crit7-riteshsivaraman`. The Fly token is in `mise.local.toml`
   only; never put it in a tracked file.
4. Prod checks: the boot log shows the sync line; `flyctl ssh console` then `sqlite3
   /data/app.db "SELECT value FROM meta WHERE key='catalogue_version'"`
   matches `catalogue/index.json`; add a course on the live URL in a real
   browser, `PRAGMA wal_checkpoint(FULL)`, and see the row in
   `plan_entries`; it survives `flyctl machine restart` and a redeploy.
5. **[ask]** `/comp4020:ship` flips the repo public; CI then takes over deploys.
   Then run `/comp4020:preflight`.

## 6. Process and reflection (don't let these drop)

- `PROCESS.md` is currently the **template** (check:evidence flags it). Fill it
  in: what was built, how it got here (plan v1 → v2 redesign, orchestrator plus
  parallel worktree tracks, the defects caught: hung scraper with no
  timeout, stale dist, weak assertions caught by mutation), citing commit
  hashes as links to the repo's commit/compare URLs.
- `reflections/crit-7.md` is **Ritesh's own voice**, 150–300 words on the two
  prompts (breakthrough; who I want to be as a developer). An agent may
  draft only after reading `~/.claude/memory/user_writing_voice.md`, and
  Ritesh edits it before it ships.
- Decisions made this session worth citing in PROCESS.md: graph plan-only
  with ghost nodes plus add/move from the graph; unverifiable-OR → amber;
  catalogue cut to CSS + CBE; `--warn-line` darkened to 3:1; D/E started
  before A merged to hit the deadline.
- Material for the reflection: the orchestrator-only model, the stuck scraper
  (a symptom-first report led to a sensor, then the fix), and credit
  budgeting as a real engineering constraint.
