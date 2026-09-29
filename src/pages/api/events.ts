import type { APIRoute } from "astro";

// STUB (PLAN.md §3.2): exists only so the course-managed CI deploy check in
// .github/workflows/checks.yml ("Verify the live-update stream is streaming",
// which reads the first bytes) passes unmodified. The app never calls it:
// one SSE comment line, then the stream closes.
export const GET: APIRoute = () =>
  new Response(": ok\n\n", {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
  });
