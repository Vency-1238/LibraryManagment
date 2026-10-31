/*
 * Thin client for the Vercel Functions in website/api.
 *
 * The dashboard reads Appwrite directly (public read permissions), but write
 * actions that must enforce business rules (returns) go through the backend so
 * the same validation is used by the website and the ESP32.
 */
async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const error = new Error(
      "The API route is not available. Run `npx vercel dev` to serve /api locally."
    );
    error.status = response.status;
    error.unavailable = true;
    throw error;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data?.code;
    error.data = data;
    throw error;
  }

  return data;
}

export function returnBook({ studentId, bookId, borrowingId }) {
  return postJson("/api/return", { studentId, bookId, borrowingId });
}

export function borrowBook({ studentId, bookId, borrowBatchId }) {
  return postJson("/api/borrow", { studentId, bookId, borrowBatchId });
}
