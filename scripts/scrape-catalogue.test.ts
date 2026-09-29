import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type FetchConfig, fetchCoursePage } from "./scrape-catalogue.ts";

// Sensor for the 57-minute hang (LEARNINGS: network I/O without deadlines):
// a P&C request that never answers must be aborted and retried within a
// bounded time, never block the batch forever. Local servers only; nothing
// here touches the real site.

type Handler = (req: IncomingMessage, res: ServerResponse, n: number) => void;
const servers: Server[] = [];
const dirs: string[] = [];

async function serve(handler: Handler): Promise<{ base: string; hits: () => number }> {
  let n = 0;
  const server = createServer((req, res) => handler(req, res, ++n));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, hits: () => n };
}

function cfg(base: string): FetchConfig {
  const cacheDir = mkdtempSync(join(tmpdir(), "scrape-test-"));
  dirs.push(cacheDir);
  return { base, cacheDir, minGapMs: 0, attempts: 3, backoffMs: 50, timeoutMs: 300 };
}

const COURSE_PAGE = '<html><h1 class="intro__degree-title">x</h1></html>';

afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scraper fetch deadlines", () => {
  it("aborts a request that is accepted but never answered, retries, then gives up", { timeout: 8000 }, async () => {
    const { base, hits } = await serve(() => {}); // accept, never respond
    const t0 = Date.now();
    const page = await fetchCoursePage("COMP1100", 2026, cfg(base));
    const elapsed = Date.now() - t0;
    expect(page.kind).toBe("error");
    expect(hits()).toBe(3); // every attempt reached the server: the timeout fed the retry loop
    expect(elapsed).toBeLessThan(3 * 300 + 50 + 100 + 1500); // bounded: 3 deadlines + backoff + slack
  });

  it("aborts a response whose body stalls after the headers", { timeout: 8000 }, async () => {
    const { base, hits } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html>"); // ...and nothing more
    });
    const page = await fetchCoursePage("COMP1100", 2026, cfg(base));
    expect(page.kind).toBe("error");
    expect(hits()).toBe(3);
  });

  it("recovers when a hung first attempt is followed by a good answer", { timeout: 8000 }, async () => {
    const { base, hits } = await serve((_req, res, n) => {
      if (n === 1) return; // hang
      res.writeHead(200, { "content-type": "text/html" });
      res.end(COURSE_PAGE);
    });
    const page = await fetchCoursePage("COMP1100", 2026, cfg(base));
    expect(page).toEqual({ kind: "ok", html: COURSE_PAGE });
    expect(hits()).toBe(2);
  });
});
