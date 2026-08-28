/**
 * Phase 3.2 — ESLint configuration using typescript-eslint + prettier.
 * Rules: warn on unused vars (ignore _prefixed args), warn on explicit any,
 * ignore dist/generated/node_modules/src/views (browser scripts).
 */
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: ["dist/", "generated/", "node_modules/", "src/views/"],
  },
);
