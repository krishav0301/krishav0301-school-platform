import type { OpenAPIHono } from "@hono/zod-openapi";

/** What the Worker receives from its configuration. Bindings come from wrangler.jsonc. */
export interface Bindings {
  DB: D1Database;
  ENVIRONMENT: string;
  DEMO_MODE: string;
  /** Secret. Keys the audit hash chain. Set with `wrangler secret put`; never stored in the database. */
  AUDIT_HMAC_KEY: string;
}

export type AppEnv = { Bindings: Bindings };
export type App = OpenAPIHono<AppEnv>;
