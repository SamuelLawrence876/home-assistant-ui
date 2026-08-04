/* Vitest config — kept separate from vite.config.js so the dev/build config
   stays exactly what it was.

   Tests live in tests/ rather than beside the source they cover. That is
   deliberate: `npm run lint` is `eslint src/ scripts/`, and the eslint config
   declares only browser + node globals, so a *.test.js under src/ would fail
   `no-undef` on describe / it / expect / vi. Moving the suite out of src/ keeps
   the lint gate meaningful without weakening it.

   No network, no Home Assistant, no browser: environment is jsdom and every
   test that would otherwise reach the Pi mocks src/ha/socket.js.

   @vitejs/plugin-react is deliberately NOT loaded here. Vitest's own JSX
   transform already uses React's automatic runtime, so the plugin adds only
   Fast Refresh (meaningless in a test run) — and under Vitest 4 it also emits
   two deprecation warnings on every run. A run that always prints warnings is
   a run people stop reading (LESSONS.md, "two things that were never
   running"). Dropping it also halves the suite's wall time. */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // `virtual:pwa-register/react` only exists once vite-plugin-pwa has run,
      // and this config deliberately loads no plugins. Without the alias any
      // test that reaches UpdatePrompt dies in import analysis, before mocks.
      {
        find: "virtual:pwa-register/react",
        replacement: `${here}tests/stubs/pwaRegister.js`,
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.{js,jsx}"],
    // A test that hangs is a test nobody runs. Nothing here talks to a network.
    testTimeout: 5000,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
