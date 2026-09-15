import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, dependencies, preserved legacy Python, and generated code.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "frontend/public/**",
      "src/**",
      "supabase/.temp/**",
      "frontend/src/types/database.ts",
    ],
  },
  js.configs.recommended,
  // Not the type-checked preset: `eslint .` stays fast enough for `npm run verify`.
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    files: ["frontend/src/**/*.{ts,tsx}", "frontend/*.ts", "frontend/vite.config.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The React Compiler rules below flag the component architecture the
      // 2026-09-14 audit already tracks (H3 workspace store, H4 todo
      // controllers, M3 dialog primitive). They are off until those land
      // rather than suppressed file by file; every other compiler rule
      // (static-components, use-memo, preserve-manual-memoization,
      // set-state-in-render, ...) stays on, as do rules-of-hooks and
      // exhaustive-deps.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/globals": "off",
      "react-hooks/error-boundaries": "off",
    },
  },
  {
    // Tests and QA fixtures mock loosely typed browser and provider surfaces.
    files: ["**/*.test.{ts,tsx}", "tests/**/*.ts", "frontend/src/qa/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettier,
);
