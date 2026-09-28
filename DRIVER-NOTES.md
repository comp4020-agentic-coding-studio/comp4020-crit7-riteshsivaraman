# Driver notes --- crit 7

Not a spec, not a process account, not the harness. This is for me: what to
try differently this week, based on what actually went wrong in past
crits/assignments. Something to come back to when I'm stuck or about to
rubber-stamp something.

## Verify against reality, not the agent's report

Assignment 2's costliest miss wasn't a bug --- it was trusting a green suite
and "looks right" over actually looking at the deployed result. Several
builds ran clean, axe passed, no broken links, and the site still looked
wrong, because nothing in the suite could tell "referenced for content" apart
from "referenced for style."

This week: open `/graph/` myself and toggle a course in and out of the plan
rather than accepting "the tests pass" as the check. Check `/data/app.db`
directly with `sqlite3` when the question is "did it actually save," not the
agent's own account of the running app.

## Read back big approvals before they land

Seven replies into an ass2 session, a casual "looks good" turned out to have
quietly approved an entire information architecture decision --- the harness
was set up to flag vague *requests* but not vague *approvals*.

For the two structural calls this week --- the requisite-tree schema shape,
and the graph-layout approach --- ask the agent to restate what it's about to
do before saying yes. Not needed for seed-data typos or CSS tweaks.

## Delegate on "does this need my judgement," not "is there more than one step"

The rule that came out of a session that burned 154.5k of 200k tokens on
small fixes done inline instead of delegated: the test for handing something
to the agent unsupervised isn't step count, it's whether it needs my
judgement while it's being written.

- Inline / hand off freely: seed-data entry, CSS, boilerplate API routes.
- Watch closely: the requisite rule engine (`evaluateNode`/`isSatisfied`) ---
  a silently wrong AND/OR evaluation is exactly the kind of bug that passes
  every test that doesn't specifically target it.

## Don't let a reference for content become a reference for style

Pointing an agent at an existing page as a *content* reference ("pull real
requisite text from here") is fine. Pointing it at a page as a *structure*
reference risks it copying layout/styling too. If I hand over a real ANU
course page for requisite text, say explicitly: text only, not layout.

## This week's specific risk: the graph layout

The dependency-graph SVG is the piece most likely to balloon scope --- it's
the one part of the brief with no fixed shape. Timebox it. If it isn't clean
once the plan builder + rule engine + tests are solid, ship a simpler
list-based dependency view instead of iterating on layout. A working, honest
scope cut beats a half-finished ambitious one, and `README.md` already has a
place to say so.

## Cutoff: Wed 30 Sep, 08:30

Order of operations if time runs short, in priority order:
1. Schema + rule engine + its tests (`spec/requisites.test.ts`) --- this is
   the actual intellectual content of the brief.
2. Plan builder page + HTTP-level persistence test (`spec/plan.test.ts`).
3. Graph page (fall back to list view per above if needed).
4. `README.md`, `PROCESS.md`, `reflections/crit-7.md`, redeploy check.

Don't reorder this under time pressure --- a polished graph over a broken
rule engine is the wrong trade.
