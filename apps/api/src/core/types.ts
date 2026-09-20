import type { OpenAPIHono } from "@hono/zod-openapi";

/** What the Worker receives from its configuration. Bindings come from wrangler.jsonc. */
export interface Bindings {
  DB: D1Database;
  ENVIRONMENT: string;
  DEMO_MODE: string;
}

export type AppEnv = { Bindings: Bindings };
export type App = OpenAPIHono<AppEnv>;
