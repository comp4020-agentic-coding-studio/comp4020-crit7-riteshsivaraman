# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the starter is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec. Read them before you plan or build;
what the agent needs to carry from any of it is your call.

## Full-stack verification

Before calling any new piece of state "done", name where it actually lives
(DB row, in-memory, session, etc.) and check --- not assume from reading the
code --- that it survives a reload, a server restart, and a redeploy.

"Did it save?" gets checked against `/data/app.db` directly with `sqlite3`,
never trusted from the agent's own report that the running app looks right.

Any rename of a form field or handler param gets tested with a real browser
submission, not just an API-level spec test that POSTs the new field name
directly --- that bypasses the actual failure mode (form still sends the old
name, server silently drops the value, no exception anywhere).

Anything that touches `process.env` gets a one-line note on whether that code
runs server-only or ships to the browser. The Fly token lives only in
`mise.local.toml` (gitignored) --- never in a tracked file. Deploys are manual
(`flyctl deploy`) while the repo is private; CI takes over once `/ship` flips
it public.

## The defect loop

When something breaks: report the symptom, not your diagnosis of it. Add the
sensor that should have caught it *before* fixing the bug. Name the bug
class, not the instance, so the fix doesn't grow back in a different shape.

A green suite is a claim to check, not evidence on its own. Periodically ask
"what would have to break for this check to go red?" --- if nothing, the
check itself is the bug.

For anything the agent wrote but I didn't watch it write: mutate it on
purpose, confirm it goes red for the right reason, then restore it.

## Plan before build

One short planning pass before implementation --- scope, the pages/routes
involved, where new state will live --- even for a small build. `PLAN.md` is
that pass for this week. If a build turns out to have genuinely distinct
subsystems, escalate to keeping plan and build in separate sessions
(`/clear` between them) rather than defaulting into that machinery for
something small.

## Stack gotchas

Stack-specific gotchas (stale build caches, a CI `deploy` job that re-runs
the build so a break takes prod down rather than just failing a check, etc.)
go in `LEARNINGS.md` as they're found. Append-only, never delete an entry.
This file points there instead of absorbing it, so it doesn't bloat.
