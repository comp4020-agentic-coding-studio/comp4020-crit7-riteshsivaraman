import type { Course, Incompatibility, RequisiteNode } from "./schema";

// A small real slice of the ANU CS catalogue, not the live catalogue. Every
// requisite/title/unit value here was fetched live from
// programsandcourses.anu.edu.au this session — see LEARNINGS.md and
// README.md for the one deliberate adaptation (COMP2100's real prerequisite
// names COMP1110, which isn't in this seeded slice; COMP1100 stands in for
// it as the equivalent-tier entry course).

export const seedCourses: Course[] = [
  { code: "COMP1100", subject: "COMP", title: "Programming as Problem Solving", units: 6 },
  { code: "COMP1130", subject: "COMP", title: "Programming as Problem Solving (Advanced)", units: 6 },
  { code: "COMP1140", subject: "COMP", title: "Structured Programming (Advanced)", units: 6 },
  { code: "MATH1013", subject: "MATH", title: "Mathematics and Applications 1", units: 6 },
  { code: "MATH1014", subject: "MATH", title: "Mathematics and Applications 2", units: 6 },
  { code: "COMP1600", subject: "COMP", title: "Foundations of Computing", units: 6 },
  { code: "COMP2100", subject: "COMP", title: "Software Design Methodologies", units: 6 },
  { code: "COMP3600", subject: "COMP", title: "Algorithms", units: 6 },
];

// COMP1100 and COMP1130 are ANU's two intro-programming streams and each
// lists the other as incompatible.
export const seedIncompatibilities: Incompatibility[] = [
  { id: 1, courseCode: "COMP1100", blockedByCode: "COMP1130" },
  { id: 2, courseCode: "COMP1130", blockedByCode: "COMP1100" },
];

// Explicit ids (not DB autoincrement) so this data --- and the rule engine
// tests against it --- needs no database at all.
export const seedRequisiteNodes: RequisiteNode[] = [
  // COMP1140 requires COMP1130.
  {
    id: 1,
    courseCode: "COMP1140",
    parentId: null,
    kind: "COURSE",
    refCourseCode: "COMP1130",
    unitSubject: null,
    unitCount: null,
  },

  // COMP2100 requires (COMP1100 OR COMP1140) AND 6 units of 1000-level MATH.
  {
    id: 2,
    courseCode: "COMP2100",
    parentId: null,
    kind: "AND",
    refCourseCode: null,
    unitSubject: null,
    unitCount: null,
  },
  {
    id: 3,
    courseCode: "COMP2100",
    parentId: 2,
    kind: "OR",
    refCourseCode: null,
    unitSubject: null,
    unitCount: null,
  },
  {
    id: 4,
    courseCode: "COMP2100",
    parentId: 3,
    kind: "COURSE",
    refCourseCode: "COMP1100",
    unitSubject: null,
    unitCount: null,
  },
  {
    id: 5,
    courseCode: "COMP2100",
    parentId: 3,
    kind: "COURSE",
    refCourseCode: "COMP1140",
    unitSubject: null,
    unitCount: null,
  },
  {
    id: 6,
    courseCode: "COMP2100",
    parentId: 2,
    kind: "UNIT_COUNT",
    refCourseCode: null,
    unitSubject: "MATH",
    unitCount: 6,
  },

  // COMP3600 requires 24 units of COMP AND (6 units of MATH OR COMP1600).
  {
    id: 7,
    courseCode: "COMP3600",
    parentId: null,
    kind: "AND",
    refCourseCode: null,
    unitSubject: null,
    unitCount: null,
  },
  {
    id: 8,
    courseCode: "COMP3600",
    parentId: 7,
    kind: "UNIT_COUNT",
    refCourseCode: null,
    unitSubject: "COMP",
    unitCount: 24,
  },
  {
    id: 9,
    courseCode: "COMP3600",
    parentId: 7,
    kind: "OR",
    refCourseCode: null,
    unitSubject: null,
    unitCount: null,
  },
  {
    id: 10,
    courseCode: "COMP3600",
    parentId: 9,
    kind: "UNIT_COUNT",
    refCourseCode: null,
    unitSubject: "MATH",
    unitCount: 6,
  },
  {
    id: 11,
    courseCode: "COMP3600",
    parentId: 9,
    kind: "COURSE",
    refCourseCode: "COMP1600",
    unitSubject: null,
    unitCount: null,
  },
];
