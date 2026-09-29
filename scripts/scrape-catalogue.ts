#!/usr/bin/env node
// Scrapes the ANU Programs and Courses catalogue (PLAN.md §5.3 track A).
//
//   node scripts/scrape-catalogue.ts --subjects COMP,MATH,ENGN   # trial
//   node scripts/scrape-catalogue.ts --all                       # every subject
//
// Discovery: the catalogue search page's own JSON endpoint
// (/data/CourseSearch/GetCourses?ShowAll=true...) lists every course offered
// in the year in one response. Each course page is then fetched at most once
// per second with an identifying User-Agent. Raw HTML is cached under
// .cache/pandc/ (gitignored), so an interrupted run resumes where it stopped:
// just run the same command again. Only the *extracted text fields* are
// committed, in catalogue/raw/<SUBJECT>.json, so re-running the parser never
// touches the network.
//
// A listed course whose 2026 page is missing falls back to 2025. Codes that
// requisite text mentions but the listing doesn't are fetched too
// (origin "referenced"). Codes that 404 in both years are recorded in
// catalogue/raw/_meta.json, never invented.
//
// Runs locally only (never in the server or the browser); reads no
// process.env.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

export const BASE = "https://programsandcourses.anu.edu.au";
const UA =
  "anu-degree-planner-scraper/1.0 (ANU COMP4020 student project by Ritesh Sivaraman; one-off catalogue snapshot; <=1 req/s)";
const MIN_GAP_MS = 1100; // >= 1 s between request starts, with margin
const CACHE = ".cache/pandc";
const RAW_DIR = "catalogue/raw";
export const CODE_RE = /^[A-Z]{4}\d{4}$/;

export interface ListingItem {
  CourseCode: string;
  Name: string;
  Session: string;
  Career: string;
  Units: number;
  ModeOfDelivery: string;
  Year: number;
}

/** First sentence only, <= max chars (cut at a word boundary with an ellipsis if longer). */
export function summarise(description: string, max = 160): string {
  const text = description.replace(/\s+/g, " ").trim();
  const first = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trim()}…`;
}

export interface RawCourse {
  code: string;
  origin: "catalogue" | "referenced";
  catalogueYear: number;
  sourceUrl: string;
  title: string;
  unitsText: string; // verbatim "6 units"
  units: number | null; // first number in unitsText
  offeredRaw: string[]; // verbatim "First Semester 2026" lines from "Offered in"
  subjectName: string | null; // "Course subject"
  college: string | null; // "ANU College", verbatim; joint courses read "A / B"
  career: string | null; // from the listing, or the page's intro line
  // first sentence of the page's intro, <= 160 chars. The full description is
  // ANU's copyright and is never stored (PLAN.md changelog, 2026-09-30).
  summary: string;
  requisiteText: string | null; // verbatim "Requisite and Incompatibility" block
}

export interface ScrapeMeta {
  year: number;
  scrapedAt: string;
  source: string;
  scope: "all" | string[];
  listingEndpoint: string;
  listingTotal: number; // every standard-code course in the year's listing
  listingTotalBySubject: Record<string, number>;
  nonstandardCodes: string[]; // listing codes not matching AAAA9999 (e.g. thesis variants BIOL9001P); not scraped
  notFound: { code: string; triedYears: number[]; referencedBy: string[] }[];
  failures: { code: string; error: string }[];
  fellBackTo2025: string[];
  requests: number;
  cachedHits: number;
  durationSec: number;
}

// ---------------------------------------------------------------------------
// polite fetching with a resumable on-disk cache
// ---------------------------------------------------------------------------

/** Knobs for the network layer; tests shrink them, the real run uses the defaults. */
export interface FetchConfig {
  base: string;
  cacheDir: string;
  minGapMs: number; // >= this long between request starts
  attempts: number;
  backoffMs: number; // wait backoffMs * attempt before retry `attempt`
  timeoutMs: number; // per request, headers and body together
}
export const DEFAULT_FETCH: FetchConfig = {
  base: BASE,
  cacheDir: CACHE,
  minGapMs: MIN_GAP_MS,
  attempts: 3,
  backoffMs: 5000,
  timeoutMs: 30_000,
};

let lastStart = 0;
let requests = 0;
let cachedHits = 0;

// Every request carries a deadline. The signal also governs reading the
// body, so a server that sends headers and then stalls is cut off too. A
// timeout surfaces as a thrown TimeoutError, which the caller's retry/backoff
// loop treats like any other network error. (LEARNINGS: network I/O without
// deadlines in long-running batch jobs --- the first --all run hung 57 min on
// one socket that never answered.)
async function politeFetch(url: string, cfg: FetchConfig, timeoutMs = cfg.timeoutMs): Promise<Response> {
  const wait = lastStart + cfg.minGapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
  requests++;
  return fetch(url, { redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
}

export type PageResult = { kind: "ok"; html: string } | { kind: "notfound" } | { kind: "error"; error: string };

export async function fetchCoursePage(code: string, year: number, cfg: FetchConfig = DEFAULT_FETCH): Promise<PageResult> {
  const htmlPath = join(cfg.cacheDir, String(year), `${code}.html`);
  const missPath = join(cfg.cacheDir, String(year), `${code}.404`);
  if (existsSync(htmlPath)) {
    cachedHits++;
    return { kind: "ok", html: readFileSync(htmlPath, "utf8") };
  }
  if (existsSync(missPath)) {
    cachedHits++;
    return { kind: "notfound" };
  }
  mkdirSync(dirname(htmlPath), { recursive: true });
  let lastError = "";
  for (let attempt = 0; attempt < cfg.attempts; attempt++) {
    try {
      const res = await politeFetch(`${cfg.base}/${year}/course/${code}`, cfg);
      // P&C answers a missing course (or one not offered that year) with a
      // 302, usually to /Error/Index/404: any 3xx on a course URL is
      // "missing for this year", never followed (LEARNINGS: P&C 302)
      const location = res.headers.get("location") ?? "";
      if (res.status === 404 || (res.status >= 300 && res.status < 400)) {
        writeFileSync(missPath, location);
        return { kind: "notfound" };
      }
      if (res.status === 200) {
        const html = await res.text();
        if (!html.includes("intro__degree-title")) {
          lastError = "200 but not a course page";
        } else {
          writeFileSync(htmlPath, html);
          return { kind: "ok", html };
        }
      } else {
        lastError = `HTTP ${res.status} ${location}`;
      }
    } catch (err) {
      lastError = String(err);
    }
    if (attempt + 1 < cfg.attempts) await new Promise((r) => setTimeout(r, cfg.backoffMs * (attempt + 1)));
  }
  return { kind: "error", error: lastError };
}

async function fetchListing(year: number): Promise<{ endpoint: string; items: ListingItem[] }> {
  const params = new URLSearchParams({
    ShowAll: "true",
    PageIndex: "0",
    MaxPageSize: "10",
    PageSize: "10",
    SelectedYear: String(year),
    SearchText: "",
    CollegeName: "All Colleges",
    ModeOfDelivery: "All Modes",
  });
  const endpoint = `${BASE}/data/CourseSearch/GetCourses?${params}`;
  const path = join(CACHE, `listing-${year}.json`);
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    let body = "";
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await politeFetch(endpoint, DEFAULT_FETCH, 180_000);
        if (!res.ok) throw new Error(`listing: HTTP ${res.status}`);
        body = await res.text();
        break;
      } catch (err) {
        if (attempt + 1 >= DEFAULT_FETCH.attempts) throw err;
        console.log(`listing: attempt ${attempt + 1} failed (${String(err)}), retrying`);
        await new Promise((r) => setTimeout(r, DEFAULT_FETCH.backoffMs * (attempt + 1)));
      }
    }
    writeFileSync(path, body);
  } else {
    cachedHits++;
  }
  const body = JSON.parse(readFileSync(path, "utf8")) as { Items?: ListingItem[] };
  if (!Array.isArray(body.Items) || body.Items.length === 0) {
    throw new Error("listing: no Items --- discovery failed, stop (no hand-typed catalogue)");
  }
  return { endpoint, items: body.Items };
}

// ---------------------------------------------------------------------------
// extraction: text only, never layout
// ---------------------------------------------------------------------------

const BLOCK = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "TABLE", "TR"]);

/** Visible text with block boundaries and <br> kept as newlines. */
export function blockText(el: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    if (tag === "BR") {
      out += "\n";
      return;
    }
    const block = BLOCK.has(tag);
    if (block) out += "\n";
    for (const child of Array.from(node.childNodes)) walk(child);
    if (block) out += "\n";
  };
  for (const child of Array.from(el.childNodes)) walk(child);
  return out
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summaryField(summary: Element | null, heading: string): Element | null {
  if (!summary) return null;
  for (const li of Array.from(summary.querySelectorAll("li"))) {
    const h = li.querySelector("[class*='heading']");
    if (h && h.textContent?.trim().toLowerCase() === heading.toLowerCase()) return li;
  }
  return null;
}

export function extractCourse(
  html: string,
  code: string,
  year: number,
  origin: RawCourse["origin"],
  listing?: ListingItem,
): RawCourse {
  const dom = new JSDOM(html);
  try {
    return extractFromDocument(dom.window.document, code, year, origin, listing);
  } finally {
    dom.window.close();
  }
}

function extractFromDocument(
  doc: Document,
  code: string,
  year: number,
  origin: RawCourse["origin"],
  listing?: ListingItem,
): RawCourse {
  const summary = doc.querySelector(".degree-summary");
  const title = (doc.querySelector(".intro__degree-title__component")?.textContent ?? listing?.Name ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const unitsLi = summary?.querySelector(".degree-summary__requirements-units") ?? null;
  const unitsText = (unitsLi?.textContent ?? "").replace(/Unit Value/i, "").replace(/\s+/g, " ").trim();
  const unitsMatch = unitsText.match(/(\d+(?:\.\d+)?)/);

  const offeredLi = summaryField(summary, "Offered in");
  const offeredRaw = offeredLi
    ? Array.from(offeredLi.querySelectorAll(".degree-summary__code-text"))
        .map((s) => (s.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 0 && !/future offerings/i.test(t))
    : [];

  const subjectLi = summaryField(summary, "Course subject");
  const subjectName = subjectLi?.querySelector(".degree-summary__code-text")?.textContent?.trim() ?? null;
  const collegeLi = summaryField(summary, "ANU College");
  const college = collegeLi?.querySelector(".degree-summary__code-text")?.textContent?.replace(/\s+/g, " ").trim() ?? null;

  const introText = doc.querySelector(".intro__degree-description__text")?.textContent ?? "";
  const career =
    listing?.Career ??
    (/\bundergraduate\b/i.test(introText) ? "Undergraduate" : /\bpostgraduate\b/i.test(introText) ? "Postgraduate" : null);

  const intro = doc.querySelector("#introduction, .introduction");
  const req = doc.querySelector(".requisite");
  const requisiteText = req ? blockText(req) : "";

  return {
    code,
    origin,
    catalogueYear: year,
    sourceUrl: `${BASE}/${year}/course/${code}`,
    title,
    unitsText,
    units: unitsMatch ? Number(unitsMatch[1]) : null,
    offeredRaw,
    subjectName,
    college,
    career,
    summary: intro ? summarise(blockText(intro)) : "",
    requisiteText: requisiteText.length > 0 ? requisiteText : null,
  };
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

export type CourseResult =
  | { kind: "ok"; year: number; course: RawCourse }
  | { kind: "error"; year: number; error: string }
  | { kind: "notfound" };

/** One course, trying each year in turn (2026, then the 2025 fallback). */
export async function scrapeCourse(
  code: string,
  origin: RawCourse["origin"],
  years: number[],
  listing?: ListingItem,
  cfg: FetchConfig = DEFAULT_FETCH,
): Promise<CourseResult> {
  try {
    for (const y of years) {
      const page = await fetchCoursePage(code, y, cfg);
      if (page.kind === "ok") return { kind: "ok", year: y, course: extractCourse(page.html, code, y, origin, listing) };
      if (page.kind === "error") return { kind: "error", year: y, error: page.error };
    }
    return { kind: "notfound" };
  } finally {
    // A JSDOM window (~6 MB for a P&C page) is only reclaimed after a
    // macrotask turn, even once closed. A run of cache hits never yields one
    // (awaiting a resolved promise runs microtasks only), so without this the
    // --all run kept every page alive and hit the 4 GB heap limit at ~740.
    // (LEARNINGS: per-item resources in batch jobs.)
    await new Promise((r) => setImmediate(r));
  }
}

function parseArgs(argv: string[]): { scope: "all" | string[]; year: number } {
  let scope: "all" | string[] | null = null;
  let year = 2026;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") scope = "all";
    else if (argv[i] === "--subjects") scope = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    else if (argv[i] === "--year") year = Number(argv[++i]);
  }
  if (!scope) throw new Error("usage: scrape-catalogue.ts --all | --subjects COMP,MATH,ENGN [--year 2026]");
  return { scope, year };
}

async function main(): Promise<void> {
  const started = Date.now();
  const { scope, year } = parseArgs(process.argv.slice(2));
  const { endpoint, items } = await fetchListing(year);

  const nonstandardCodes = items.map((i) => i.CourseCode).filter((c) => !CODE_RE.test(c)).sort();
  const listed = new Map(items.filter((i) => CODE_RE.test(i.CourseCode)).map((i) => [i.CourseCode, i]));
  const listingTotalBySubject: Record<string, number> = {};
  for (const code of listed.keys()) listingTotalBySubject[code.slice(0, 4)] = (listingTotalBySubject[code.slice(0, 4)] ?? 0) + 1;

  const inScope = (code: string) => scope === "all" || scope.includes(code.slice(0, 4));
  const targets = [...listed.keys()].filter(inScope).sort();
  console.log(`listing: ${listed.size} courses (${nonstandardCodes.length} non-standard codes skipped); ${targets.length} in scope`);

  const scraped = new Map<string, RawCourse>();
  const failures: ScrapeMeta["failures"] = [];
  const notFound: ScrapeMeta["notFound"] = [];
  const fellBackTo2025: string[] = [];

  // Stall guard: one timestamped line per course, and a watchdog that shouts
  // if no course has finished for longer than a full retry cycle could take.
  // A hang is then visible in the log within minutes, not after an hour.
  let lastProgress = Date.now();
  let done = 0;
  const cycleMs = DEFAULT_FETCH.attempts * (DEFAULT_FETCH.timeoutMs + DEFAULT_FETCH.minGapMs) +
    DEFAULT_FETCH.backoffMs * ((DEFAULT_FETCH.attempts * (DEFAULT_FETCH.attempts - 1)) / 2);
  const watchdog = setInterval(() => {
    const idle = Date.now() - lastProgress;
    if (idle > 2 * cycleMs) console.log(`${new Date().toISOString()} STALL: no course finished for ${Math.round(idle / 1000)}s`);
  }, 60_000);
  watchdog.unref();
  const progress = (code: string, outcome: string): void => {
    lastProgress = Date.now();
    console.log(`${new Date().toISOString()} [${++done}] ${code} ${outcome} (req ${requests}, cached ${cachedHits})`);
  };

  const scrapeOne = async (code: string, origin: RawCourse["origin"], years: number[]): Promise<void> => {
    const r = await scrapeCourse(code, origin, years, listed.get(code));
    if (r.kind === "ok") {
      scraped.set(code, r.course);
      if (r.year !== years[0]) fellBackTo2025.push(code);
      progress(code, `ok ${r.year}`);
    } else if (r.kind === "error") {
      failures.push({ code, error: r.error });
      progress(code, `FAILED ${r.year}: ${r.error}`);
    } else {
      notFound.push({ code, triedYears: years, referencedBy: [] });
      progress(code, `not found in ${years.join("/")}`);
    }
  };

  let n = 0;
  for (const code of targets) {
    await scrapeOne(code, "catalogue", [year, year - 1]);
    if (++n % 50 === 0 || n === targets.length) {
      const rate = (Date.now() - started) / 1000 / n;
      console.log(`${n}/${targets.length} (${failures.length} failed) ~${Math.round(((targets.length - n) * rate) / 60)} min left`);
    }
  }

  // Referenced codes outside the listing, to a fixpoint (a referenced course's
  // own requisites can reference further codes).
  const referencedBy = new Map<string, Set<string>>();
  const tried = new Set<string>(targets);
  for (;;) {
    const fresh: string[] = [];
    for (const c of scraped.values()) {
      for (const ref of c.requisiteText?.match(/\b[A-Z]{4}\d{4}\b/g) ?? []) {
        if (listed.has(ref)) continue; // part of the listing: scraped under its own subject
        if (!referencedBy.has(ref)) referencedBy.set(ref, new Set());
        referencedBy.get(ref)?.add(c.code);
        if (!tried.has(ref)) {
          tried.add(ref);
          fresh.push(ref);
        }
      }
    }
    if (fresh.length === 0) break;
    console.log(`referenced outside the listing: ${fresh.length} more`);
    for (const code of fresh.sort()) await scrapeOne(code, "referenced", [year, year - 1]);
  }
  for (const nf of notFound) nf.referencedBy = [...(referencedBy.get(nf.code) ?? [])].sort();

  // write catalogue/raw/<SUBJECT>.json (extracted text only)
  mkdirSync(RAW_DIR, { recursive: true });
  const bySubject = new Map<string, RawCourse[]>();
  for (const c of scraped.values()) {
    const s = c.code.slice(0, 4);
    if (!bySubject.has(s)) bySubject.set(s, []);
    bySubject.get(s)?.push(c);
  }
  if (scope === "all") {
    // a full run owns the whole directory: nothing stale from an earlier trial survives
    for (const f of readdirSync(RAW_DIR)) if (/^[A-Z]{4}\.json$/.test(f) && !bySubject.has(f.slice(0, 4))) {
      writeFileSync(join(RAW_DIR, f), "[]\n");
    }
  }
  for (const [s, list] of bySubject) {
    list.sort((a, b) => a.code.localeCompare(b.code));
    writeFileSync(join(RAW_DIR, `${s}.json`), `${JSON.stringify(list, null, 1)}\n`);
  }

  const meta: ScrapeMeta = {
    year,
    scrapedAt: new Date().toISOString(),
    source: `${BASE}/${year}`,
    scope,
    listingEndpoint: endpoint,
    listingTotal: listed.size,
    listingTotalBySubject,
    nonstandardCodes,
    notFound: notFound.sort((a, b) => a.code.localeCompare(b.code)),
    failures,
    fellBackTo2025: fellBackTo2025.sort(),
    requests,
    cachedHits,
    durationSec: Math.round((Date.now() - started) / 1000),
  };
  writeFileSync(join(RAW_DIR, "_meta.json"), `${JSON.stringify(meta, null, 1)}\n`);
  console.log(
    `done: ${scraped.size} scraped, ${failures.length} failed, ${notFound.length} not found, ${requests} requests, ${meta.durationSec}s`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
