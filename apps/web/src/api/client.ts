import createClient from "openapi-fetch";

import type { paths } from "./schema";

export type ApiClient = ReturnType<typeof createApiClient>;

// The API is on the same origin as the page (D-021), so requests are relative and cookies are
// same-site. Cloudflare serves /api/* from the Worker; in development `next dev` forwards it.
// `baseUrl` is for tests only: outside a browser a relative address has nothing to resolve against.
export function createApiClient(options: { fetch?: (request: Request) => Promise<Response>; baseUrl?: string } = {}) {
  return createClient<paths>({ baseUrl: "", credentials: "same-origin", ...options });
}
