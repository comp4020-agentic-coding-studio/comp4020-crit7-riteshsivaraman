import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";

// HTTP-level: drives the running app to prove the core flow survives a
// reload --- add a plan entry, reload the page, and the course is still
// there in its term. Same shape as the guestbook probe it replaces.
const baseUrl = inject("baseUrl");

describe("plan builder", () => {
  let courseCode: string;

  beforeAll(() => {
    // COMP1100 has no requisites, so adding it can't be rejected by the
    // rule engine --- this test is about persistence, not satisfaction.
    courseCode = "COMP1100";
  });

  // Astro checks form POSTs carry a same-origin Origin header; browsers send
  // it automatically, a bare fetch doesn't.
  const post = (path: string, body: URLSearchParams) =>
    fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { origin: baseUrl },
      body,
      redirect: "manual",
    });

  it("accepts a plan entry and redirects back to the page", async () => {
    const res = await post("/api/plan-entries", new URLSearchParams({ courseCode, termIndex: "0" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  it("persists the entry: a fresh page load shows it in its term", async () => {
    const res = await fetch(baseUrl);
    const html = await res.text();
    // courseCode alone also matches the unrelated <option> in the add-course
    // <select>, so this would pass even if the insert silently no-opped ---
    // assert on the plan-entry markup specifically (the course code rendered
    // as a <strong>, and a hidden remove-form id) instead.
    expect(html).toContain(`<strong>${courseCode}</strong>`);
    expect(html).toMatch(/name="id" value="\d+"/);
  });

  it("removing the entry drops it from the page", async () => {
    const before = await (await fetch(baseUrl)).text();
    const match = before.match(/name="id" value="(\d+)"/);
    if (!match) throw new Error("could not find a plan entry id to remove");
    const id = match[1];

    const res = await post("/api/plan-entries/remove", new URLSearchParams({ id }));
    expect(res.status).toBe(303);

    const after = await (await fetch(baseUrl)).text();
    expect(after).not.toContain(`name="id" value="${id}"`);
  });

  it("ignores an unknown course code (no crash, no phantom entry)", async () => {
    const res = await post("/api/plan-entries", new URLSearchParams({ courseCode: "NOPE9999", termIndex: "0" }));
    expect(res.status).toBe(303);

    const after = await (await fetch(baseUrl)).text();
    expect(after).not.toContain("NOPE9999");
  });
});
