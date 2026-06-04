/* Minimal lint: catch undefined identifiers (the failure mode of file splits)
   and stop files regrowing past 400 lines (REFACTOR_PLAN.md phase 5). */
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    files: ["src/**/*.{js,jsx}", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    // Inline eslint-disable comments in src reference react-hooks rules we
    // don't load; ignore inline config rather than erroring on unknown rules.
    linterOptions: { noInlineConfig: true },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
      "no-empty": "off",               // empty catch {} is house style for best-effort calls
      "no-useless-assignment": "off",  // day/night branch pattern in WeatherSunHero
    },
  },
];
