/**
 * seed.js — one-time script to populate Appwrite with the demo library data.
 *
 * Usage:
 *   npm run seed
 *
 * Reads website/.env. APPWRITE_API_KEY is optional: without it (or when the key
 * lacks scopes) the script falls back to Appwrite's public permissions, which is
 * how the deployed site writes too.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Client, Databases, ID, Query } from "node-appwrite";

// ---------- load .env ----------
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env");

function loadEnv(path) {
  try {
    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    console.error("Could not read .env — make sure it exists in website/");
    process.exit(1);
  }
}

loadEnv(envPath);

// ---------- config (VITE_* first, APPWRITE_* accepted) ----------
const env = (...names) => names.map((n) => process.env[n]).find(Boolean);

const ENDPOINT = env("VITE_APPWRITE_ENDPOINT", "APPWRITE_ENDPOINT");
const PROJECT = env("VITE_APPWRITE_PROJECT_ID", "APPWRITE_PROJECT_ID");
const API_KEY = env("APPWRITE_API_KEY");
const DB = env("VITE_APPWRITE_DATABASE_ID", "APPWRITE_DATABASE_ID");
const S_COL = env("VITE_APPWRITE_STUDENTS_COLLECTION_ID", "APPWRITE_STUDENTS_COLLECTION_ID");
const B_COL = env("VITE_APPWRITE_BOOKS_COLLECTION_ID", "APPWRITE_BOOKS_COLLECTION_ID");
const BOR_COL = env("VITE_APPWRITE_BORROW_COLLECTION_ID", "APPWRITE_BORROW_COLLECTION_ID");

if (!ENDPOINT || !PROJECT || !DB || !S_COL || !B_COL || !BOR_COL) {
  console.error("Missing environment variables. Check your .env file.");
  process.exit(1);
}

function buildDatabases(key) {
  const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT);
  if (key) client.setKey(key);
  return new Databases(client);
}

const keyed = API_KEY ? buildDatabases(API_KEY) : null;
const anonymous = buildDatabases();

function isScopeError(error) {
  return error?.code === 401 || error?.type === "general_unauthorized_scope";
}

async function call(operation) {
  if (keyed) {
    try {
      return await operation(keyed);
    } catch (error) {
      if (!isScopeError(error)) throw error;
      console.log("  (API key is missing scopes — using public access)");
      return operation(anonymous);
    }
  }
  return operation(anonymous);
}

// ---------- helpers ----------
async function findOne(col, field, value) {
  const res = await call((db) => db.listDocuments(DB, col, [Query.equal(field, value), Query.limit(1)]));
  return res.documents[0] ?? null;
}

async function upsertStudent(studentId, name, rfidUID) {
  const existing = await findOne(S_COL, "studentId", studentId);
  if (existing) {
    if (!existing.status) {
      await call((db) => db.updateDocument(DB, S_COL, existing.$id, { status: "ACTIVE" }));
      console.log(`  ~ Added missing status to student: ${studentId} — ${name}`);
    } else {
      console.log(`  = Student already exists: ${studentId} — ${name}`);
    }
    return;
  }
  await call((db) => db.createDocument(DB, S_COL, ID.unique(), {
    studentId,
    name,
    rfidUID,
    status: "ACTIVE",
  }));
  console.log(`  + Created student: ${studentId} — ${name}`);
}

async function upsertBook(bookId, title, rfidUID, loanPeriod) {
  if (await findOne(B_COL, "bookId", bookId)) {
    console.log(`  = Book already exists: ${bookId} — ${title}`);
    return;
  }
  const payload = { bookId, title, rfidUID, loanPeriod, status: "AVAILABLE" };
  try {
    await call((db) => db.createDocument(DB, B_COL, ID.unique(), payload));
  } catch (error) {
    if (!/loanPeriod/i.test(String(error?.message))) throw error;
    await call((db) => db.createDocument(DB, B_COL, ID.unique(), { ...payload, loanPeriod: String(loanPeriod) }));
  }
  console.log(`  + Created book: ${bookId} — ${title}`);
}

// ---------- seed data ----------
const STUDENTS = [
  ["23BCP230",  "Vency Thummar",   "487E00E7"],
  ["23BCP525D", "Vaidehi Desai",   "C38BB038"],
  ["23BCP209",  "Prit Donga",      "C3647D33"],
  ["23BCP509D", "Krina Senjaliya", "E86802E6"],
];

const BOOKS = [
  ["1", "Internet of Things", "93BF8733", 14],
];

// ---------- main ----------
(async () => {
  console.log("\nSeeding RFID Library — Appwrite Database\n");
  console.log(`    Endpoint:  ${ENDPOINT}`);
  console.log(`    Project:   ${PROJECT}`);
  console.log(`    Database:  ${DB}\n`);

  try {
    console.log("  Students:");
    for (const [id, name, uid] of STUDENTS) await upsertStudent(id, name, uid);

    console.log("\n  Books:");
    for (const [id, title, uid, days] of BOOKS) await upsertBook(id, title, uid, days);

    console.log("\nSeed complete.\n");
  } catch (err) {
    console.error("\nSeed failed:", err.message);
    process.exit(1);
  }
})();
