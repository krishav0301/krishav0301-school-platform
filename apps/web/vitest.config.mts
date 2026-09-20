import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    // CSS modules return their class names as written, so rendered markup can be asserted.
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
