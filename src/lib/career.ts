// Undergraduate vs postgraduate view (a per-browser preference, kept in
// localStorage by the Planner island). ANU numbers undergraduate courses at
// 1000-4000 level and postgraduate at 5000 and up. The filter only trims what
// is *offered* to the student (search results, incompatible ghosts, "can't be
// taken with" lists); planned courses and requisites are never hidden.
// Browser + server safe: no environment variables.

export type Career = "ug" | "pg";

export const CAREERS: { id: Career; label: string }[] = [
  { id: "ug", label: "Undergraduate" },
  { id: "pg", label: "Postgraduate" },
];

export function isCareer(v: unknown): v is Career {
  return v === "ug" || v === "pg";
}

/** Is a course at `level` (1000, 2000, ...) in this career? No career = everything. */
export function inCareer(level: number, career: Career | null | undefined): boolean {
  if (!career) return true;
  return career === "ug" ? level < 5000 : level >= 5000;
}

/** Level of a code when the catalogue entry isn't at hand ("COMP6442" -> 6000). */
export function levelOfCode(code: string): number {
  const m = /[A-Z]{4}(\d)/.exec(code);
  return m ? Number(m[1]) * 1000 : 1000;
}
