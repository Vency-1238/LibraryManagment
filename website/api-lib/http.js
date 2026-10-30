export function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function normalizeText(value, maxLength = 100) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeUid(value) {
  const compact = String(value ?? "").toUpperCase().replace(/[^0-9A-F]/g, "");
  return /^[0-9A-F]{8}$/.test(compact) ? compact : null;
}

export function appwriteErrorStatus(error) {
  if (error?.code === 404) return 404;
  if (error?.code === 409) return 409;
  return 503;
}

export function sendDatabaseError(res, error) {
  const status = appwriteErrorStatus(error);
  console.error("[Appwrite]", error);
  return send(res, status, {
    error: status === 503 ? "Appwrite database is unavailable" : error.message
  });
}

/*
 * Reads a path parameter for a `[param]` route. Vercel fills req.query from the
 * dynamic segment, but the raw pathname is used as a fallback (and `?id=` also
 * works) so the route keeps working if the platform stops injecting it.
 */
export function routeParam(req, name) {
  const fromQuery = req.query?.[name];
  const value = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (value) return String(value);

  const pathname = String(req.url || "")
    .split("?")[0]
    .split("#")[0]
    .replace(/^https?:\/\/[^/]+/i, "");
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return "";

  try {
    return decodeURIComponent(segments[segments.length - 1]);
  } catch {
    return segments[segments.length - 1];
  }
}

export function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}
