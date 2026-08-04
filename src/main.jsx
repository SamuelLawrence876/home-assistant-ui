import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Runs the Spotify OAuth callback at module load. It has to be imported here
// rather than left to the Media cards: those live in the lazily-loaded
// MediaView chunk, and Spotify redirects back to "/" with no ?tab=, so on the
// Overview landing tab the module was never evaluated and the ?code= was
// never exchanged.
import "./ha/spotify.js";
import App from "./App.jsx";
import "./styles/index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
