/* Minimal lint: catch undefined identifiers (the failure mode of file splits)
   and stop files regrowing past 400 lines.

   Inline suppressions
   -------------------
   `// eslint-disable*` comments work, for the rules this config loads. They
   used to be inert: `noInlineConfig` was set, on purpose, until the last of
   the old ones was gone. The only directives this repo ever held named
   `react-hooks/exhaustive-deps`, from `eslint-plugin-react-hooks`, which is
   not a dependency and never has been — so they suppressed nothing while
   reading like they did, and without the setting each was a hard error
   ("Definition for rule ... was not found"). They have all been deleted, and
   the setting went with them.

   Before adding one: a dependency array that deviates from the exhaustive set
   says why in prose, next to the deviation — that is the house pattern, not a
   directive. A directive naming a rule this config doesn't load fails lint,
   and one that suppresses nothing is reported as a warning. */
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
