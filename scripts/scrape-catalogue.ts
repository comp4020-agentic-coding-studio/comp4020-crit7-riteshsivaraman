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
  career: string | null; // from the listing, or the page's intro line
  description: string;
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

let lastStart = 0;
let requests = 0;
let cachedHits = 0;

async function politeFetch(url: string): Promise<Response> {
  const wait = lastStart + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
  requests++;
  return fetch(url, { redirect: "manual", headers: { "User-Agent": UA } });
}

type PageResult = { kind: "ok"; html: string } | { kind: "notfound" } | { kind: "error"; error: string };

async function fetchCoursePage(code: string, year: number): Promise<PageResult> {
  const htmlPath = join(CACHE, String(year), `${code}.html`);
  const missPath = join(CACHE, String(year), `${code}.404`);
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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await politeFetch(`${BASE}/${year}/course/${code}`);
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
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
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
    const res = await politeFetch(endpoint);
    if (!res.ok) throw new Error(`listing: HTTP ${res.status}`);
    writeFileSync(path, await res.text());
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
  const doc = new JSDOM(html).window.document;
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
    career,
    description: intro ? blockText(intro) : "",
    requisiteText: requisiteText.length > 0 ? requisiteText : null,
  };
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

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

  const scrapeOne = async (code: string, origin: RawCourse["origin"], years: number[]): Promise<void> => {
    for (const y of years) {
      const page = await fetchCoursePage(code, y);
      if (page.kind === "ok") {
        scraped.set(code, extractCourse(page.html, code, y, origin, listed.get(code)));
        if (y !== years[0]) fellBackTo2025.push(code);
        return;
      }
      if (page.kind === "error") {
        failures.push({ code, error: page.error });
        return;
      }
    }
    notFound.push({ code, triedYears: years, referencedBy: [] });
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
