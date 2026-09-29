# ANU Degree Planner

A semester by semester planner for ANU courses. You place courses into a grid
of semesters, and the planner checks each one against its prerequisites,
corequisites, incompatible courses and the semesters it is offered in. A
problem shows up on the course card itself, with one short reason in plain
English. The Graph toggle shows the same plan as a force-directed graph, so
you can see which courses unlock which, and which pairs clash.

There is no login. Your plan is kept on the server under an anonymous cookie,
so it is tied to this browser.

## How to use it

1. Click any empty slot and search for a course by code or name. To move a
   course, drag its card to another empty slot.
2. Read the card. A red border means something needs fixing (a missing
   prerequisite, an incompatible course, or a semester the course is not
   offered in). An amber border means the planner cannot check the rule
   itself, for example a permission code or a program enrolment, so you
   should check it by hand.
3. Hover or focus a card to see its full requisites, the semesters it is
   offered in, its units and a short summary.
4. Switch to Graph to see the whole plan. Planned courses are solid nodes,
   and courses their rules mention are faded "ghost" nodes. A red edge with
   a ⊘ marks two incompatible courses. Untick "Incompatible courses" to hide
   the faded courses that only appear because they clash with your plan.
   Missing prerequisites and clashes inside your plan stay visible. You can add a course from the graph,
   add a ghost course to a semester, or move a planned course to another
   semester from its side panel.

## Where the data comes from

The catalogue was scraped once from ANU Programs and Courses
(programsandcourses.anu.edu.au, 2026 listings) on 30 September 2026 and
committed under `catalogue/`. The app does not fetch anything from ANU at
runtime. On every boot the server upserts the committed catalogue into its
SQLite database, so a new scrape reaches production with the next deploy.

The catalogue covers two colleges only: the **ANU College of Systems and
Society** and the **ANU College of Business and Economics**. That is 869
courses (850 listed in those colleges, plus 19 that their rules reference).
I cut the scope from every ANU course (about 2,900) to these two colleges so
the scrape and its checks fit the time I had. A course taught jointly with
another college is kept if either college matches. I show ANU's course
summaries only as short one-line summaries, not the full descriptions.

## What the planner checks

ANU writes requisites as free text, so each one is parsed into a rule tree.
Out of the 869 courses:

| Status | Courses | Meaning |
|---|---|---|
| Parsed | 468 | Every clause became a rule the planner checks. |
| Partial | 157 | Some clauses are checked, the rest are shown as ANU's own text. |
| Unparsed | 130 | Nothing could be modelled, so only ANU's text is shown. |
| No requisites | 114 | The course lists none. |

The rules that are **checked**: required courses, "one of" choices, unit
counts (including a minimum at a given level, and a count taken from a named
list of courses), corequisites that can be taken in the same semester,
incompatible courses, and the semesters a course is offered in.

The rules that are **warn-only** (amber, never red): permission codes,
program enrolment and grade or WAM requirements. 148 courses have at least
one of these. The planner cannot know these facts about you, so it flags
them. It also shows amber when a "one of" choice can only be met through
one of these branches.

Everything else is **unmodelled**. The planner shows ANU's original wording
and never guesses.

## Non-goals

- Degree, major and minor completion rules. The planner checks courses, not
  programs.
- Accounts, sharing links, more than one plan per browser, and export.
- Courses outside the two colleges above.
- Winter, autumn and spring sessions as rows. Offerings in those sessions
  are shown as text. Summer is an optional row.
- More than 4 courses in a semester, and dropping a course onto a slot that
  is already taken. To move a course, drag its card to an empty slot in the
  grid, or use "Move to semester…" in the graph.
- A graph of a whole subject. The graph shows your plan and the courses it
  references.
- Dark mode, and editing without JavaScript. Without JavaScript the plan
  renders read-only.

## What good looks like here

I decided good meant three things, in this order:

1. **A first-time visitor can use it without reading this page.** My first
   version worked, but it was a dropdown of 8 courses and "Satisfied/Unmet"
   badges with no reasons. So v2 has a first-run card, inline search in each
   slot, and a reason on every flagged card.
2. **It never gives a wrong answer with confidence.** If a rule cannot be
   parsed, the planner shows ANU's text instead of guessing, and rules it
   cannot check turn amber instead of red or green.
3. **What you save is really saved.** Plan state lives in SQLite on a Fly
   volume, and I checked it with `sqlite3` after a reload, a restart and a
   redeploy, not only by looking at the page.

The checks in `spec/` enforce the parts that can be tested: the requisite
parser and engine, the graph model (one edge per incompatible pair, ghost
nodes only for referenced courses), the plan API and its persistence, the
catalogue sync on boot, the design tokens and contrast, and that this README
is served in full at `/readme/`. The judgement calls are the visual design,
the wording of reasons, and where to cut scope. The rules I held the agent
to are in `CLAUDE.md`, and the stack gotchas it hit are in `LEARNINGS.md`.
