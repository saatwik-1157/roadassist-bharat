import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  // vendor/ holds third-party libraries (Leaflet, markercluster) served as-is —
  // never our code to lint.
  { ignores: ["**/node_modules/**", "**/dist/**", "**/drizzle/**", "**/*.d.ts", "**/vendor/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Unused code is a review smell; an underscore prefix is the escape hatch.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Drizzle's inferred types are wide; `any` stays reportable but not fatal
      // while the schema is still moving.
      "@typescript-eslint/no-explicit-any": "warn",
      eqeqeq: ["error", "smart"],
      "no-console": "off",
    },
  },
];
