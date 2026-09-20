import createClient from "openapi-fetch";

import type { paths } from "./schema";

// The API is on the same origin as the page (D-021), so requests are relative and cookies are
// same-site. Cloudflare serves /api/* from the Worker; in development `next dev` forwards it.
export function createApiClient(options: { fetch?: (request: Request) => Promise<Response> } = {}) {
  return createClient<paths>({ baseUrl: "", credentials: "same-origin", ...options });
}
