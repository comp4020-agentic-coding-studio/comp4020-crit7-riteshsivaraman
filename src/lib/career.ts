// Undergraduate vs postgraduate, stored on the plan (plans.career). ANU teaches
// undergraduate courses at 1000-4000 level (4000 = honours) and postgraduate
// at 6000 (coursework), 8000 (advanced) and 9000 (research). There is no
// taught 5000 level: the only 5000 codes are exchange-program placeholders
// (COMP5920, EXCH5721, CBEA5921 ...), open to both careers.
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
  if (!career || (level >= 5000 && level < 6000)) return true; // exchange placeholders
  return career === "ug" ? level < 5000 : level >= 6000;
}

/** Level of a code when the catalogue entry isn't at hand ("COMP6442" -> 6000). */
export function levelOfCode(code: string): number {
  const m = /[A-Z]{4}(\d)/.exec(code);
  return m ? Number(m[1]) * 1000 : 1000;
}
