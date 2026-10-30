import { route } from "../api-lib/handlers.js";

/*
 * Catch-all Vercel Function.
 *   /api/health        → ["health"]
 *   /api/students      → ["students"]
 *   /api/students/:id  → ["students", ":id"]
 *
 * Vercel's Node runtime only fills req.query from the query string — unlike
 * Next.js it does NOT expose `[...slug]` path params there, so the pathname is
 * parsed from req.url (with req.query.slug kept as a fallback).
 */
function resolveSegments(req) {
  const fromQuery = req.query?.slug ?? req.query?.path;
  if (fromQuery) {
    return (Array.isArray(fromQuery) ? fromQuery : [fromQuery]).filter(Boolean);
  }

  const pathname = String(req.url || "/")
    .split("?")[0]
    .split("#")[0]
    .replace(/^https?:\/\/[^/]+/i, "");

  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "api") segments.shift();

  return segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

export default async function handler(req, res) {
  const segments = resolveSegments(req);
  const method = String(req.method || "GET").toUpperCase();

  return route(method, segments, req, res);
}
