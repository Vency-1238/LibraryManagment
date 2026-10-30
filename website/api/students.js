import { endpoint } from "../api-lib/vercel.js";

// GET /api/students   → list
// POST /api/students  → create
export default endpoint(["students"]);
