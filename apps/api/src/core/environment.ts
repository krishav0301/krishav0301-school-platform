import { createMiddleware } from "hono/factory";

import type { AppEnv } from "./types";

export const ENVIRONMENTS = ["development", "test", "staging", "production"] as const;

/**
 * Refuse to run in a configuration that could expose demo tooling.
 * Demo mode turns on the persona switcher and the reset command. It must never be reachable
 * in production. Neither must the dev email adapter.
 */
export function validateEnvironment(name: string, demoMode: boolean, emailAdapter?: string): void {
  if (!(ENVIRONMENTS as readonly string[]).includes(name)) {
    throw new Error(`ENVIRONMENT must be one of ${ENVIRONMENTS.join(", ")}, got "${name}".`);
  }
  if (demoMode && name === "production") {
    throw new Error("DEMO_MODE must be off when ENVIRONMENT is production.");
  }
  // The dev adapter keeps email in the database instead of sending it, so real people would never get it.
  if (emailAdapter === "dev" && name === "production") {
    throw new Error('EMAIL_ADAPTER "dev" must not be used when ENVIRONMENT is production.');
  }
}

/** Checked on every request, so a bad configuration fails loudly and never serves traffic. */
export const environmentGuard = createMiddleware<AppEnv>(async (c, next) => {
  try {
    validateEnvironment(c.env.ENVIRONMENT, c.env.DEMO_MODE === "true", c.env.EMAIL_ADAPTER);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return c.json({ error: "server_misconfigured" }, 500);
  }
  await next();
});
