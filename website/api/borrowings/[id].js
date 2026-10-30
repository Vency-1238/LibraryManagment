import { endpoint } from "../../api-lib/vercel.js";
import { routeParam } from "../../api-lib/http.js";

// DELETE /api/borrowings/:id
export default endpoint((req) => ["borrowings", routeParam(req, "id")]);
