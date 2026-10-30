import { route } from "../api-lib/handlers.js";

/*
 * Catch-all Vercel Function.
 *   /api/health        → ["health"]
 *   /api/students      → ["students"]
 *   /api/students/:id  → ["students", ":id"]
 */
export default async function handler(req, res) {
  const raw = req.query?.slug ?? req.query?.path ?? [];
  const segments = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  const method = String(req.method || "GET").toUpperCase();

  return route(method, segments, req, res);
}
