// Requisite prose -> Rule (PLAN.md §2.5 parser contract).
//
// A node is emitted only when a grammar production matches the WHOLE clause;
// anything else becomes UNMODELLED with the verbatim clause. Nothing is
// guessed: a clause we can't read stays text, and the course reads "partial"
// or "unparsed" so the UI shows the official wording.
//
// Shape of the input (programsandcourses.anu.edu.au "Requisite and
// Incompatibility" block): sentences. Each sentence is one of
//   - incompatibility ("Incompatible with X", "You are not able to enrol ...
//     if you have completed X") -> codes go to `incompatible`, never the rule
//   - advisory (assumed knowledge, "It is recommended") -> dropped
//   - requirement ("To enrol in this course you must have completed: ...")
//     -> an expression over courses, unit counts, programs, WAM, permission
//   - a continuation starting "AND"/"OR" that joins the previous requirement
//     at the top level (P&C sometimes breaks one rule across sentences)
//   - anything else -> UNMODELLED
// Sentence rules are ANDed.
//
// Expression precedence (loosest first), from the real 2026 prose:
//   1. ";"                              clause separators
//   2. ", and" / ", or"                 clause separators
//   3. "and"/"or" followed by a verb    ("... AND have completed", "OR be enrolled")
//   4. UPPERCASE AND/OR, when lowercase connectives also appear at that level
//   5. plain and/or
// Levels 1-3 join clauses, so AND binds tighter than OR there (ordinary
// English). Levels 4-5 join operands, where P&C writes "A or B AND C" to mean
// (A or B) and C (COMP2100, COMP1600, COMP2310), so OR binds tighter. If every
// connective in a span is the same operator, precedence is moot and the span
// is one flat AND/OR.
//
// Browser-safe: no node: imports, no DB, no environment variables.

import type { ParseStatus, Rule } from "../contracts";

type Mode = "completed" | "concurrent" | "enrolled";
type Op = "AND" | "OR";

const CODE = "[A-Z]{4}\\d{4}";
const CODE_G = new RegExp(`\\b${CODE}\\b`, "g");

// ---------------------------------------------------------------------------
// Placeholders: spans the splitter must not break (a connective that belongs
// to a phrase, not to the rule) are swapped for <n> and restored
// before a clause is matched or shown.
// ---------------------------------------------------------------------------

class Protector {
  private table: string[] = [];

  protect(text: string, re: RegExp): string {
    return text.replace(re, (m) => {
      this.table.push(m);
      return `${this.table.length - 1}`;
    });
  }

  restore(text: string): string {
    return text.replace(/(\d+)/g, (_, i: string) => this.restore(this.table[Number(i)]!));
  }
}

// "completed or be currently studying", "completed or concurrent enrolment in"
const CONCURRENT_VERB =
  /(?:have\s+)*(?:(?:previously|successfully)\s+)*completed\s*,?\s+or\s+(?:be\s+|are\s+)?(?:currently|concurrently)\s+(?:studying|enrolled\s+in|completing|enrolling\s+in|taking)|(?:have\s+)*completed\s+or\s+concurrent(?:ly)?\s+enrol(?:ment|led)?\s+in/gi;
// "6 units from COMP1100 or COMP1130 or COMP1730"
const UNITS_FROM_LIST = new RegExp(
  `\\b\\d+\\s+units?\\s+from\\s+(?:the\\s+following(?:\\s+courses)?\\s*:?\\s*)?${CODE}(?:(?:\\s*,\\s*(?:or\\s+)?|\\s+or\\s+)${CODE})*`,
  "gi",
);
// "Machine Learning and Computer Vision" (program / course titles)
const TITLE_AND = /(?<=\b[A-Z][a-z]+) and (?=[A-Z][a-z]+)/g;
// "60 or above", "or equivalent"
const OR_QUALIFIER = / or (?=(?:above|higher|more|greater|better|equivalent)\b)/gi;
// "3000 and/or 4000 level", "3000/4000", "3000 or 4000"
const LEVEL_JOIN = /(?<=\b\d000(?:-level)?)\s*(?:and\/or|or|and|,)\s*(?=\d000\b)/gi;
// "12 units of COMP or MATH courses": one pooled count we can't express, so it
// must stay one clause rather than split into "12 units of COMP" or "MATH courses"
const UNITS_SUBJECT_LIST =
  /\b\d+\s+units?\s+(?:of\s+)?(?:\d000\s*-?\s*level\s+)?\(?[A-Z]{4}(?:\s*(?:,|or|and|and\/or|OR|AND)\s*[A-Z]{4})+\b/g;
// "PHYS1101 or be doing it concurrently"
const DOING_IT = / or (?=be doing (?:it|so) concurrently\b)/gi;

// ---------------------------------------------------------------------------
// Leading verbs and fillers
// ---------------------------------------------------------------------------

const CONCURRENT_VERB_ONLY = new RegExp(`^(?:${CONCURRENT_VERB.source})$`, "i");
const LEAD: { re: RegExp; mode?: Mode; list?: true }[] = [
  { re: /^(?:either|also)\s*:?\s*/i },
  { re: /^have\s+(?:either|also)\s*:?\s*(?=(?:(?:previously|successfully)\s+)*(?:completed|passed)\b)/i },
  { re: /^(?:(?:at\s+least\s+)?one|any(?:\s+one)?)\s+of(?:\s+the\s+following)?(?:\s+courses)?\s*:?\s*/i, list: true },
  { re: /^(?:be\s+|are\s+)?(?:currently|concurrently)\s+(?:studying|enrolled\s+in|completing|taking)\s*:?\s*/i, mode: "concurrent" },
  { re: /^(?:be\s+)?(?:studying|enrolled\s+in)(?:\s+(?:the|a|an))?\s*:?\s*/i, mode: "enrolled" },
  {
    re: /^(?:have\s+)*(?:(?:previously|successfully)\s+)*(?:completed|passed)(?:\s+the\s+following(?:\s+courses)?)?\s*:?\s*/i,
    mode: "completed",
  },
];

interface Lead {
  text: string;
  mode: Mode;
  list: boolean;
}

function stripLead(text: string, mode: Mode, p: Protector): Lead {
  let list = false;
  for (;;) {
    const ph = /^(\d+)\s*:?\s*/.exec(text);
    if (ph && CONCURRENT_VERB_ONLY.test(p.restore(ph[0]).replace(/\s*:?\s*$/, ""))) {
      text = text.slice(ph[0].length);
      mode = "concurrent";
      continue;
    }
    const hit = LEAD.find((l) => l.re.test(text));
    if (!hit) break;
    const next = text.replace(hit.re, "");
    if (next === text) break;
    text = next;
    if (hit.mode) mode = hit.mode;
    if (hit.list) list = true;
  }
  return { text: text.trim(), mode, list };
}

// A connective followed by one of these starts a new clause (level 3).
const VERB_START = /^(?:\d+|have|has|be|are|must|find|meet|hold|obtain|receive|secure|gain(?:ed)?)\b/i;

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

const unmodelled = (text: string): Rule => ({ kind: "UNMODELLED", text });

function mergePrograms(children: Rule[]): Rule[] {
  const progs = children.filter(
    (c): c is Extract<Rule, { kind: "INFO" }> => c.kind === "INFO" && c.info === "PROGRAM",
  );
  if (progs.length < 2) return children;
  const programs = [...new Set(progs.flatMap((c) => c.programs ?? []))];
  const merged: Rule = {
    kind: "INFO",
    info: "PROGRAM",
    text: progs.map((c) => c.text).join(" or "),
    ...(programs.length ? { programs } : {}),
  };
  const out: Rule[] = [];
  let placed = false;
  for (const c of children) {
    if (c.kind === "INFO" && c.info === "PROGRAM") {
      if (!placed) out.push(merged);
      placed = true;
    } else out.push(c);
  }
  return out;
}

function combine(op: Op, children: Rule[]): Rule {
  let flat = children.flatMap((c) => (c.kind === op ? c.children : [c]));
  if (op === "OR") flat = mergePrograms(flat);
  return flat.length === 1 ? flat[0]! : { kind: op, children: flat };
}

/** Join parts with per-gap operators; `tight` binds before the other op. */
function group(parts: Rule[], ops: Op[], tight: Op): Rule {
  const loose: Op = tight === "AND" ? "OR" : "AND";
  const groups: Rule[][] = [[parts[0]!]];
  ops.forEach((op, i) => {
    if (op === tight) groups[groups.length - 1]!.push(parts[i + 1]!);
    else groups.push([parts[i + 1]!]);
  });
  return combine(
    loose,
    groups.map((g) => combine(tight, g)),
  );
}

export function hasUnmodelled(rule: Rule): boolean {
  if (rule.kind === "UNMODELLED") return true;
  return (rule.kind === "AND" || rule.kind === "OR") && rule.children.some(hasUnmodelled);
}

// ---------------------------------------------------------------------------
// Atoms: the whole clause must match
// ---------------------------------------------------------------------------

const LEVELS = "\\d000(?:\\s*(?:and\\/or|or|and|\\/|,)\\s*\\d000)*";
const UNITS_HEAD = /^(?:(?:at\s+least|a\s+minimum\s+of|minimum\s+of|a\s+total\s+of)\s+)?(\d+)\s+units?\b\s*(.*)$/i;
const UNITS_ANY =
  /^(?:(?:of|in)\s+)?(?:(?:university|tertiary|ANU)\s+)?(?:courses?|study)?(?:\s*towards\s+(?:a|any|your)\s+degree)?$/i;
const UNITS_SUBJECT = new RegExp(
  `^(?:(?:of|in)\\s+)?(?:(${LEVELS})\\s*-?\\s*level\\s+)?([A-Z]{4})(?:\\s*-?\\s*cod(?:ed|e))?(?:\\s+courses?)?$`,
);
const UNITS_LEVEL_ONLY = new RegExp(`^(?:(?:of|in)\\s+)?(${LEVELS})\\s*-?\\s*level(?:\\s+courses?)?$`, "i");
const UNITS_SUBJECT_LEVEL = /^(?:(?:of|in)\s+)?([A-Z]{4})(\d000)\s*-?\s*level(?:\s+courses?)?$/;
const UNITS_FROM = new RegExp(
  `^(?:of|from)\\s+(?:the\\s+following(?:\\s+courses)?\\s*:?\\s*)?\\(?\\s*(${CODE}(?:(?:\\s*,\\s*(?:or\\s+)?|\\s+or\\s+|\\s*\\/\\s*)${CODE})*)\\s*\\)?$`,
  "i",
);

function levelsOf(text: string): number[] {
  return [...text.matchAll(/\d000/g)].map((m) => Number(m[0]));
}

function unitsAtom(s: string, concurrent: boolean): Rule | null {
  const head = UNITS_HEAD.exec(s);
  if (!head) return null;
  const min = Number(head[1]);
  const rest = head[2]!.trim();
  if (!(min > 0)) return null;
  let m: RegExpExecArray | null;
  if ((m = UNITS_FROM.exec(rest))) {
    return { kind: "UNITS", min, from: [...new Set(m[1]!.match(CODE_G) ?? [])], concurrent };
  }
  if ((m = UNITS_SUBJECT_LEVEL.exec(rest))) {
    return { kind: "UNITS", min, subject: m[1]!, levels: [Number(m[2])], concurrent };
  }
  if ((m = UNITS_SUBJECT.exec(rest))) {
    return { kind: "UNITS", min, subject: m[2]!, ...(m[1] ? { levels: levelsOf(m[1]) } : {}), concurrent };
  }
  if ((m = UNITS_LEVEL_ONLY.exec(rest))) {
    return { kind: "UNITS", min, levels: levelsOf(m[1]!), concurrent };
  }
  if (UNITS_ANY.test(rest)) return { kind: "UNITS", min, concurrent };
  return null;
}

const WAM =
  /^(?:have|achieve|attain|hold)?\s*(?:an?\s+)?(?:minimum\s+)?(?:(?:ANU\s+)?weighted\s+average\s+mark|WAM)(?:\s*\(WAM\))?\s+(?:of\s+)?(?:at\s+least\s+|a\s+minimum\s+of\s+|equivalent\s+to\s+(?:an?\s+)?(?:ANU\s+)?)?(\d{2,3})(?:\s*(?:per\s?cent|%))?(?:\s+or\s+(?:above|higher|more|greater|better))?$/i;

const PROGRAM_WORDS = /^(?:the\s*:?\s+|a\s+|an\s+)?(.+)$/;
const DEGREE = /^(?:Bachelor|Master|Graduate\s+(?:Certificate|Diploma)|Diploma|Doctor|Juris\s+Doctor|Associate\s+Degree)\b/;
const NAME_CHARS = /^[A-Z][A-Za-z0-9&'’,()\-\s]*$/;
const NAME_LOWER_OK = new Set(["of", "in", "and", "the", "for"]);

function programAtom(s: string, mode: Mode, text: string): Rule | null {
  const name = PROGRAM_WORDS.exec(s)![1]!.trim();
  if (new RegExp(CODE).test(name)) return null;
  if (!NAME_CHARS.test(name)) return null;
  const lower = name.match(/\b[a-z][a-z]*\b/g) ?? [];
  if (lower.some((w) => !NAME_LOWER_OK.has(w))) return null;
  if (!DEGREE.test(name) && mode !== "enrolled") return null;
  const programs = [...name.matchAll(/\(([A-Z][A-Z0-9-]{2,11})\)/g)].map((m) => m[1]!);
  if (/^[A-Z][A-Z0-9-]{2,11}$/.test(name)) programs.push(name);
  return { kind: "INFO", info: "PROGRAM", text, ...(programs.length ? { programs } : {}) };
}

function isPermission(s: string): boolean {
  return (
    /\bpermission\s+code\b/i.test(s) ||
    (/\b(?:permission|consent|approval)\b/i.test(s) && /\b(?:conven[eo]r|school|college|delegate)\b/i.test(s))
  );
}

const TITLE_QUALIFIER =
  /\b(?:or|with|grade|mark|credit|distinction|pass|higher|above|minimum|least|equivalent|excluding|except|concurrent(?:ly)?|result)\b/i;

/** Course code with an optional trailing title: "ECON1101 Microeconomics 1", "COMP1100 - Programming ...". */
function courseAtom(s: string): string | null {
  const m = new RegExp(`^(${CODE})(?:\\s*[-–]\\s*(.+)|\\s+([A-Z].*))?$`).exec(s);
  if (!m) return null;
  const title = m[2] ?? m[3];
  if (title !== undefined) {
    if (new RegExp(CODE).test(title)) return null;
    if (m[3] !== undefined && !NAME_CHARS.test(title)) return null;
    if (TITLE_QUALIFIER.test(title)) return null; // "COMP1100 Credit or higher" is a condition, not a title
  }
  return m[1]!;
}

function atom(raw: string, mode: Mode, p: Protector, list = false): Rule {
  const verbatim = p.restore(raw).trim();
  const lead = stripLead(raw, mode, p);
  mode = lead.mode;
  list ||= lead.list;
  const body = lead.text.replace(/[.:]+$/, "").trim();
  const concurrent = mode !== "completed";

  if (isWrapped(body)) return parseExpr(body.slice(1, -1), mode, p).rule;

  const s = p.restore(body).trim();
  if (s === "") return unmodelled(verbatim);

  if (isPermission(s)) return { kind: "INFO", info: "PERMISSION", text: verbatim };

  const code = courseAtom(s);
  if (code) return { kind: "COURSE", code, concurrent };

  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^(${CODE})\\s+or\\s+be\\s+doing\\s+(?:it|so)\\s+concurrently$`, "i").exec(s))) {
    return { kind: "COURSE", code: m[1]!, concurrent: true };
  }
  // "COMP1110/1140", "COMP1110/COMP1140"
  if ((m = new RegExp(`^(${CODE})((?:\\s*\\/\\s*(?:[A-Z]{4})?\\d{4})+)$`).exec(s))) {
    const subject = m[1]!.slice(0, 4);
    const codes = [m[1]!, ...m[2]!.split("/").slice(1).map((c) => c.trim()).map((c) => (c.length === 4 ? subject + c : c))];
    return combine(
      "OR",
      codes.map((c) => ({ kind: "COURSE", code: c, concurrent })),
    );
  }
  // "one of: COMP1100 - Title COMP1130 - Title" (codes separated by titles)
  if (list) {
    const codes = [...s.matchAll(CODE_G)];
    if (codes.length >= 2 && codes[0]!.index === 0) {
      const gaps = codes.map((c, i) => s.slice(c.index! + c[0].length, codes[i + 1]?.index ?? s.length));
      if (gaps.every((g) => /^\s*(?:[-–]\s*\S.*)?\s*$/.test(g))) {
        return combine(
          "OR",
          codes.map((c) => ({ kind: "COURSE", code: c[0], concurrent })),
        );
      }
    }
  }

  const units = unitsAtom(s, concurrent);
  if (units) return units;

  if ((m = WAM.exec(s))) return { kind: "INFO", info: "GRADE", text: verbatim, wam: Number(m[1]) };

  const program = programAtom(s, mode, verbatim);
  if (program) return program;

  return unmodelled(verbatim);
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

function depths(text: string): number[] {
  const d: number[] = [];
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth++;
    d.push(depth);
    if (ch === ")") depth = Math.max(0, depth - 1);
  }
  return d;
}

function isWrapped(text: string): boolean {
  if (!text.startsWith("(") || !text.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0 && i < text.length - 1) return false;
    }
  }
  return depth === 0;
}

interface Sep {
  start: number;
  end: number;
  op: Op | null;
  level: 1 | 2 | 3 | 4 | 5 | "comma";
  upper: boolean;
}

function separators(text: string): Sep[] {
  const d = depths(text);
  const seps: Sep[] = [];
  const re = /\s*;\s*(?:(and|or)\b\s*)?|\s*,\s*(?:(and|or)\s+)?|\s+(and|or)\s+/gi;
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (d[start] !== 0 || d[end - 1] !== 0) continue; // inside parentheses
    if (end >= text.length || start === 0) continue;
    const conn = m[1] ?? m[2] ?? m[3];
    const op: Op | null = conn ? (conn.toLowerCase() === "and" ? "AND" : "OR") : null;
    const upper = !!conn && conn === conn.toUpperCase();
    let level: Sep["level"];
    if (m[0].includes(";")) level = 1;
    else if (m[0].includes(",")) level = conn ? 2 : "comma";
    else level = VERB_START.test(text.slice(end)) ? 3 : 5;
    seps.push({ start, end, op, level, upper });
  }
  return seps;
}

interface Parsed {
  rule: Rule;
  mode: Mode;
}

function parseExpr(input: string, mode: Mode, p: Protector): Parsed {
  const verbatim = p.restore(input).trim();
  const lead = stripLead(input.trim().replace(/[.]+$/, ""), mode, p);
  let text = lead.text;
  mode = lead.mode;
  while (isWrapped(text)) text = text.slice(1, -1).trim();

  const all = separators(text);
  if (all.length === 0) return { rule: atom(text, mode, p, lead.list), mode };

  const conns = all.filter((s) => s.op !== null);
  const ambiguous = () => ({ rule: unmodelled(verbatim), mode });
  if (conns.length === 0) return ambiguous(); // bare commas only
  if (all.some((s) => s.level === 1 && s.op === null)) return ambiguous(); // bare ";"

  const uniform = conns.every((s) => s.op === conns[0]!.op);
  let seps: Sep[];
  let tight: Op = "OR";
  if (uniform) {
    seps = all;
  } else if (all.some((s) => s.level === 1)) {
    seps = all.filter((s) => s.level === 1);
    tight = "AND";
  } else if (all.some((s) => s.level === 2)) {
    seps = all.filter((s) => s.level === 2);
    tight = "AND";
  } else if (all.some((s) => s.level === 3)) {
    seps = all.filter((s) => s.level === 3);
    tight = "AND";
  } else {
    const plain = all.filter((s) => s.level === 5);
    const hasUpper = plain.some((s) => s.upper);
    const hasLower = plain.some((s) => !s.upper);
    seps = hasUpper && hasLower ? plain.filter((s) => s.upper) : all;
  }

  // bare commas take the operator of the next connective (else the previous)
  const ops: Op[] = seps.map((s, i) => {
    if (s.op) return s.op;
    const next = seps.slice(i + 1).find((x) => x.op) ?? [...seps.slice(0, i)].reverse().find((x) => x.op);
    return next!.op!;
  });

  const spans: { start: number; end: number }[] = [];
  let at = 0;
  for (const s of seps) {
    spans.push({ start: at, end: s.start });
    at = s.end;
  }
  spans.push({ start: at, end: text.length });

  const parts: Rule[] = [];
  for (const span of spans) {
    const r = parseExpr(text.slice(span.start, span.end), mode, p);
    parts.push(r.rule);
    mode = r.mode;
  }

  const failed = parts.map((r) => r.kind === "UNMODELLED");
  if (failed.some(Boolean)) {
    if (!uniform) return ambiguous();
    // a bare comma only borrows its operator between clauses we could read
    // ("A, B or C"); next to an unread clause it may be a qualifier (", with ...")
    if (seps.some((s, i) => s.op === null && (failed[i] || failed[i + 1]))) return ambiguous();
    // merge runs of failed parts back into one verbatim clause
    const mergedParts: Rule[] = [];
    const mergedOps: Op[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (failed[i] && i > 0 && failed[i - 1]) continue; // already merged
      if (failed[i]) {
        let j = i;
        while (j + 1 < parts.length && failed[j + 1]) j++;
        mergedParts.push(unmodelled(p.restore(text.slice(spans[i]!.start, spans[j]!.end)).trim()));
      } else mergedParts.push(parts[i]!);
      if (i > 0) mergedOps.push(ops[i - 1]!);
    }
    if (mergedParts.length === 1) return { rule: mergedParts[0]!, mode };
    return { rule: group(mergedParts, mergedOps, tight), mode };
  }
  return { rule: group(parts, ops, tight), mode };
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

const INCOMPAT_START =
  /^(?:(?:It|This\s+course)\s+is\s+)?incompatible\b|^You\s+(?:are\s+not\s+able\s+to|may\s+not|cannot|can\s+not)\s+enrol\b/i;
const INCOMPAT_MID =
  /\s+(?=Incompatible\b|It\s+is\s+incompatible\b|You\s+(?:are\s+not\s+able\s+to|may\s+not|cannot)\s+enrol\b)/g;
const ADVISORY =
  /^(?:assumed\s+knowledge|(?:it\s+is|students\s+are)\s+(?:strongly\s+)?(?:recommended|advised)|recommended|it\s+should\s+be\s+noted|note\s*:)/i;
const PREAMBLE =
  /^(?:to\s+enrol(?:\s+in\s+this\s+course)?\s*,?\s*(?:you|students)\s+(?:must|will\s+need\s+to|need\s+to)(?:\s+also)?|(?:you|students)\s+(?:must\s+also|also\s+must|must)|must)\b\s*:?\s*/i;
const CONTINUATION = /^(AND|OR)\b\s*/i;
const PROGRAM_HINT = /\b(?:Bachelor|Master|Diploma|Certificate|Doctor|program|degree|plan)\b/;

function normalise(raw: string): string {
  return raw
    .replace(/[ \s]+/g, " ")
    .replace(/\b([A-Z]{4}) (\d{4})\b/g, "$1$2")
    .replace(/\s+([.,:;])/g, "$1")
    .trim();
}

function sentences(text: string): string[] {
  return text
    .replace(INCOMPAT_MID, "\n")
    .split(/\n|(?<=\.)\s+(?=[A-Z(])/)
    .map((s) => s.trim().replace(/\.+$/, "").trim())
    .filter((s) => s.length > 0);
}

function incompatCodes(sentence: string): string[] {
  const body = sentence.replace(
    new RegExp(`^You\\s+(?:are\\s+not\\s+able\\s+to|may\\s+not|cannot|can\\s+not)\\s+enrol\\s+in\\s+(?:${CODE}|this\\s+course)`, "i"),
    "",
  );
  return body.match(CODE_G) ?? [];
}

function protect(text: string, p: Protector): string {
  let t = text;
  t = p.protect(t, CONCURRENT_VERB);
  t = p.protect(t, UNITS_FROM_LIST);
  t = p.protect(t, UNITS_SUBJECT_LIST);
  t = p.protect(t, TITLE_AND);
  t = p.protect(t, OR_QUALIFIER);
  t = p.protect(t, LEVEL_JOIN);
  t = p.protect(t, DOING_IT);
  return t;
}

export function parseRequisiteText(raw: string): {
  rule: Rule | null;
  incompatible: string[];
  status: ParseStatus;
} {
  const text = normalise(raw ?? "");
  if (text === "") return { rule: null, incompatible: [], status: "none" };

  const incompatible: string[] = [];
  const rules: Rule[] = [];
  // index into `rules` of the last requirement a continuation can join
  let lastReq: number | null = null;
  let lastMode: Mode = "completed";

  for (const sentence of sentences(text)) {
    if (INCOMPAT_START.test(sentence)) {
      const codes = incompatCodes(sentence);
      incompatible.push(...codes);
      if (codes.length === 0 || PROGRAM_HINT.test(sentence)) rules.push(unmodelled(sentence));
      lastReq = null;
      continue;
    }
    if (ADVISORY.test(sentence)) continue;

    const p = new Protector();
    const cont = CONTINUATION.exec(sentence);
    if (cont && lastReq !== null) {
      const op: Op = cont[1]!.toUpperCase() as Op;
      const parsed = parseExpr(protect(sentence.slice(cont[0].length), p), lastMode, p);
      const rule = parsed.rule.kind === "UNMODELLED" ? unmodelled(sentence) : parsed.rule;
      rules[lastReq] = combine(op, [rules[lastReq]!, rule]);
      lastMode = parsed.mode;
      continue;
    }

    const pre = PREAMBLE.exec(sentence);
    if (pre) {
      const parsed = parseExpr(protect(sentence.slice(pre[0].length), p), "completed", p);
      const rule = parsed.rule.kind === "UNMODELLED" ? unmodelled(sentence) : parsed.rule;
      rules.push(rule);
      lastReq = rules.length - 1;
      lastMode = parsed.mode;
      continue;
    }

    if (isPermission(sentence)) {
      rules.push({ kind: "INFO", info: "PERMISSION", text: sentence });
      lastReq = null;
      continue;
    }

    // No preamble: accept only if the whole sentence reads as a modelled rule.
    const parsed = parseExpr(protect(sentence, p), "completed", p);
    if (!hasUnmodelled(parsed.rule)) {
      rules.push(parsed.rule);
      lastReq = rules.length - 1;
      lastMode = parsed.mode;
    } else {
      rules.push(unmodelled(sentence));
      lastReq = null;
    }
  }

  const rule = rules.length === 0 ? null : combine("AND", rules);
  const status: ParseStatus =
    rule === null ? "parsed" : rule.kind === "UNMODELLED" ? "unparsed" : hasUnmodelled(rule) ? "partial" : "parsed";
  return { rule, incompatible: [...new Set(incompatible)], status };
}
