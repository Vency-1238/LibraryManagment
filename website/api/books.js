import { endpoint } from "../api-lib/vercel.js";

// GET /api/books   → list
// POST /api/books  → create
export default endpoint(["books"]);
