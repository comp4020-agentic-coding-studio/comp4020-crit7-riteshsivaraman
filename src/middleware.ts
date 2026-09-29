// Per-browser identity (PLAN.md §3.2). Server-only; reads no process.env.
//
// Reads the dp_plan cookie; if it's absent or malformed, mints 16 random
// bytes (22 chars base64url) and sets it. The plans row is NOT created here:
// that happens on the first mutation, so crawlers and GET-only visitors never
// write to the database.
import { randomBytes } from "node:crypto";
import { defineMiddleware } from "astro:middleware";

export const PLAN_COOKIE = "dp_plan";
const VALID = /^[A-Za-z0-9_-]{22}$/;
const MAX_AGE = 34_560_000; // 400 days, the browser maximum

export const onRequest = defineMiddleware((context, next) => {
  const existing = context.cookies.get(PLAN_COOKIE)?.value;
  if (existing && VALID.test(existing)) {
    context.locals.planId = existing;
  } else {
    const id = randomBytes(16).toString("base64url");
    context.locals.planId = id;
    context.cookies.set(PLAN_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
      // behind Fly's proxy Astro trusts x-forwarded-proto (astro.config.ts
      // allowedDomains), so this is true in production
      secure: context.url.protocol === "https:",
    });
  }
  return next();
});
