import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { AlertIcon } from "./Icons";
import { ACCENT_A, ACCENT_B, ACCENT_C } from "../theme.js";

// ── Milestone timeline ───────────────────────────────────────────────────────
// Renders below the chart. Replaces the previous in-chart ReferenceLines +
// stacked CertLabel approach, which produced a tower of overlapping text on
// the left side of the chart whenever multiple milestones hit within a few
// days of release (which is most of them). The dashed-line approach showed
// WHERE on the X-axis a milestone happened but couldn't say WHICH milestone
// belonged to WHICH curve at a glance, and the labels physically overlapped
// for early-life certifications. This separates the two jobs:
//   - The chart stays clean and shows trajectory shape only.
//   - The timeline below tells the day-by-day story chronologically.
function MilestoneTimeline({ certs, name, color }) {
  if (!certs.length) return null;
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "baseline",
      rowGap: 4, columnGap: 0,
      padding: "4px 0",
    }}>
      <span style={{
        fontSize: 13, fontWeight: 700, color,
        flexShrink: 0, marginRight: 12, minWidth: 60,
      }}>
        {name}
      </span>
      {certs.map((c, i) => (
        <span key={i} style={{ fontSize: 12, lineHeight: 1.7, whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{c.label}</span>
          <span style={{ color: "var(--text-muted)" }}> day {c.day}</span>
          {i < certs.length - 1 && (
            <span style={{ color: "var(--text-muted)", opacity: 0.45, margin: "0 8px" }}>·</span>
          )}
        </span>
      ))}
    </div>
  );
}

// Merge any number of trajectories into a single row-per-day array. Each
// series writes to its own pair of fields ({k}_raw, {k}_norm) so recharts
// can pick them up individually.
function mergeTrajectories(trajectories) {
  const map = new Map();
  for (const { key, traj } of trajectories) {
    if (!traj?.length) continue;
    for (const pt of traj) {
      const existing = map.get(pt.day) ?? { day: pt.day };
      existing[`${key}_raw`] = pt.streams_cumulative;
      existing[`${key}_norm`] = pt.normalized;
      map.set(pt.day, existing);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.day - b.day);
}

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

function buildCertLines(trajectory, milestones) {
  if (!milestones?.length || !trajectory?.length) return [];
  return milestones.flatMap((m) => {
    const pt = trajectory.find((p) => p.streams_cumulative >= m.streams);
    return pt ? [{ day: pt.day, label: m.label }] : [];
  });
}

function CustomTooltip({ active, payload, label, mode, nameMap }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      padding: "10px 14px",
      fontSize: 13,
      lineHeight: 1.6,
    }}>
      <div style={{ color: "var(--text-muted)", marginBottom: 6, fontSize: 12 }}>
        Day {label}
      </div>
      {payload.map((p) => {
        const seriesKey = p.dataKey.split("_")[0]; // "a" | "b" | "c"
        return (
          <div key={p.dataKey} style={{ color: p.color }}>
            <strong>{nameMap[seriesKey]}:</strong>{" "}
            {mode === "normalized"
              ? `${p.value?.toFixed(3)} streams/user`
              : Number(p.value)?.toLocaleString()}
          </div>
        );
      })}
    </div>
  );
}

export function ComparisonChart({ data, nameA, nameB, nameC, disclaimer }) {
  const [mode, setMode] = React.useState("normalized");

  const hasC = !!data.album_c && !!data.trajectory_c;
  const merged = mergeTrajectories([
    { key: "a", traj: data.trajectory_a },
    { key: "b", traj: data.trajectory_b },
    ...(hasC ? [{ key: "c", traj: data.trajectory_c }] : []),
  ]);

  const suffix = mode === "normalized" ? "_norm" : "_raw";
  const dataKeyA = `a${suffix}`;
  const dataKeyB = `b${suffix}`;
  const dataKeyC = `c${suffix}`;
  const nameMap = { a: nameA, b: nameB, c: nameC };

  const certLinesA = buildCertLines(data.trajectory_a, data.album_a.riaa_milestones);
  const certLinesB = buildCertLines(data.trajectory_b, data.album_b.riaa_milestones);
  const certLinesC = hasC ? buildCertLines(data.trajectory_c, data.album_c.riaa_milestones) : [];

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: "20px 16px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
            VIEW
          </span>
          <div style={{
            display: "flex",
            background: "var(--surface2)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}>
            <button
              onClick={() => setMode("normalized")}
              style={{
                padding: "7px 16px",
                background: mode === "normalized" ? "var(--accent-a)" : "transparent",
                border: "none",
                color: mode === "normalized" ? "#000" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: mode === "normalized" ? 700 : 400,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              Normalized
            </button>
            <button
              onClick={() => setMode("raw")}
              style={{
                padding: "7px 16px",
                background: mode === "raw" ? "var(--accent-b)" : "transparent",
                border: "none",
                color: mode === "raw" ? "#000" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: mode === "raw" ? 700 : 400,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              Raw Streams
            </button>
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {mode === "normalized"
            ? "Cumulative streams per Spotify user (controls for platform growth)"
            : "Cumulative streams, unadjusted"}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={420}>
        <LineChart data={merged} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--surface2)" />
          <XAxis
            dataKey="day"
            stroke="var(--text-muted)"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            label={{ value: "Days since release", position: "insideBottomRight", offset: -8, fontSize: 11, fill: "var(--text-muted)" }}
          />
          <YAxis
            stroke="var(--text-muted)"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickFormatter={(v) => formatYAxis(v, mode)}
            width={64}
          />
          <Tooltip content={<CustomTooltip mode={mode} nameMap={nameMap} />} />
          <Legend
            formatter={(value) => nameMap[value.split("_")[0]]}
            wrapperStyle={{ fontSize: 13, paddingTop: 8 }}
          />

          <Line type="monotone" dataKey={dataKeyA} stroke={ACCENT_A} strokeWidth={2.5}
            dot={false} name={dataKeyA} connectNulls />
          <Line type="monotone" dataKey={dataKeyB} stroke={ACCENT_B} strokeWidth={2.5}
            dot={false} name={dataKeyB} connectNulls />
          {hasC && (
            <Line type="monotone" dataKey={dataKeyC} stroke={ACCENT_C} strokeWidth={2.5}
              dot={false} name={dataKeyC} connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Milestone timelines — chronological story of when each entity hit
          each RIAA certification. One row per series, color-coded. Renders
          nothing for series that don't have any milestones yet, so a brand-
          new release doesn't show empty rows. */}
      {(certLinesA.length > 0 || certLinesB.length > 0 || certLinesC.length > 0) && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 2,
          padding: "10px 0 4px",
          borderTop: "1px solid var(--border)",
        }}>
          <div style={{
            fontFamily: "var(--font-display)", fontStyle: "italic",
            fontSize: 13, color: "var(--text-muted)", marginBottom: 4,
          }}>
            RIAA milestones
          </div>
          <MilestoneTimeline certs={certLinesA} name={nameA} color={ACCENT_A} />
          <MilestoneTimeline certs={certLinesB} name={nameB} color={ACCENT_B} />
          {hasC && <MilestoneTimeline certs={certLinesC} name={nameC} color={ACCENT_C} />}
        </div>
      )}

      {disclaimer && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          fontSize: 11,
          color: "var(--text-muted)",
          fontStyle: "italic",
          lineHeight: 1.5,
          padding: "8px 12px",
          background: "var(--surface2)",
          borderRadius: "var(--radius-sm)",
        }}>
          <span style={{ flexShrink: 0, marginTop: 1, lineHeight: 0 }}>
            <AlertIcon size={12} />
          </span>
          <span>{disclaimer}</span>
        </div>
      )}
    </div>
  );
}
