import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    /* Service worker, for one reason: telling a long-open dashboard that a new
       build exists. Glasshouse is left open for days on a wall — index.html is
       served no-cache, so a reload always gets the new bundle, but nothing ever
       reloads it. Without this, a deploy never reaches the screen you look at.

       registerType 'prompt', not 'autoUpdate': autoUpdate calls skipWaiting, so
       a live page can end up running old chunks against a new precache. The
       page shows "Update ready — Refresh" instead and swaps only when asked
       (components/UpdatePrompt.jsx). See also: the deploy must NOT mark sw.js
       immutable — .github/workflows/deploy.yml excludes it for that reason.

       NOTE — there is deliberately no `runtimeCaching`. Home Assistant lives on
       a different origin (VITE_HA_URL), so its REST calls and websocket are
       never touched by this SW: the websocket because service workers cannot
       intercept one, the REST calls because nothing here routes them. Keep it
       that way. A cached entity state means the dashboard confidently showing a
       light as on when it is off, which is worse than showing nothing. Only the
       app shell — same-origin, content-hashed — is precached. */
    VitePWA({
      registerType: "prompt",
      // The React hook in UpdatePrompt.jsx does the registering; the auto
      // injected registerSW.js would be a second, competing registration.
      injectRegister: null,
      // public/manifest.webmanifest is hand-written and already linked from
      // index.html. false = use that one, don't generate a rival.
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,webmanifest}"],
        // SPA: every navigation resolves to the shell. Safe for both OAuth
        // returns (HA's ?code= and Spotify's) — they come back to "/" with a
        // query string, which survives the fallback and is read at boot.
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
      // Never in dev — an SW caching a dev server is only ever confusing.
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, host: true },
});
