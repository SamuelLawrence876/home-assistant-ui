/* Glasshouse — post-login boot / startup animation.

   Ported from the Claude Design handoff (login/boot.jsx + login.css).
   After the HA OAuth login returns and App mounts, this overlay plays a
   short branded startup sequence over a dark void while the WebSocket
   connects and the first entity snapshot arrives. At the finale a white
   bloom flashes and the void clears away to reveal the dashboard that has
   been rendering underneath the whole time — so it "comes to light"
   rather than flashing in. No navigation.

   Phases (mirrors the prototype's useUnlock, minus the password step,
   since the real login is the HA OAuth redirect):
     reveal → the animation plays; held until data is ready AND a minimum
              run-time has elapsed, capped so we never wait forever
     enter  → bloom flashes, void + stage clear, dashboard revealed
     (then) → onDone() unmounts the overlay

   Self-contained: CSS lives in boot.css, keyed off .gh-boot[data-phase]. */

import { useEffect, useMemo, useRef, useState } from "react";
import "./boot.css";

/* How long the reveal animation plays at minimum (lets the tiles snap,
   wordmark stream in, and tag land before we whoosh through). */
const MIN_REVEAL_MS = 2350;
/* Hard cap — proceed even if the WS never delivers a snapshot (HA offline);
   the dashboard falls back to GH_DATA mock state underneath. */
const MAX_WAIT_MS = 8000;
/* Finale length — bloom flash + void clear before we unmount. */
const EXIT_MS = 1050;

function HomeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 11.4 12 4l9 7.4" />
      <path d="M5.5 9.9V19.5h13V9.9" />
      <path d="M9.8 19.5v-5.2h4.4v5.2" />
    </svg>
  );
}

/* ---- ASSEMBLE: glass tiles tumble in and snap into the mark ---- */
function AssembleBoot() {
  const tiles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 9; i++) {
      const ang = (i * 97 + 18) % 360;
      const dist = 230 + (i % 3) * 70;
      arr.push({
        tx: Math.round(Math.cos((ang * Math.PI) / 180) * dist),
        ty: Math.round(Math.sin((ang * Math.PI) / 180) * dist),
        tr: ((i * 57) % 140) - 70,
        d: [4, 1, 6, 7, 0, 3, 2, 8, 5][i], // scrambled snap order
      });
    }
    return arr;
  }, []);
  return (
    <div className="boot-block">
      {tiles.map((t, i) => (
        <div
          key={i}
          className="boot-tile"
          style={{ "--tx": `${t.tx}px`, "--ty": `${t.ty}px`, "--tr": `${t.tr}deg`, "--d": t.d }}
        />
      ))}
      <div className="glint" />
      <div className="glyph">
        <HomeGlyph />
      </div>
    </div>
  );
}

/* ---- TRACE: a light draws the home glyph, then blooms ---- */
function TraceBoot() {
  return (
    <div className="boot-trace">
      <svg viewBox="0 0 200 180" aria-hidden="true">
        <path className="fillglyph" d="M30 88 L100 22 L170 88 L154 88 L154 150 L46 150 L46 88 Z" />
        <path
          className="draw"
          pathLength="100"
          d="M28 90 L100 20 L172 90 M46 88 L46 150 L154 150 L154 88 M84 150 L84 110 L116 110 L116 150"
        />
      </svg>
      <div className="ring" />
    </div>
  );
}

/* ---- PIXEL: an LED dot grid powers on into the mark (Pixoo nod) ---- */
const PX_COLS = 11;
const PX_ROWS = 9;
function pxLit(c, r) {
  const cx = 5;
  if (r <= 4) return Math.abs(c - cx) <= r; // roof triangle
  if (c < 2 || c > 8) return false; // walls cols 2..8
  if (c === cx && r >= 6) return false; // door cutout
  return true;
}
function PixelBoot() {
  const dots = [];
  for (let r = 0; r < PX_ROWS; r++) {
    for (let c = 0; c < PX_COLS; c++) {
      dots.push({ on: pxLit(c, r) ? 1 : 0, i: Math.abs(c - 5) + r });
    }
  }
  return (
    <div className="boot-pixel" style={{ gridTemplateColumns: `repeat(${PX_COLS}, 1fr)` }}>
      <div className="scan" />
      {dots.map((d, k) => (
        <div key={k} className="px" data-on={d.on} style={{ "--i": d.i }} />
      ))}
    </div>
  );
}

const STYLES = { assemble: AssembleBoot, trace: TraceBoot, pixel: PixelBoot };

/**
 * @param {object}   props
 * @param {boolean}  props.ready  data is loaded (WS ready + first snapshot in)
 * @param {string}   props.style  "assemble" | "trace" | "pixel"
 * @param {number}   [props.speed] animation speed multiplier (1 = default)
 * @param {() => void} props.onDone called once the finale completes; unmount here
 */
export default function BootScreen({ ready, style = "assemble", speed = 1, onDone }) {
  const [phase, setPhase] = useState("reveal");
  const startRef = useRef(Date.now());
  const ts = 1 / speed;
  const Glyph = STYLES[style] || AssembleBoot;

  // Mark the body so the dashboard can "come to light" beneath the void.
  useEffect(() => {
    document.body.classList.add("gh-booting");
    document.documentElement.style.setProperty("--gh-ts", String(ts));
    return () => {
      document.body.classList.remove("gh-booting", "gh-boot-enter");
    };
  }, [ts]);

  // reveal → enter: once data is ready (and the minimum run-time has
  // elapsed), or once the hard cap is hit, whoosh through.
  useEffect(() => {
    if (phase !== "reveal") return;
    const elapsed = Date.now() - startRef.current;
    const wait = ready
      ? Math.max(0, MIN_REVEAL_MS * ts - elapsed)
      : Math.max(0, MAX_WAIT_MS * ts - elapsed);
    const id = setTimeout(() => setPhase("enter"), wait);
    return () => clearTimeout(id);
  }, [phase, ready, ts]);

  // enter → done: run the bloom/void-clear finale, then unmount.
  useEffect(() => {
    if (phase !== "enter") return;
    document.body.classList.add("gh-boot-enter");
    const id = setTimeout(() => onDone && onDone(), EXIT_MS * ts);
    return () => clearTimeout(id);
  }, [phase, onDone, ts]);

  return (
    <div className="gh-boot" data-phase={phase} style={{ "--ts": ts }} aria-hidden="true">
      <div className="gh-boot-void">
        <div className="boot-stage">
          <Glyph />
          <div className="boot-word">
            {"GLASSHOUSE".split("").map((ch, i) => (
              <span key={i} style={{ "--w": i }}>
                {ch}
              </span>
            ))}
          </div>
          <div className="boot-tag">Home ready</div>
        </div>
      </div>
      <div className="gh-boot-bloom" />
    </div>
  );
}
