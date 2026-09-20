import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "worker-configuration.d.ts", ".wrangler", "openapi.json"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
);
