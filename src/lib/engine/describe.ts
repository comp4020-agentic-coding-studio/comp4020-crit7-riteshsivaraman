// Plain-English rendering of a Rule (PLAN.md §3.1 describeRule) and the short
// (<= 32 char) card strings. Codes are rendered as codes whether or not the
// catalogue index knows them: a rule can reference a course that 404'd in
// both catalogue years, or one outside an island's embedded neighbourhood.
//
// Browser-safe: no node: imports, no DB, no environment variables.

import type { CatalogueIndex, Rule } from "../contracts";

export const SHORT_MAX = 32;

function list(items: string[], conj: "and" | "or"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`;
}

function levelText(levels: number[]): string {
  // [2000] -> "2000-level"; [3000, 4000] -> "3000- or 4000-level"
  const parts = levels.map((l, i) => (i === levels.length - 1 ? `${l}-level` : `${l}-`));
  return list(parts, "or");
}

function unitsText(rule: Extract<Rule, { kind: "UNITS" }>): string {
  let text: string;
  if (rule.from) {
    text = `${rule.min} units from ${list(rule.from, "or")}`;
  } else {
    const level = rule.levels?.length ? `${levelText(rule.levels)} ` : "";
    const subject = rule.subject ? `${rule.subject} ` : "";
    const any = !level && !subject ? "any " : "";
    text = `${rule.min} units of ${any}${level}${subject}courses`;
  }
  return rule.concurrent ? `${text} (same-term courses count)` : text;
}

function infoText(rule: Extract<Rule, { kind: "INFO" }>): string {
  switch (rule.info) {
    case "PERMISSION":
      return "a permission code (not checked)";
    case "PROGRAM":
      return rule.programs?.length
        ? `enrolment in ${list(rule.programs, "or")} (not checked)`
        : `program enrolment: “${rule.text}” (not checked)`;
    case "GRADE":
      return rule.wam !== undefined
        ? `a WAM of at least ${rule.wam} (not checked)`
        : `a grade requirement: “${rule.text}” (not checked)`;
  }
}

function describeNode(rule: Rule, nested: boolean): string {
  switch (rule.kind) {
    case "COURSE":
      return rule.concurrent ? `${rule.code} (completed or same term)` : rule.code;
    case "UNITS":
      return unitsText(rule);
    case "AND":
    case "OR": {
      const text = list(
        rule.children.map((c) => describeNode(c, true)),
        rule.kind === "AND" ? "and" : "or",
      );
      return nested ? `(${text})` : text;
    }
    case "INFO":
      return infoText(rule);
    case "UNMODELLED":
      return `“${rule.text}” (not checked; see official requisites)`;
  }
}

/** Plain English. `cat` is accepted for the contract; unknown codes render as-is. */
export function describeRule(rule: Rule, cat: CatalogueIndex): string {
  void cat;
  return describeNode(rule, false);
}

/** First candidate that fits on a card, else the generic fallback. */
export function fitShort(...candidates: string[]): string {
  return candidates.find((c) => c.length <= SHORT_MAX) ?? "Requisites not met";
}

/** Card string for a MISSING_REQUISITE issue's `missing` rule. */
export function missingShort(rule: Rule): string {
  switch (rule.kind) {
    case "COURSE":
      return fitShort(rule.concurrent ? `Needs ${rule.code} by this term` : `Needs ${rule.code} first`);
    case "UNITS": {
      if (rule.from) return fitShort(`Needs ${rule.min} units from list`);
      const subject = rule.subject ? `${rule.subject} ` : "";
      const level = rule.levels?.length ? `${rule.levels.join("/")}-level ` : "";
      return fitShort(
        `Needs ${rule.min} ${level}${subject}units`,
        `Needs ${rule.min} ${subject}units`,
        "Needs more units",
      );
    }
    case "OR": {
      const codes = rule.children.flatMap((c) => (c.kind === "COURSE" ? [c.code] : []));
      if (codes.length === rule.children.length) {
        return fitShort(`Needs ${list(codes, "or")}`, `Needs one of ${codes.length} courses`);
      }
      return fitShort(`Needs one of ${rule.children.length} options`);
    }
    case "AND": {
      const first = missingShort(rule.children[0]!);
      const more = rule.children.length - 1;
      return fitShort(`${first} +${more}`, first);
    }
    default:
      return "Requisites not met";
  }
}

type InfoRule = Extract<Rule, { kind: "INFO" }>;

/** Short phrase for the missing part of one checkable branch, or null if it has no compact form. */
function branchPhrase(rule: Rule): string | null {
  switch (rule.kind) {
    case "COURSE":
      return rule.code;
    case "UNITS":
      if (rule.from) return null;
      return `${rule.min} ${rule.subject ? `${rule.subject} ` : ""}units`;
    case "OR": {
      const codes = rule.children.flatMap((c) => (c.kind === "COURSE" ? [c.code] : []));
      return codes.length === rule.children.length ? list(codes, "or") : null;
    }
    default:
      return null;
  }
}

function infoLabel(rule: InfoRule, specific: boolean): string {
  switch (rule.info) {
    case "PROGRAM":
      return specific && rule.programs?.length === 1 ? `program ${rule.programs[0]}` : "a program";
    case "PERMISSION":
      return specific ? "a permission code" : "permission";
    case "GRADE":
      return specific && rule.wam !== undefined ? `WAM ${rule.wam}+` : "a WAM";
  }
}

/**
 * Card string for an UNVERIFIED_REQUISITE: an OR met only through an INFO
 * branch. `missing` is the unmet part of each checkable branch.
 */
export function unverifiedShort(missing: Rule[], infos: InfoRule[]): string {
  const first = infos[0]!;
  const specific = infoLabel(first, infos.length === 1);
  const generic = infoLabel(first, false);
  const phrases = missing.map(branchPhrase);
  const candidates: string[] = [];
  if (phrases.every((p): p is string => p !== null)) {
    const text = list(phrases, "or");
    candidates.push(`Needs ${text} or ${specific}`, `Needs ${text} or ${generic}`);
  }
  candidates.push(`Needs requisites or ${generic}`);
  return candidates.find((c) => c.length <= SHORT_MAX) ?? "Requisite not verifiable";
}

/** Popover text: the unmet checkable alternatives, then the unverifiable ones. */
export function unverifiedDetail(checkable: Rule[], infos: InfoRule[]): string {
  const unmet = list(
    checkable.map((c) => describeNode(c, true)),
    "or",
  );
  const via = list(infos.map(infoText), "or");
  return `None of the checkable options is in the plan: ${unmet}. It can only be met by ${via}.`;
}
