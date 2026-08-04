/* Minimal lint: catch undefined identifiers (the failure mode of file splits)
   and stop files regrowing past 400 lines (REFACTOR_PLAN.md phase 5).

   Inline suppressions
   -------------------
   `noInlineConfig` makes every `// eslint-disable*` comment in src/ and
   scripts/ inert, and ESLint reports each one it finds. That is deliberate,
   and it is not a way of hiding warnings — it is the opposite.

   The only inline directives this repo has ever contained name
   `react-hooks/exhaustive-deps`, a rule from `eslint-plugin-react-hooks`.
   That plugin is not a dependency and never has been, so the rule has never
   run: every one of those comments suppressed nothing while reading like it
   did. Worse, without `noInlineConfig` a directive naming an unloaded rule is
   a hard ESLint *error* ("Definition for rule ... was not found"), so the
   setting is also what keeps `npm run lint` from failing outright on them.

   The fix is to delete the comments, not to make them work: a dependency array
   that deviates from the exhaustive set should say why in prose, next to the
   deviation. Each remaining directive is reported as a warning naming its file
   and line — that list is the to-do list.

   When the last one is gone, delete `noInlineConfig` below so that genuine
   suppressions of rules this config *does* load start working again. Do not
   add the setting back to silence a warning. */
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
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "warn",
    },
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
