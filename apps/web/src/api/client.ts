import createClient from "openapi-fetch";

import type { paths } from "./schema";

// Server components call Django directly. The browser calls the same origin,
// and next.config.ts proxies /api/* to Django, so cookies stay same-site.
const serverOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

export function createApiClient() {
  const baseUrl = typeof window === "undefined" ? serverOrigin : "";
  return createClient<paths>({ baseUrl, credentials: "include" });
}
