import { endpoint } from "../../api-lib/vercel.js";
import { routeParam } from "../../api-lib/http.js";

// DELETE /api/students/:id
export default endpoint((req) => ["students", routeParam(req, "id")]);
