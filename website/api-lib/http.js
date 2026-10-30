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
