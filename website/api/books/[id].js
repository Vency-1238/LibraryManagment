import { endpoint } from "../../api-lib/vercel.js";
import { routeParam } from "../../api-lib/http.js";

// DELETE /api/books/:id
export default endpoint((req) => ["books", routeParam(req, "id")]);
