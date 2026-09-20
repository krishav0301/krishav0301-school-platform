import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // The real migrations are applied to the test databases, so tests run against the real schema.
  const migrations = await readD1Migrations(`${import.meta.dirname}/migrations`);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      // Password hashing is deliberately slow (about 0.4 s here, several times that on a busy CI
      // runner). Many tests hash a password, so the default 5 s is too tight.
      testTimeout: 60_000,
      hookTimeout: 120_000,
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
