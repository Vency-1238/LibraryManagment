# RFID Library Management System

React + Appwrite library dashboard, deployed on Vercel, with an ESP32 + RC522
reader that talks to the same deployment over HTTPS.

```
rfid-project/
├─ firmware/
│  └─ RFID_Library/RFID_Library.ino   # ESP32 + RC522 sketch
├─ website/                           # the whole web app (Vercel root)
│  ├─ src/                            # React dashboard
│  ├─ api/                            # one Vercel Function per endpoint
│  │  ├─ health.js  scan.js  borrow.js  return.js
│  │  ├─ students.js  books.js  borrowings.js  scanlogs.js
│  │  └─ students/[id].js  books/[id].js  borrowings/[id].js
│  ├─ api-lib/                        # Appwrite access layer + route handlers
│  ├─ scripts/seed.js                 # optional demo-data seeder
│  ├─ vercel.json
│  └─ .env.example
└─ README.md
```

## How it fits together

| Client | Talks to | Auth |
| --- | --- | --- |
| React dashboard (`website/src`) | Appwrite Cloud, directly | public collection permissions |
| ESP32 (`/api/scan`, `/api/borrow`, …) | your deployed site → Vercel Function | none (public collection permissions) |
| Vercel Function (`website/api`) | Appwrite Cloud | `APPWRITE_API_KEY` if present, otherwise public |

There is no local server. The same `https://<your-app>.vercel.app` serves the
dashboard and the hardware API.

## Features

- Dashboard with seven real statistics: students, books, available books,
  active loans, returned books, overdue books and total RFID scans.
- Students page with ACTIVE/INACTIVE status, active-book count and remaining
  capacity (`2 / 4 books borrowed`).
- Books page with category, shelf location, rack number, ISBN, loan period,
  availability, search and category/availability filters, plus edit support.
- Permanent borrowing history with borrow batch IDs and
  All / BORROWED / RETURNED / OVERDUE filters.
- Scan Activity page backed by the optional `ScanLogs` collection.
- Insights page: book location finder, most borrowed books, most active
  students, most borrowed categories, last-7-days activity and per-student
  borrowing analytics.
- Server-enforced limit of **4 active books per student**, duplicate-loan
  protection and race-condition verification with rollback.
- Dynamic overdue detection: a record is overdue when it is still `BORROWED`
  and its `dueDate` has passed. Returned records are never overdue.
- ESP32 borrow/return modes, shared `borrowBatchId` per visit, and scan logging.

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel → **Add New Project** → import the repo.
3. **Root Directory: `website`** (important — the functions live in `website/api`).
   Vercel auto-detects Vite; `vercel.json` already sets build/output.
4. Add these Environment Variables (Project → Settings → Environment Variables):

   ```
   VITE_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
   VITE_APPWRITE_PROJECT_ID=...
   VITE_APPWRITE_DATABASE_ID=...
   VITE_APPWRITE_STUDENTS_COLLECTION_ID=...
   VITE_APPWRITE_BOOKS_COLLECTION_ID=...
   VITE_APPWRITE_BORROW_COLLECTION_ID=...
   VITE_APPWRITE_SCANLOGS_COLLECTION_ID=...   # after creating ScanLogs
   APPWRITE_SCANLOGS_COLLECTION_ID=...        # same value, used by the API
   APPWRITE_API_KEY=...                       # optional, see below
   ```

5. Deploy. Verify the API:

   ```bash
   curl https://<your-app>.vercel.app/api/health
   # {"status":"ok", ..., "appwrite":{"configured":true,"auth":"api-key","connected":true}}
   ```

`APPWRITE_API_KEY` is optional. When present it is used first; if it lacks
`documents.read` / `documents.write` Appwrite answers `401` and the function
retries anonymously, so the API keeps working with plain public permissions.

For a fully server-side setup, give the key these scopes:
`databases.read`, `collections.read`, `documents.read`, `documents.write`.
The current key in this project lacks `collections.read`, `collections.write`
and `documents.write`, so the API falls back to public permissions and cannot
create collections automatically.

## Local development

```bash
cd website
npm install
cp .env.example .env     # fill in your Appwrite values
npm run dev              # dashboard at http://localhost:5173
npm run seed             # optional: insert demo students/books
npm run build            # production build
```

To run the `/api` functions locally, use the Vercel CLI (`npx vercel dev`) —
it reads the same `.env` keys from your Vercel project or local env file.
`npm run dev` alone serves the Vite frontend only; return operations fall back
to direct Appwrite writes in development, while production always uses the
serverless API.

## Appwrite schema

The following schema was verified against the live project. Do **not** recreate
these collections. Existing documents were preserved.

### Students

| Attribute | Type | Notes |
| --- | --- | --- |
| `studentId` | string | Existing |
| `name` | string | Existing |
| `rfidUID` | string | Existing (8 hex characters) |
| `status` | string | Existing; required. `ACTIVE` / `INACTIVE` |
| `$createdAt` | datetime | Appwrite built-in registration timestamp |

Existing rows that predated the `status` attribute were backfilled to `ACTIVE`.
The dashboard also defaults a missing status to `ACTIVE` defensively. No
Department or Email attribute was added.

### Books

| Attribute | Type | Notes |
| --- | --- | --- |
| `bookId` | string | Existing |
| `title` | string | Existing |
| `rfidUID` | string | Existing (8 hex characters) |
| `loanPeriod` | string | Existing; treated as a number by the app |
| `status` | string | Existing; `AVAILABLE` / `BORROWED` |
| `category` | string | Existing optional metadata |
| `shelfLocation` | string | Existing optional metadata |
| `rackNumber` | string | Existing optional metadata |
| `isbn` | string | Existing optional metadata |

No Author attribute was added.

### Borrow

| Attribute | Type | Notes |
| --- | --- | --- |
| `studentId` | string | Existing |
| `bookId` | string | Existing |
| `issueDate` | datetime | Existing |
| `dueDate` | datetime | Existing |
| `returnDate` | datetime | Existing optional; stays empty until return |
| `status` | string | Existing; `BORROWED` / `RETURNED` |
| `borrowBatchId` | string | Existing; shared by one visit |

Every book gets its own Borrow document. Returning updates that same document;
it never creates a new one and never deletes history. `OVERDUE` is calculated
dynamically in the API and UI instead of being written to the database.

### ScanLogs (optional new collection)

This collection could **not** be created automatically because the current API
key lacks `collections.write`. Create it once in the Appwrite Console.

1. Appwrite Console → **Databases** → your database → **Create collection**.
2. Name it `ScanLogs` and use Collection ID `scanlogs` (or any ID you prefer).
3. Create these attributes:

   | Attribute | Type | Size | Required |
   | --- | --- | --- | --- |
   | `studentId` | string | 36 | no |
   | `bookId` | string | 36 | no |
   | `rfidUid` | string | 32 | no |
   | `scanType` | string | 20 | no |
   | `action` | string | 20 | no |
   | `status` | string | 20 | no |
   | `timestamp` | datetime | — | yes |
   | `message` | string | 500 | no |

   `studentId` and `bookId` are optional so invalid/unregistered scans can still
   be logged. `scanType` is `STUDENT` / `BOOK` / `UNKNOWN`; `action` is
   `BORROW` / `RETURN` / `INVALID`; `status` is `SUCCESS` / `FAILED`.

4. Recommended indexes (Settings → Indexes → Create Index, type **key**):

   | Index | Attribute |
   | --- | --- |
   | `timestamp_key` | `timestamp` |
   | `status_key` | `status` |
   | `action_key` | `action` |
   | `student_id_key` | `studentId` |
   | `book_id_key` | `bookId` |
   | `rfid_uid_key` | `rfidUid` |

5. Permissions: add **Any** (`role:all`) with **Read** and **Create**.
   Update/Delete are not needed. The dashboard reads ScanLogs directly; the
   Vercel API creates log rows (with the API key, or anonymously when the key
   lacks `documents.write`).
6. Copy the collection ID and set both variables locally and in Vercel:

   ```
   VITE_APPWRITE_SCANLOGS_COLLECTION_ID=<actual id>
   APPWRITE_SCANLOGS_COLLECTION_ID=<actual id>
   ```

7. Redeploy. Until this is done, borrowing/returning still work and the Scan
   Activity page explains that ScanLogs is not configured.

### Recommended indexes for existing collections

Indexes could not be inspected through the API (`collections.read` is missing).
Verify these in the Console and add only the missing ones:

- **Students**: unique `studentId`, unique `rfidUID`, key `status`.
- **Books**: unique `bookId`, unique `rfidUID`, key `status`, key `category`.
- **Borrow**: key `studentId` + `status`, key `bookId` + `status`, key `status`,
  key `issueDate`, key `borrowBatchId`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API + Appwrite connectivity, limit and ScanLogs status |
| POST | `/api/scan` | `{ uid, action?, studentId? }` → student or book info |
| POST | `/api/borrow` | `{ studentId, bookId, borrowBatchId?, rfidUid? }` |
| POST | `/api/return` | `{ studentId?, bookId?, borrowingId?, rfidUid? }` |
| GET | `/api/scanlogs` | Scan history (empty array until ScanLogs is configured) |
| GET | `/api/students`, `/api/books`, `/api/borrowings` | listings |
| POST | `/api/students`, `/api/books` | create |
| DELETE | `/api/students/:id`, `/api/books/:id` | delete when no history exists |
| DELETE | `/api/borrowings/:id` | always `403 HISTORY_IMMUTABLE` |

Request/response compatibility notes:

- `POST /api/scan` keeps the original `{ uid }` format. It now also accepts an
  optional `action` (`BORROW` / `RETURN`) and `studentId` for accurate scan
  logs. The response adds `scanAction`; existing fields are unchanged.
- `POST /api/borrow` keeps `{ studentId, bookId }`. `borrowBatchId` (or
  `batchId`) is optional; when omitted the backend generates one. The response
  adds `borrowBatchId`, `activeBooks`, `maxBooks` and `remaining`.
- `POST /api/return` accepts `borrowingId` (preferred), or `bookId` with an
  optional `studentId`. It updates the existing Borrow document and returns
  `RETURNED`.
- Error responses keep a clear `error` string and add a stable `code`
  (`MAX_BOOKS_REACHED`, `BOOK_UNAVAILABLE`, `STUDENT_INACTIVE`, …).

Each path is its own function file under `website/api`. Don't add a catch-all
(`api/[...slug].js`): Vercel invokes it for `/api/*` but passes `req.url === "/"`
with no `slug` param, so every route ends up answering
`{"error":"No route for …"}`.

### Concurrency and the 4-book limit

The limit is enforced on the server, never only in React:

1. Validate the student is registered and `ACTIVE`.
2. Validate the book exists and is `AVAILABLE`.
3. Reject if the student already has 4 active `BORROWED` records.
4. Reject if the book already has an active loan.
5. Create the Borrow record and set the book to `BORROWED`.
6. Re-read active loans for the student and book. If this request lost a race,
   its own new record is deleted and the book status is reconciled.

Appwrite transactions are not available with the current API key, so this is a
**pre-check + post-write verification + rollback** strategy, not a database
transaction. It prevents persistent over-limit or double-book states in the
tested scenarios; a brief transient state is possible under extreme concurrent
writes.

## Firmware

Open `firmware/RFID_Library/RFID_Library.ino` and set:

```cpp
const char* WIFI_SSID     = "...";
const char* WIFI_PASSWORD = "...";
const char* API_BASE_URL  = "https://your-app.vercel.app";  // no trailing slash
```

Upload, open the Serial Monitor at 115200 baud. The workflow is:

1. Choose **BORROW** or **RETURN** mode. Press the ESP32 **BOOT** button
   (GPIO 0) to toggle, or send `b` / `r` in the Serial Monitor (`s` prints the
   current mode).
2. Scan a student card. The backend returns the student and a `borrowBatchId`.
3. Scan a book tag. In BORROW mode the firmware calls `/api/borrow` with the
   student, book and batch ID. In RETURN mode it calls `/api/return` with the
   active borrowing ID.
4. The firmware prints the result and resets the session for the next student.

The original scan request format still works. The firmware now adds
`action` and `studentId` so scan logs can identify the workflow and student.
TLS is used automatically for `https://` URLs (certificate pinning is skipped so
Vercel certificate rotations don't break the device); `http://` URLs fall back
to a plain client for local testing.

## Verification performed

- `npm run build` — production build succeeded.
- API integration test — **57 checks passed**: existing data loading, scan
  validation, one record per book, shared batch IDs, 4-book limit, fifth-book
  rejection, return updates the existing record, history permanence, scan log
  endpoint, concurrent student/book races, and real data left untouched.
- Headless Chrome UI test — **23 checks passed**: all seven dashboard stats,
  students status/capacity, book metadata/filters/edit, borrowing history
  columns and filters, Scan Activity filters and setup notice, Insights
  analytics, and mobile bottom navigation without horizontal overflow.

## Manual configuration still required

- Create the `ScanLogs` collection in the Appwrite Console using the exact
  steps above. It was not created automatically because the API key cannot
  manage collections.
- Add `VITE_APPWRITE_SCANLOGS_COLLECTION_ID` and
  `APPWRITE_SCANLOGS_COLLECTION_ID` to `.env` and Vercel, then redeploy.
- Verify/add the recommended indexes. Existing indexes could not be inspected
  through the API.
- If you use a scoped API key, grant the scopes listed above; otherwise keep
  public collection permissions for reads and the operations the device needs.

## Git commands

```bash
git status
git add firmware website README.md
git commit -m "Add borrowing history, scan logs, analytics and 4-book limit"
git push origin main
```

Vercel deploys automatically from the connected branch. To deploy manually:

```bash
cd website
npx vercel --prod
```
