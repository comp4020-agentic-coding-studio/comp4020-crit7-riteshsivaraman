# Requisite taxonomy: engine vs. reality

Sources: `src/lib/schema.ts`, `src/lib/requisites.ts`, `src/lib/seed-data.ts`,
`spec/requisites.test.ts` (read in full); live pages fetched this session from
programsandcourses.anu.edu.au/2026 (falling back to /2025 where 2026 404'd)
across 30 COMP courses spanning 1000–8000 level, including the brief's named
complex cases (COMP2120, COMP2310, COMP3600, COMP3710, COMP3770, COMP4450,
COMP4500, COMP4550, COMP4020). COMP3700, COMP3720, COMP3800, COMP8730,
COMP8420 returned 404 on both years and were skipped, not fabricated.

## 1. Supported today

Schema (`schema.ts`): `requisiteNodes` is a flat table forming a tree per
course (`parentId` links), plus a separate flat `incompatibilities` table.

| Node/rule kind | Storage | Evaluation (`requisites.ts`) |
|---|---|---|
| `COURSE` | leaf, `refCourseCode` | true iff that code is in `plannedBefore` — i.e. has a plan entry with `termIndex` strictly **less than** the course's own term. Same-term or later-term doesn't count (test: "does not count a course planned in the same or a later term"). No corequisite concept — nothing can be satisfied by "currently studying." |
| `UNIT_COUNT` | leaf, `unitSubject` + `unitCount` | sums `units` of all courses in `plannedBefore` whose `subject` matches, compares `>= unitCount`. Subject-scoped only (e.g. "COMP", "MATH") — no level filter (e.g. can't express "2000-level COMP" or "3000-and-4000-level COMP"), no "from this specific list of courses" scoping. |
| `AND` | internal, children via `parentId` | all children must evaluate true; empty children list is **false** (guards against a childless AND silently passing). |
| `OR` | internal, children via `parentId` | any child true; empty children list is false (`.some` on `[]`). Nesting is arbitrary depth (COMP3600 seed data nests OR inside AND). |
| Incompatibility | separate table, `blockedByCode` | true (blocking) if that code is a plan entry in **any** term, before or after — test explicitly checks a same-course-later-term blocker still flags (`"flags an incompatibility regardless of which term the blocker is in"`). Not part of the AND/OR tree — always evaluated as a second, independent check. |
| No requisite row for a course | — | `requisitesSatisfied: true` (vacuously) |

Not supported at all (no schema field, no node kind): corequisites,
program/plan enrolment checks, grade/WAM thresholds, total-units-completed
(any subject), permission/convenor gating, level-scoped unit counts,
counting units from a named subset of courses rather than a whole subject,
mutual-exclusivity between an undergrad/postgrad pair as a first-class
concept (currently only representable as two one-way `incompatibilities`
rows), free-text/non-binding assumed knowledge.

## 2. Observed in Programs & Courses

| Pattern | Example (verbatim, course) | Freq. in sample (~30 courses) | Engine supports? | Proposed representation |
|---|---|---|---|---|
| Single-course prereq | "must have completed COMP1130" (COMP1140) | 6 | Yes | `COURSE` node |
| OR of courses | "COMP1100 OR COMP1130 OR COMP1730" (COMP1110) | 9 | Yes | `OR` of `COURSE` children |
| AND of course + unit-count | "COMP1110 or COMP1140 AND 6 units of 1000 level MATH" (COMP2100) | 5 | Yes | existing seed pattern, already modeled |
| Unit count, subject-only | "24 units of COMP coded courses" (COMP3600) | 4 | Partial — subject match works, but real text almost always also has a level | `UNIT_COUNT` (as-is, ignoring level) |
| **Unit count, level-scoped** | "12 units of 2000 level COMP courses" (COMP2700) | 5 | **No** — schema has no level field | Add `unitLevel` (nullable int, e.g. 2000) to `UNIT_COUNT`; filter courses by `Math.floor(code_number/1000)*1000 == unitLevel` in addition to subject |
| **Unit count from a named course list** | "6 units of (COMP3600 OR COMP3540 OR COMP3900 OR COMP3320)" (COMP4610) | 2 | **No** — `UNIT_COUNT` can't scope to a list, only a subject string | New node kind `UNIT_COUNT_FROM_SET` with a child list of course codes; sum units of any planned-before member |
| **Corequisite ("completed or currently studying")** | "have successfully completed or be currently studying COMP2100" (COMP2120) | 3 | **No** — `COURSE` only checks strictly-earlier term | Add `allowSameTerm: boolean` flag on `COURSE` node, or a distinct `COREQUISITE` kind reusing `refCourseCode` |
| Incompatibility (simple) | "Incompatible with COMP1130" (COMP1100) | 20+ | Yes | existing `incompatibilities` row |
| Incompatibility (co-taught pg/ug pair) | "Incompatible with COMP6300, ENGN2219 and COMP6719" (COMP2300) | ~15 | Yes (one row per blocker) | as-is; could add a `pairKind: "co-taught"` tag for UI grouping only |
| **Program/plan enrolment gate** | "must be enrolled in the: Bachelor of Computing (Honours) (HCOMP)... or Bachelor of Advanced Computing (AACOM), with 24 units of COMP-coded courses already passed" (COMP4450) | 4 | **No** — no concept of a student's program at all | New node kind `PROGRAM_ENROLMENT` (list of accepted program codes) — needs a `program` field on the (currently nonexistent) student/user model; out of scope without that |
| **Permission/convenor code required** | "You will need to contact the School of Computing to request a permission code" (COMP3710, COMP4020, COMP4610) | 6 | **No** — not a checkable rule, it's a manual gate | Flag as `requiresPermissionCode: boolean` on the course, surfaced as a warning banner, not blocking plan validity |
| **Project/supervisor + WAM threshold** | "have a weighted average mark equivalent to an ANU 70 per cent" (COMP4550) | 2 | **No** — no grade data anywhere in schema | Out of scope for this engine (no grade tracking); flag as free-text |
| **Multi-pathway program+course AND** | "Master of Computing: completed COMP6442 or COMP2100, plus COMP8260 or COMP8280" (COMP8715) | 3 | **No** — combines program gate + OR courses | Composable once `PROGRAM_ENROLMENT` exists: `OR( AND(PROGRAM_ENROLMENT, COURSE_OR...) , AND(...) )` |
| Mutually exclusive ug/pg co-taught variant | COMP1100↔COMP1130, COMP2100↔COMP6442 | 10+ | Yes | same as simple incompatibility; both directions need two rows (seed data already does this for COMP1100/1130) |
| Assumed knowledge (non-binding) | "ACT Maths Methods major or NSW Mathematics or equivalent" (COMP1100) | most courses | N/A (correctly out of scope — not enforced by ANU either) | Do not model; keep as descriptive text only |
| Nested nothing-found / dead course code | COMP3700, COMP3720, COMP3800, COMP8730, COMP8420 all 404 | 5 | N/A | Not a requisite pattern — flag as "course code stale/renamed, verify before seeding" |

## 3. Gaps & proposed rule-node extensions (priority order)

1. **Level-scoped unit counts** — highest frequency real gap (COMP2700,
   COMP3900, COMP3610, COMP3600's "24 units of COMP" is arguably level-free
   but most others specify a level band). Needs one new nullable column.
2. **Corequisite ("or currently studying")** — appears on several 2000/3000
   courses feeding into 2000-level sequences; currently silently
   under-modeled as a same-term failure, which would make the app wrongly
   block valid same-term concurrent enrolment.
3. **Unit count from an explicit course list** rather than a whole subject
   (COMP4610-style) — needs a new node kind with child course references.
4. **Permission-code / convenor-approval flag** — not a boolean requisite
   but affects whether "satisfied" should still show a warning; cheap to add
   as a course-level flag, shouldn't block plan validity.
5. **Program enrolment gate** — the biggest structural gap, but only matters
   for honours/4000-level and postgrad courses; deferred because the app has
   no student/program model at all yet.

## 4. Unparseable / free-text cases to flag for human review

- COMP4550: WAM/GPA threshold computed from "best 36 units in cognate
  disciplines" — needs a human definition of "cognate," not just a number.
- COMP3770 / COMP4450 / COMP8715: "secure a project and supervisor" /
  "belong to a student project group... approved by the convener" — process
  steps, not enforceable prerequisites in this data model.
- COMP3610: entire requisite text is "contact the School of Computing to
  request a permission code" — no enrolable prerequisite logic exists on
  the page at all.
- COMP8715/COMP4020: "further prerequisites... will be posted... once the
  topic is announced" — requisite is deliberately unspecified until a later
  point; can't be seeded ahead of time.
- Course codes that 404'd this session (COMP3700, COMP3720, COMP3800,
  COMP8730, COMP8420) — before trusting any future seed data for these,
  re-verify the code is still current in the P&C catalogue search rather
  than assuming the direct URL pattern always resolves.
