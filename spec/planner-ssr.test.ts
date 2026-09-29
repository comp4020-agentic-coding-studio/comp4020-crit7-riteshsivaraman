import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import { addToTerm, api, moveToTerm } from "../src/components/planner/api";
import type { CatalogueCourse, PlannerState } from "../src/lib/contracts";

// Track D (PLAN.md §5.3): the planner page as the BUILT server renders it,
// per cookie jar (each jar is one browser's plan), plus the island's API
// client driven against the same server. Assertions are scoped to one card
// by data-entry-id, never a page-wide substring (LEARNINGS: weak-assertion
// class --- course codes also appear in the embedded bootstrap JSON).

const base = inject("baseUrl");
const realFetch = globalThis.fetch;

class Jar {
  cookie = "";
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const res = await realFetch(new URL(path, base), { ...init, headers, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    return res;
  }
  async page(): Promise<Document> {
    return new JSDOM(await (await this.fetch("/")).text()).window.document;
  }
  async add(code: string, year: number, period: string, slot: number): Promise<PlannerState> {
    const res = await this.fetch("/api/plan/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, year, period, slot }),
    });
    expect(res.status, `add ${code}`).toBe(201);
    return (await res.json()) as PlannerState;
  }
}

function card(doc: Document, state: PlannerState, code: string): HTMLElement {
  const entry = state.plan.entries.find((e) => e.code === code);
  expect(entry, `${code} in plan`).toBeDefined();
  const el = doc.querySelector<HTMLElement>(`article[data-entry-id="${entry!.id}"]`);
  expect(el, `card for ${code}`).not.toBeNull();
  return el!;
}

describe("planner SSR", () => {
  it("an empty plan renders the FirstRun guide and 6 term rows (3 years x S1/S2)", async () => {
    const doc = await new Jar().page();
    expect(doc.getElementById("how-it-works")).not.toBeNull();
    expect(doc.querySelectorAll("[data-term]").length).toBe(6);
    expect(doc.querySelectorAll("article[data-entry-id]").length).toBe(0);
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  it("COMP1110 alone: its card carries a red 'Needs' strip", async () => {
    const jar = new Jar();
    await jar.page();
    const state = await jar.add("COMP1110", 1, "S1", 0);
    const c = card(await jar.page(), state, "COMP1110");
    expect(c.classList.contains("card--violation")).toBe(true);
    expect(c.querySelector(".card__strip--error")?.textContent).toMatch(/Needs/);
    expect(c.ownerDocument.getElementById("how-it-works")).toBeNull();
  });

  it("COMP1100 + COMP1130: both cards say 'Incompatible with'", async () => {
    const jar = new Jar();
    await jar.page();
    await jar.add("COMP1100", 1, "S1", 0);
    const state = await jar.add("COMP1130", 1, "S1", 1);
    const doc = await jar.page();
    expect(card(doc, state, "COMP1100").querySelector(".card__issues")?.textContent).toMatch(/Incompatible with COMP1130/);
    expect(card(doc, state, "COMP1130").querySelector(".card__issues")?.textContent).toMatch(/Incompatible with COMP1100/);
  });

  it("a 24-course plan embeds <= 150 KB of bootstrap and not the whole catalogue", async () => {
    const comp = (JSON.parse(readFileSync("catalogue/COMP.json", "utf8")) as CatalogueCourse[]).filter((c) => !c.retired && c.level <= 3000);
    const codes = comp.slice(0, 24).map((c) => c.code);
    expect(codes.length).toBe(24);
    const jar = new Jar();
    await jar.page();
    let i = 0;
    for (const year of [1, 2, 3]) for (const period of ["S1", "S2"]) for (let slot = 0; slot < 4; slot++) await jar.add(codes[i++], year, period, slot);
    const doc = await jar.page();
    const island = [...doc.querySelectorAll("astro-island")].find((el) => el.getAttribute("component-url")?.includes("Planner"));
    const props = island?.getAttribute("props") ?? "";
    expect(props.length).toBeGreaterThan(1000); // it IS the bootstrap
    expect(props.length).toBeLessThanOrEqual(150 * 1024);
    // a course no COMP course references: in the catalogue, absent from the page
    const other = (JSON.parse(readFileSync("catalogue/ACST.json", "utf8")) as CatalogueCourse[])[0].code;
    expect(props).toContain(codes[0]);
    expect(props).not.toContain(other);
    expect(doc.querySelectorAll("article[data-entry-id]").length).toBe(24);
  });
});

describe("planner API client (the island's own requests) against the built server", () => {
  const jar = new Jar();
  let calls = 0;
  beforeEach(() => {
    calls = 0;
    // api.ts calls relative URLs with the browser's cookie; the jar plays the browser
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      return jar.fetch(String(input), init);
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("addToTerm places in the first free slot; a full term is SLOT_TAKEN with no request", async () => {
    let r = await addToTerm({ years: 3, summerYears: [], entries: [] }, "COMP1100", 1, "S1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.data.plan.entries.find((x) => x.code === "COMP1100");
    expect(e).toMatchObject({ year: 1, period: "S1", slot: 0 });
    r = await addToTerm(r.data.plan, "COMP1600", 1, "S1");
    expect(r.ok && r.data.plan.entries.find((x) => x.code === "COMP1600")?.slot).toBe(1);

    const full = { years: 3, summerYears: [], entries: [0, 1, 2, 3].map((slot) => ({ id: 100 + slot, code: `COMP10${slot}0`, year: 2, period: "S1" as const, slot })) };
    calls = 0;
    const blocked = await addToTerm(full, "COMP2100", 2, "S1");
    expect(blocked).toEqual({ ok: false, error: { error: "SLOT_TAKEN", message: "That semester is full." } });
    expect(calls).toBe(0);
  });

  it("moveToTerm moves the entry, and remove (DELETE) is accepted by the server", async () => {
    const plan = { data: (await (await jar.fetch("/api/plan")).json()) as PlannerState };
    const e = plan.data.plan.entries.find((x) => x.code === "COMP1100")!;
    const moved = await moveToTerm(plan.data.plan, e.id, 2, "S2");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.data.plan.entries.find((x) => x.id === e.id)).toMatchObject({ year: 2, period: "S2", slot: 0 });
    const gone = await api.removeEntry(e.id);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.data.plan.entries.some((x) => x.id === e.id)).toBe(false);
  });
});
