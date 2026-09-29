import node from "@astrojs/node";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

// Server-rendered output: pages render per request so they can read the
// database, and `astro build` emits the Node server the Dockerfile runs.
// Preact renders the planner/graph islands (PLAN.md §3.4); pages stay SSR.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [preact()],
  security: {
    // Fly's proxy terminates TLS, so naming the deploy domain is what lets
    // Astro trust x-forwarded-proto and accept same-origin form POSTs.
    allowedDomains: [{ hostname: "**.fly.dev", protocol: "https" }],
  },
});
