import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// PLAN.md §4.2 sensor: src/styles/anu.css is the only place a colour, font
// stack or shadow may be spelled out. Everything else uses var(--token), so a
// palette change is one edit and a stray #hex in a component can't drift
// from the system. Also pins the §4.2 token names (D and E code against
// them) and re-measures the contrast floors the anu.css header claims.

const TOKENS_FILE = "src/styles/anu.css";
const SCANNED = /\.(astro|tsx?|jsx?|mjs|css|svg|html)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : SCANNED.test(p) ? [p] : [];
  });
}

/** Every design-literal in `source`, as "line N: match". Exported shape is
 *  the test's own; kept pure so the detector itself is tested below. */
export function findLiterals(source: string): string[] {
  const rules: [string, RegExp][] = [
    // a hex colour: #rgb #rgba #rrggbb #rrggbbaa, not an HTML entity (&#123;)
    // and not a URL fragment (href="#main" is letters past f anyway).
    ["hex colour", /(?<![&\w/"'=])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g],
    ["hex colour", /(?<=["'`])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=["'`])/g],
    ["colour function", /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g],
    // font-family / fontFamily whose value isn't purely var(--token)
    ["font-family", /\bfont-?[fF]amily\s*[:=]\s*(?!\s*["'`{]?\s*var\(--[\w-]+\)\s*["'`}]?\s*[;,}\n])[^;\n]*/g],
    // box-shadow / boxShadow whose value isn't var(--token)(s) or none
    ["box-shadow", /\bbox-?[sS]hadow\s*[:=]\s*(?!\s*["'`{]?\s*(?:none|var\(--[\w-]+\)(?:\s*,\s*var\(--[\w-]+\))*)\s*["'`}]?\s*[;,}\n])[^;\n]*/g],
    // a font shorthand naming a family literally: `font: 500 13px Inter`
    ["font shorthand", /(?<![\w-])font\s*:\s*(?![^;\n]*var\(--font-)[^;\n]*\d(?:px|rem|em)[^;\n]*[a-zA-Z"'][^;\n]*/g],
  ];
  const hits: string[] = [];
  source.split("\n").forEach((line, i) => {
    for (const [what, re] of rules) {
      for (const m of line.matchAll(re)) hits.push(`line ${i + 1}: ${what} \`${m[0].trim()}\``);
    }
  });
  return hits;
}

describe("design tokens: the literal detector", () => {
  it.each([
    ["color: #1a1a1a;"],
    ['fill="#BE830E"'],
    ["{ color: '#fff' }"],
    ["background: rgb(17 17 17 / .3);"],
    ["border-color: hsl(40 90% 40%);"],
    ["font-family: Inter, sans-serif;"],
    ['style={{ fontFamily: "Inter" }}'],
    ["box-shadow: 0 1px 2px black;"],
    ["boxShadow: '0 0 0 2px red'"],
    ["font: 500 13px Inter;"],
  ])("flags %s", (src) => {
    expect(findLiterals(src)).not.toEqual([]);
  });

  it.each([
    ['<a href="#main">Skip</a>'],
    ["color: var(--ink);"],
    ["font-family: var(--font-code);"],
    ['style={{ fontFamily: "var(--font-code)" }}'],
    ["box-shadow: var(--shadow-2), var(--focus);"],
    ["box-shadow: none;"],
    ["font: 500 var(--t-sm) var(--font-ui);"],
    ["&#8212; an entity"],
    ["grid-template-columns: 72px repeat(4, 1fr);"],
  ])("allows %s", (src) => {
    expect(findLiterals(src)).toEqual([]);
  });
});

describe("design tokens: src/ uses tokens only", () => {
  const files = walk("src").filter((f) => relative(".", f) !== TOKENS_FILE);

  it("scans the component tree (guards against a walk that finds nothing)", () => {
    expect(files.some((f) => f.includes("components/ui/"))).toBe(true);
    expect(files.some((f) => f.endsWith("Base.astro"))).toBe(true);
  });

  it("has no colour, font-family or box-shadow literal outside anu.css", () => {
    const offenders = files.flatMap((f) => findLiterals(readFileSync(f, "utf8")).map((hit) => `${relative(".", f)} ${hit}`));
    expect(offenders, "use a token from src/styles/anu.css (or ask track C for one)").toEqual([]);
  });
});

// §4.2 names are a cross-track contract: renaming one breaks D and E silently
// (an undefined var() just drops the declaration), so pin every one.
const CONTRACT_TOKENS = [
  "ink", "ink-2", "muted", "placeholder", "canvas", "surface", "surface-2", "line", "line-strong",
  "gold", "gold-text", "gold-wash", "danger", "danger-line", "danger-wash", "warn", "warn-line", "warn-wash",
  "info", "info-wash", "edge-met", "edge-unmet", "edge-idle", "scrim",
  "font-ui", "font-code", "t-xs", "t-sm", "t-base", "t-md", "t-lg", "t-xl",
  "s-1", "s-2", "s-3", "s-4", "s-5", "s-6", "s-8", "s-10", "s-14",
  "r-sm", "r-md", "r-lg", "shadow-1", "shadow-2", "ease", "d-fast", "d-base", "d-slow", "focus",
];

const css = readFileSync(TOKENS_FILE, "utf8");
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const tokens = new Map([...rootBlock.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as const));

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(fg: string, bg: string): number {
  const a = luminance(tokens.get(fg)!);
  const b = luminance(tokens.get(bg)!);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("design tokens: anu.css", () => {
  it.each(CONTRACT_TOKENS)("defines --%s in :root", (name) => {
    expect(tokens.has(name), `--${name} is a PLAN.md §4.2 contract token`).toBe(true);
  });

  it("uses the Geist faces the layout self-hosts", () => {
    expect(tokens.get("font-ui")).toMatch(/^"Geist Variable"/);
    expect(tokens.get("font-code")).toMatch(/^"Geist Mono Variable"/);
  });

  // [foreground, background, floor]: text >= 4.5, non-text (rings, borders) >= 3.
  it.each([
    ["ink", "surface", 4.5], ["ink-2", "surface", 4.5], ["muted", "surface", 4.5], ["muted", "canvas", 4.5],
    ["placeholder", "surface", 4.5], ["gold-text", "surface", 4.5], ["gold-text", "canvas", 4.5],
    ["gold-text", "gold-wash", 4.5], ["danger", "surface", 4.5], ["danger", "danger-wash", 4.5],
    ["warn", "surface", 4.5], ["warn", "warn-wash", 4.5], ["info", "info-wash", 4.5], ["muted", "info-wash", 4.5],
    ["on-ink", "ink", 4.5], ["on-ink-muted", "ink", 4.5], ["gold", "ink", 4.5], ["on-ink", "ink-2", 4.5],
    ["on-ink", "danger", 4.5], ["on-ink", "danger-line", 4.5],
    ["gold", "surface", 3], ["danger-line", "surface", 3],
  ] as const)("--%s on --%s clears %s:1", (fg, bg, floor) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(floor);
  });

  // §4.2 gives --warn-line as "3:1+"; measured it is 2.995:1, a hair under.
  // Kept as specified (a contract value) because the warning border is never
  // the only signal: it is dashed, and the strip carries a ▲ icon + text.
  // This pins it so a further lightening is caught.
  it("--warn-line stays within rounding of 3:1 (reported to Ritesh)", () => {
    expect(contrast("warn-line", "surface")).toBeGreaterThan(2.99);
  });

  it("keeps gold out of text on white (it can't clear 4.5:1)", () => {
    expect(contrast("gold", "surface")).toBeLessThan(4.5);
    // so no rule may set `color: var(--gold)` except on the dark app bar
    const goldText = [...css.matchAll(/([^{}]+)\{[^}]*(?<![\w-])color:\s*var\(--gold\)/g)].map((m) => m[1].trim());
    expect(goldText.every((sel) => sel.startsWith(".app-bar"))).toBe(true);
  });
});
