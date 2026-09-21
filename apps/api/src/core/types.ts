import type { OpenAPIHono } from "@hono/zod-openapi";

import type { Grant } from "./permissions/authorize";
import type { RoleClaim } from "./tokens";

/** What the Worker receives from its configuration. Bindings come from wrangler.jsonc. */
export interface Bindings {
  DB: D1Database;
  /** The Next-built static web app (Workers Static Assets). Absent in tests, which pass a stand-in. */
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  DEMO_MODE: string;
  /** Secret. Keys the audit hash chain. Set with `wrangler secret put`; never stored in the database. */
  AUDIT_HMAC_KEY: string;
  /** Secret. Signs access tokens. Set with `wrangler secret put`; never stored in the database. */
  SESSION_SECRET: string;
  /** Secret. Seals values that must be stored but not readable from a database copy (D-034). */
  DATA_KEY: string;
  /** Which email adapter to use: "dev" (writes to the dev mailbox). Refused in production. */
  EMAIL_ADAPTER?: string;
  /** The address people use to reach this school's site, for links in emails, such as https://school.example. */
  SITE_ORIGIN?: string;
}

/** Who is making the request, read from the signed access cookie. No database read. */
export interface AuthContext {
  userPublicId: string;
  sessionPublicId: string;
  name: string;
  roles: RoleClaim[];
}

export type AppEnv = { Bindings: Bindings; Variables: { auth?: AuthContext; grant?: Grant } };
export type App = OpenAPIHono<AppEnv>;
