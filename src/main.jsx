import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Runs the Spotify OAuth callback at module load. It has to be imported here
// rather than left to the Media cards: those live in the lazily-loaded
// MediaView chunk, and Spotify redirects back to "/" with no ?tab=, so on the
// Overview landing tab the module was never evaluated and the ?code= was
// never exchanged.
import "./ha/spotify.js";
import App from "./App.jsx";
import { UpdatePrompt } from "./components/UpdatePrompt.jsx";
import "./styles/index.css";

// A sibling of <App/>, not a child of it: the "new version ready" bar is a
// fixed overlay that talks about the deployed bundle, and depends on no
// dashboard state at all. Mounting it here also keeps App.jsx — which is
// already at its 400-line ceiling — exactly as it was.
//
// Real deployments only. A mock-mode build (VITE_HA_URL="") is what the
// screenshot and console harness loads, and a service worker there would make
// those runs depend on whether an earlier run had cached the shell; a visual
// gate that passes on run order is worse than no gate. Nothing to offer
// locally either — this is the deployed artefact talking about itself.
const showUpdatePrompt = Boolean(import.meta.env.VITE_HA_URL);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
    {showUpdatePrompt && <UpdatePrompt />}
  </StrictMode>,
);
