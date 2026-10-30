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
│  │  ├─ students.js  books.js  borrowings.js
│  │  └─ students/[id].js  books/[id].js  borrowings/[id].js
│  ├─ api-lib/                        # Appwrite access layer + route handlers
│  ├─ scripts/seed.js                 # one-time demo data seeder
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
   APPWRITE_API_KEY=...        # optional, see below
   ```

5. Deploy. Verify the API:

   ```bash
   curl https://<your-app>.vercel.app/api/health
   # {"status":"ok", ..., "appwrite":{"configured":true,"auth":"api-key","connected":true}}
   ```

`APPWRITE_API_KEY` is optional. When present it is used first; if it lacks
`documents.read` / `documents.write` Appwrite answers `401` and the function
retries anonymously, so the API keeps working with plain public permissions.

## Local development

```bash
cd website
npm install
cp .env.example .env     # fill in your Appwrite values
npm run dev              # dashboard at http://localhost:5173
npm run seed             # optional: insert demo students/books
```

To run the `/api` functions locally, use the Vercel CLI (`npx vercel dev`) —
it reads the same `.env` keys from your Vercel project or local env file.

## Appwrite schema

- **students** — `studentId`, `name`, `rfidUID`
- **books** — `bookId`, `title`, `rfidUID`, `loanPeriod`, `status`
  (`loanPeriod` may be integer or string; the API handles both)
- **borrowings** — `studentId`, `bookId`, `issueDate`, `dueDate`, `returnDate`, `status`

Collections need public read/create/update/delete for the dashboard and the
device API to work without a key.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API + Appwrite connectivity |
| POST | `/api/scan` | `{ uid }` → student or book info |
| POST | `/api/borrow` | `{ studentId, bookId }` |
| POST | `/api/return` | `{ bookId }` |
| GET | `/api/students`, `/api/books`, `/api/borrowings` | listings |
| POST | `/api/students`, `/api/books` | create |
| DELETE | `/api/students/:id`, `/api/books/:id`, `/api/borrowings/:id` | delete (`?id=` also works) |

Each path is its own function file under `website/api`. Don't add a catch-all
(`api/[...slug].js`): Vercel invokes it for `/api/*` but passes `req.url === "/"`
with no `slug` param, so every route ends up answering
`{"error":"No route for …"}`.

## Firmware

Open `firmware/RFID_Library/RFID_Library.ino` and set:

```cpp
const char* WIFI_SSID     = "...";
const char* WIFI_PASSWORD = "...";
const char* API_BASE_URL  = "https://your-app.vercel.app";  // no trailing slash
```

Upload, open the Serial Monitor at 115200 baud, then scan a student card and a
book tag. TLS is used automatically for `https://` URLs (certificate pinning is
skipped so Vercel certificate rotations don't break the device); `http://` URLs
fall back to a plain client for local testing.
