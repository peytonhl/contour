import React from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { AlertIcon } from "./Icons";

function formatYAxis(val, mode) {
  if (mode === "normalized") {
    if (val >= 1) return `${val.toFixed(1)}/user`;
    if (val >= 0.01) return `${val.toFixed(2)}/user`;
    return `${val.toFixed(3)}/user`;
  }
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(0)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  return val;
}

function CertLabel({ viewBox, value, color, index }) {
  if (!viewBox) return null;
  const { x, y } = viewBox;
  return (
    <text x={x + 3} y={y + 14 + index * 14} fill={color} fontSize={9} opacity={0.85} fontWeight={600}>
      {value}
    </text>
  );
}

function CustomTooltip({ active, payload, label, mode }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 14px", fontSize: 13, lineHeight: 1.6 }}>
      <div style={{ color: "var(--text-muted)", marginBottom: 6, fontSize: 12 }}>Day {label}</div>
      <div style={{ color: "var(--accent-a)" }}>
        {mode === "normalized"
          ? `${payload[0]?.value?.toFixed(3)} streams/user`
          : Number(payload[0]?.value)?.toLocaleString()}
      </div>
    </div>
  );
}

export function TrajectoryChart({ trajectory, milestones = [], accentColor = "var(--accent-a)", disclaimer }) {
  const [mode, setMode] = React.useState("normalized");

  const dataKey = mode === "normalized" ? "normalized" : "streams_cumulative";

  const certLines = milestones.flatMap((m, i) => {
    const pt = trajectory?.find((p) => p.streams_cumulative >= m.streams);
    return pt ? [{ day: pt.day, label: m.label, index: i }] : [];
  });

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em" }}>VIEW</span>
          <div style={{ display: "flex", background: "var(--surface2)", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border)" }}>
            {[["normalized", "Normalized"], ["raw", "Raw Streams"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setMode(val)} style={{
                padding: "7px 16px", background: mode === val ? accentColor : "transparent",
                border: "none", color: mode === val ? "#000" : "var(--text-muted)",
                fontSize: 13, fontWeight: mode === val ? 700 : 400, cursor: "pointer", transition: "all 0.15s",
              }}>{lbl}</button>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {mode === "normalized" ? "Cumulative streams per Spotify user" : "Cumulative streams, unadjusted"}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={trajectory} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--surface2)" />
          <XAxis dataKey="day" stroke="var(--text-muted)" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            label={{ value: "Days since release", position: "insideBottomRight", offset: -8, fontSize: 11, fill: "var(--text-muted)" }} />
          <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickFormatter={(v) => formatYAxis(v, mode)} width={64} />
          <Tooltip content={<CustomTooltip mode={mode} />} />
          {certLines.map((cl) => (
            <ReferenceLine key={cl.label} x={cl.day} stroke={accentColor}
              strokeDasharray="4 3" strokeOpacity={0.5}
              label={<CertLabel value={cl.label} color={accentColor} index={cl.index} />} />
          ))}
          <Line type="monotone" dataKey={dataKey} stroke={accentColor} strokeWidth={2.5} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>

      {disclaimer && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", lineHeight: 1.5, padding: "8px 12px", background: "var(--surface2)", borderRadius: "var(--radius-sm)" }}>
          <span style={{ flexShrink: 0, marginTop: 1, lineHeight: 0 }}>
            <AlertIcon size={12} />
          </span>
          <span>{disclaimer}</span>
        </div>
      )}
    </div>
  );
}
