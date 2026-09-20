import type { OpenAPIHono } from "@hono/zod-openapi";

import type { RoleClaim } from "./tokens";

/** What the Worker receives from its configuration. Bindings come from wrangler.jsonc. */
export interface Bindings {
  DB: D1Database;
  ENVIRONMENT: string;
  DEMO_MODE: string;
  /** Secret. Keys the audit hash chain. Set with `wrangler secret put`; never stored in the database. */
  AUDIT_HMAC_KEY: string;
  /** Secret. Signs access tokens. Set with `wrangler secret put`; never stored in the database. */
  SESSION_SECRET: string;
}

/** Who is making the request, read from the signed access cookie. No database read. */
export interface AuthContext {
  userPublicId: string;
  sessionPublicId: string;
  name: string;
  roles: RoleClaim[];
}

export type AppEnv = { Bindings: Bindings; Variables: { auth?: AuthContext } };
export type App = OpenAPIHono<AppEnv>;
