// Types for Astro.locals, set by src/middleware.ts (server-only).
declare namespace App {
  interface Locals {
    /** The dp_plan cookie value: this browser's plan id (22-char base64url). */
    planId: string;
  }
}
