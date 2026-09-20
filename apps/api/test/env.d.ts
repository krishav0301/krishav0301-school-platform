// Extra bindings that exist only in tests (see wrangler.test.jsonc and vitest.config.ts).
// Global on purpose: `wrangler types` declares `Cloudflare.Env`, and this adds to it.
declare namespace Cloudflare {
  interface Env {
    /** A second database, for tests that deliberately tamper with the audit log. */
    SCRATCH_DB: D1Database;
    /** Test-only key for the audit hash chain. Real deployments use a secret. */
    AUDIT_HMAC_KEY: string;
    /** Test-only key for signing access tokens. Real deployments use a secret. */
    SESSION_SECRET: string;
    /** The real migrations, applied to both test databases before each test file. */
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }
}
