import { useState } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Pixoo 64
   ----------------------------------------------------------------*/
export function PixooCard({ index = 0 }) {
  const { entity: e, status: pixooStatus } = useEntityStatus("light.divoom_pixoo_64");
  const [on, setOn] = useState(e?.state === "on");
  const [bright, setB] = useState(e?.attributes?.brightness ?? 200);
  const [channel, setChannel] = useState(e?.attributes?.channel ?? "Clock");
  const channels = e?.attributes?.available_channels ?? ["Clock", "Weather", "Visualizer", "Custom"];

  function ChannelPreview() {
    if (!on) {
      return (
        <div
          style={{
            color: "#222",
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            opacity: 0.5,
          }}
        >
          OFF
        </div>
      );
    }
    if (channel === "Clock") {
      const t = new Date();
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      return (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            color: "#ff7733",
            fontSize: 24,
            letterSpacing: "-0.02em",
            textShadow: "0 0 8px #ff7733",
          }}
        >
          {hh}:{mm}
        </div>
      );
    }
    if (channel === "Weather") {
      return (
        <div
          style={{
            color: "#ffd866",
            fontFamily: "var(--font-mono)",
            fontSize: 16,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            textShadow: "0 0 6px #ffd866",
          }}
        >
          <div style={{ fontSize: 22 }}>11°</div>
          <div style={{ fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase" }}>P. CLOUDY</div>
        </div>
      );
    }
    if (channel === "Visualizer") {
      return (
        <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 40 }}>
          {[18, 32, 24, 38, 22, 30, 16, 28].map((h, i) => (
            <div
              key={i}
              style={{
                width: 4,
                height: h,
                background: `hsl(${260 + i * 14}, 80%, 60%)`,
                borderRadius: 1,
                boxShadow: `0 0 6px hsl(${260 + i * 14}, 80%, 60%)`,
                animation: `pixooBar ${0.4 + (i % 3) * 0.15}s ease-in-out infinite alternate`,
              }}
            />
          ))}
        </div>
      );
    }
    if (channel === "Animations") {
      return (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            background: "conic-gradient(from 0deg, #ff66cc, #66ccff, #ffcc66, #66ffcc, #ff66cc)",
            boxShadow: "0 0 10px #ff66cc",
            animation: "pixooSpin 4s linear infinite",
          }}
        />
      );
    }
    return (
      <div style={{ color: "#aaa", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em" }}>
        CUSTOM
      </div>
    );
  }

  return (
    <Card
      index={index}
      eyebrow="Light · light.divoom_pixoo_64"
      title="Pixoo 64 · bedroom"
      meta={pixooStatus !== "ready" ? "—" : on ? `${channel} · ${Math.round((bright / 255) * 100)}%` : "Off"}
      headRight={<div className={`toggle ${on ? "on" : ""}`} onClick={() => setOn(!on)} role="switch" />}
    >
      <EntityGuard status={pixooStatus} entityId="light.divoom_pixoo_64">
      <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 18, alignItems: "center", marginTop: 4 }}>
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: 12,
            background: "#0a0a0d",
            border: "1px solid var(--glass-stroke)",
            padding: 6,
            boxShadow: on
              ? `0 0 22px ${
                  channel === "Clock" ? "#ff7733" : channel === "Weather" ? "#ffd866" : "#7755ff"
                }44, inset 0 0 0 1px rgba(255,255,255,0.06)`
              : "inset 0 0 0 1px rgba(255,255,255,0.04)",
            transition: "box-shadow 0.5s ease",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 6,
              background: "linear-gradient(135deg, #050507, #0a0a10)",
              display: "grid",
              placeItems: "center",
              opacity: on ? 1 : 0.4,
              transition: "opacity 0.3s ease",
              backgroundImage:
                "linear-gradient(0deg, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "5px 5px",
            }}
          >
            <ChannelPreview />
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>Brightness</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {Math.round((bright / 255) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="255"
            step="1"
            value={bright}
            disabled={!on}
            onChange={(ev) => setB(Number(ev.target.value))}
            className="gh-slider"
            style={{ width: "100%", accentColor: "var(--accent)" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Channel</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {channels.map((c) => (
            <button
              key={c}
              className={`preset ${channel === c ? "on" : ""}`}
              disabled={!on}
              onClick={() => setChannel(c)}
              style={{ opacity: !on ? 0.5 : 1 }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
