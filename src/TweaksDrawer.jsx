/* In-app Tweaks drawer.
   Replaces the design-canvas Tweaks panel from the prototype.
   Floating cog (top right), tap to open. Lets you switch lean, force
   day/night, and override the clock. Settings persist via App state. */

import { useState, useEffect, useRef } from "react";
import { getHaUrl, signOut } from "./ha/socket.js";
import { ToggleSwitch } from "./components/ToggleSwitch.jsx";

const LEAN_OPTIONS = [
  { value: "frosted", label: "Frosted", tag: "cool minimal" },
  { value: "conservatory", label: "Conservatory", tag: "warm sage" },
  { value: "atrium", label: "Atrium", tag: "concrete + iron" },
];

const MODE_OPTIONS = ["auto", "day", "night"];

/* Everything inside the drawer that takes a tab stop — used by the focus trap. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const BOOT_OPTIONS = [
  { value: "assemble", label: "Assemble", tag: "tiles snap together" },
  { value: "trace", label: "Trace", tag: "drawn glyph" },
  { value: "pixel", label: "Pixel", tag: "LED grid" },
];

export function TweaksDrawer({
  lean,
  modePref,
  clockOverride,
  clock,
  onLeanChange,
  onModeChange,
  onClockOverrideChange,
  onClockChange,
  bootStyle,
  onBootStyleChange,
}) {
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const drawerRef = useRef(null);
  const fabRef = useRef(null);
  const wasOpen = useRef(false);
  const haUrl = getHaUrl();

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Move focus with the panel: into it on open, back onto the cog on close.
  // Without this a keyboard user is left focused on a control that has just
  // gone inert, i.e. nowhere.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      drawerRef.current?.querySelector("button")?.focus();
    } else {
      setConfirmSignOut(false);
      if (wasOpen.current) fabRef.current?.focus();
    }
  }, [open]);

  // Focus trap for the OPEN panel. The drawer sits last in the DOM and the
  // page behind it is not inert, so without this Tab walks off the final
  // control and on through the topbar tabs, the media transport and the
  // SamBox360 mains switch — all under the scrim, invisible but live.
  useEffect(() => {
    if (!open) return;
    function onTab(e) {
      if (e.key !== "Tab") return;
      const el = drawerRef.current;
      if (!el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter(
        (n) => !n.disabled && n.getClientRects().length > 0,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Focus escaped (the cog is outside the panel) — pull it back in.
      if (!el.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onTab);
    return () => window.removeEventListener("keydown", onTab);
  }, [open]);

  // Sign-out drops the HA session with no dialog to explain it, so ask twice.
  useEffect(() => {
    if (!confirmSignOut) return;
    const id = setTimeout(() => setConfirmSignOut(false), 5000);
    return () => clearTimeout(id);
  }, [confirmSignOut]);

  const hh = String(Math.floor(clock)).padStart(2, "0");
  const mm = String(Math.round((clock - Math.floor(clock)) * 60)).padStart(2, "0");

  return (
    <>
      <button
        className="tweaks-fab"
        ref={fabRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.57V21a2 2 0 1 1-4 0v-.07a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.57-1.04H3a2 2 0 1 1 0-4h.07a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.04-1.57V3a2 2 0 0 1 4 0v.07a1.7 1.7 0 0 0 1.04 1.57 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01c.27.62.86 1.04 1.51 1.04H21a2 2 0 1 1 0 4h-.07a1.7 1.7 0 0 0-1.56 1.04z" />
        </svg>
      </button>

      {open && <div className="tweaks-scrim" onClick={() => setOpen(false)} />}

      {/* `inert` is what actually takes the closed panel out of the tab order
          and out of the accessibility tree. The closed state is only visual
          (opacity: 0), so without it Tab walks through a dozen invisible
          controls — the second of which signs you out of Home Assistant.
          React 18 has no boolean handling for `inert`; the empty-string form
          renders inert="" and a bare `false` would render inert="false",
          which browsers read as present. */}
      <aside
        ref={drawerRef}
        className={`tweaks-drawer ${open ? "open" : ""}`}
        role="dialog"
        aria-modal={open ? "true" : undefined}
        aria-label="Settings"
        aria-hidden={!open}
        inert={open ? undefined : ""}
      >
        <div className="tweaks-head">
          <div>
            <div className="t">Settings</div>
            <div className="s">Glasshouse</div>
          </div>
          <button className="x" onClick={() => setOpen(false)} aria-label="Close settings">×</button>
        </div>

        <div className="tweaks-section">
          <div className="lbl">Home Assistant connection</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.04em", textTransform: "uppercase" }}>URL</span>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  padding: "8px 10px",
                  background: "var(--glass-bg-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  color: "var(--ink-2)",
                }}
              >
                {haUrl || "not configured"}
              </div>
              <span style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 2 }}>
                Auth is handled via the HA OAuth flow. Sign out below to clear your session on this browser.
              </span>
            </div>
            <button
              className="btn"
              onClick={() => (confirmSignOut ? signOut() : setConfirmSignOut(true))}
            >
              {confirmSignOut ? "Tap again to confirm sign out" : "Sign out of Home Assistant"}
            </button>
          </div>
        </div>

        <div className="tweaks-section">
          <div className="lbl">Lean</div>
          {LEAN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`tweaks-row ${lean === opt.value ? "on" : ""}`}
              onClick={() => onLeanChange(opt.value)}
            >
              <span className="rad" />
              <span>
                <span className="nm">{opt.label}</span>
                <span className="sub">{opt.tag}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="tweaks-section">
          <div className="lbl">Mode</div>
          <div className="tweaks-segments">
            {MODE_OPTIONS.map((m) => (
              <button
                key={m}
                className={`seg ${modePref === m ? "on" : ""}`}
                onClick={() => onModeChange(m)}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Was a <label> around a display:none checkbox, so the control was
              unreachable by keyboard even with the drawer open. Now a real
              <button role="switch"> — but the row keeps its own onClick so the
              whole 282px strip still toggles, which is what tweaks.css:210
              (cursor: pointer) has always promised. Clicks that land on the
              switch are left alone so it can't fire twice. */}
          <div
            className="tweaks-toggle"
            onClick={(e) => {
              if (e.target.closest?.("button")) return;
              onClockOverrideChange(!clockOverride);
            }}
          >
            <span>Override clock</span>
            <ToggleSwitch
              on={clockOverride}
              onToggle={() => onClockOverrideChange(!clockOverride)}
              label="Override clock"
            />
          </div>

          {clockOverride && (
            <div className="tweaks-slider">
              <div className="row">
                <span>Time of day</span>
                <span className="val">{hh}:{mm}</span>
              </div>
              <input
                type="range"
                min="0"
                max="23.99"
                step="0.25"
                value={clock}
                onChange={(e) => onClockChange(Number(e.target.value))}
                className="gh-slider"
                aria-label="Time of day"
                aria-valuetext={`${hh}:${mm}`}
              />
            </div>
          )}
        </div>

        {onBootStyleChange && (
          <div className="tweaks-section">
            <div className="lbl">Welcome animation</div>
            {BOOT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`tweaks-row ${bootStyle === opt.value ? "on" : ""}`}
                onClick={() => onBootStyleChange(opt.value)}
              >
                <span className="rad" />
                <span>
                  <span className="nm">{opt.label}</span>
                  <span className="sub">{opt.tag}</span>
                </span>
              </button>
            ))}
            <span style={{ fontSize: 10, color: "var(--ink-4)", display: "block", marginTop: 8 }}>
              Plays after sign-in while the dashboard loads. Reload to preview.
            </span>
          </div>
        )}

        <div className="tweaks-hint">
          Settings persist locally. Reload the page to keep them.
        </div>
      </aside>
    </>
  );
}
