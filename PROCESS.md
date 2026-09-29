# Process overview

## What I built

Programs and Courses shows requisites as prose, one course page at a time,
so checking a degree plan means opening every page and working the order out
by hand. This is why I built a degree planner. A student places courses into
a grid of semesters, and each card says in plain English what is missing,
what clashes and when the course is offered. It covers course selection,
wired end to end. Plans live in SQLite through Drizzle and migrations, and I
checked the live rows with `sqlite3` after a reload, a restart and a
redeploy.

## The moments that mattered

### 1. The scraper that hung

The first full scrape sat for 57 minutes with nothing written. I reported
only that, and the cause was a `fetch` with no timeout. The sensor came
before the fix, a local server that never replies
([`309fa2a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-riteshsivaraman/commit/309fa2a)).
The resumed run then ran out of memory at course 740, which only the full run
could show
([`a791b2c`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-riteshsivaraman/commit/a791b2c)).

### 2. Planning my own degree in it

With the suite passing, I planned my own degree in the app. The agent said
COMP3770 was 6 units, because the catalogue says so. However, I knew it was
12, and its summary calls it an "Annual course (6+6)". This became the rule
for courses that span two semesters
([`338b6e9`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-riteshsivaraman/commit/338b6e9)).
Postgraduate clashes also cluttered my undergraduate plan, so a plan now
stores the student's level and the server enforces it
([`19b9899`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-riteshsivaraman/commit/19b9899)).
