import { applyD1Migrations, env } from "cloudflare:test";

// Runs before every test file: both test databases get the real schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.SCRATCH_DB, env.TEST_MIGRATIONS);
