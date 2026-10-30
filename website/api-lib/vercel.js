import { route } from "./handlers.js";

/*
 * Wraps the shared router in a Vercel Function handler.
 *
 * Vercel resolves `api/*` functions by filename, so every endpoint lives in its
 * own file (api/scan.js, api/books.js, …) and passes its own segment list here.
 * This replaces the old `api/[...slug].js` catch-all: Vercel invoked that file
 * for /api/* but delivered `req.url === "/"` with no `slug` query param, so the
 * router always received an empty segment list and answered "No route for …".
 *
 * `segments` is either a fixed array or a function that derives the list from
 * the request (used by the `[id]` routes).
 */
export function endpoint(segments) {
  return async function handler(req, res) {
    const method = String(req.method || "GET").toUpperCase();
    const resolved = typeof segments === "function" ? segments(req) : segments;

    return route(method, resolved.filter(Boolean), req, res);
  };
}
