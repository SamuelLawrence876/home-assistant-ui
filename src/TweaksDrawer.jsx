/* In-app Tweaks drawer.
   Replaces the design-canvas Tweaks panel from the prototype.
   Floating cog (top right), tap to open. Lets you switch lean, force
   day/night, and override the clock. Settings persist via App state. */

import { useState, useEffect } from "react";
import { getHAConfig, haConfigured } from "./ha/client.js";
import { reconnect } from "./ha/socket.js";

const LEAN_OPTIONS = [
  { value: "frosted", label: "Frosted", tag: "cool minimal" },
  { value: "conservatory", label: "Conservatory", tag: "warm sage" },
  { value: "atrium", label: "Atrium", tag: "concrete + iron" },
];

const MODE_OPTIONS = ["auto", "day", "night"];

export function TweaksDrawer({
  lean,
  modePref,
  clockOverride,
  clock,
  onLeanChange,
  onModeChange,
  onClockOverrideChange,
  onClockChange,
}) {
  // Auto-open on first visit when HA isn't configured so the user lands on the connection setup.
  const [open, setOpen] = useState(() => !haConfigured());
  const [haUrl, setHaUrl] = useState(() => getHAConfig().url);
  const [haTokenInput, setHaTokenInput] = useState(() => getHAConfig().token);
  const [showToken, setShowToken] = useState(false);
  const [saveState, setSaveState] = useState(null); // null | "saving" | "saved"

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function saveConnection() {
    setSaveState("saving");
    if (haUrl) localStorage.setItem("ha_url", haUrl.replace(/\/$/, ""));
    else localStorage.removeItem("ha_url");
    if (haTokenInput) localStorage.setItem("ha_token", haTokenInput);
    else localStorage.removeItem("ha_token");
    reconnect();
    setSaveState("saved");
    setTimeout(() => setSaveState(null), 1500);
  }

  function clearConnection() {
    localStorage.removeItem("ha_url");
    localStorage.removeItem("ha_token");
    setHaUrl("");
    setHaTokenInput("");
    reconnect();
  }

  const hh = String(Math.floor(clock)).padStart(2, "0");
  const mm = String(Math.round((clock - Math.floor(clock)) * 60)).padStart(2, "0");

  return (
    <>
      <button
        className="tweaks-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Tweaks"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.57V21a2 2 0 1 1-4 0v-.07a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.57-1.04H3a2 2 0 1 1 0-4h.07a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.04-1.57V3a2 2 0 0 1 4 0v.07a1.7 1.7 0 0 0 1.04 1.57 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01c.27.62.86 1.04 1.51 1.04H21a2 2 0 1 1 0 4h-.07a1.7 1.7 0 0 0-1.56 1.04z" />
        </svg>
      </button>

      {open && <div className="tweaks-scrim" onClick={() => setOpen(false)} />}

      <aside className={`tweaks-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="tweaks-head">
          <div>
            <div className="t">Settings</div>
            <div className="s">Glasshouse</div>
          </div>
          <button className="x" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>

        <div className="tweaks-section">
          <div className="lbl">Home Assistant connection</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.04em", textTransform: "uppercase" }}>URL</span>
              <input
                type="text"
                value={haUrl}
                onChange={(e) => setHaUrl(e.target.value)}
                placeholder="https://ha.samuel-lawrence.com"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  padding: "8px 10px",
                  background: "var(--glass-bg-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  color: "var(--ink)",
                  outline: "none",
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                Long-Lived Access Token
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type={showToken ? "text" : "password"}
                  value={haTokenInput}
                  onChange={(e) => setHaTokenInput(e.target.value)}
                  placeholder="eyJ0eXA…"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  style={{
                    flex: 1,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    padding: "8px 10px",
                    background: "var(--glass-bg-2)",
                    border: "1px solid var(--rule)",
                    borderRadius: 8,
                    color: "var(--ink)",
                    outline: "none",
                  }}
                />
                <button
                  className="btn"
                  onClick={() => setShowToken((s) => !s)}
                  style={{ padding: "0 10px", fontSize: 11 }}
                  aria-label={showToken ? "Hide token" : "Show token"}
                >
                  {showToken ? "Hide" : "Show"}
                </button>
              </div>
              <span style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 2 }}>
                Generate via HA → profile → Security → Create Token.
              </span>
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary" onClick={saveConnection} style={{ flex: 1 }}>
                {saveState === "saved" ? "Saved ✓" : saveState === "saving" ? "Saving…" : "Save & connect"}
              </button>
              {haConfigured() && (
                <button className="btn" onClick={clearConnection}>Clear</button>
              )}
            </div>
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

          <label className="tweaks-toggle">
            <span>Override clock</span>
            <input
              type="checkbox"
              checked={clockOverride}
              onChange={(e) => onClockOverrideChange(e.target.checked)}
            />
            <span className={`toggle ${clockOverride ? "on" : ""}`} />
          </label>

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
              />
            </div>
          )}
        </div>

        <div className="tweaks-hint">
          Settings persist locally. Reload the page to keep them.
        </div>
      </aside>
    </>
  );
}
