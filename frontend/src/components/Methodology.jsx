const MAU_TABLE = [
  { year: 2015, mau: 75 },
  { year: 2016, mau: 100 },
  { year: 2017, mau: 140 },
  { year: 2018, mau: 191 },
  { year: 2019, mau: 232 },
  { year: 2020, mau: 345 },
  { year: 2021, mau: 406 },
  { year: 2022, mau: 456 },
  { year: 2023, mau: 602 },
  { year: 2024, mau: 678 },
  { year: 2025, mau: 750 },
];

function Section({ title, children }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }) {
  return (
    <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--text-muted)", maxWidth: 680 }}>
      {children}
    </p>
  );
}

function Callout({ children }) {
  return (
    <div style={{
      padding: "14px 16px",
      background: "rgba(167, 139, 250, 0.08)",
      border: "1px solid rgba(167, 139, 250, 0.25)",
      borderRadius: 8,
      fontSize: 13,
      lineHeight: 1.7,
      color: "var(--text-muted)",
      maxWidth: 680,
    }}>
      {children}
    </div>
  );
}

function Formula({ children }) {
  return (
    <div style={{
      padding: "14px 20px",
      background: "var(--surface2)",
      borderRadius: 8,
      fontFamily: "monospace",
      fontSize: 14,
      color: "var(--text)",
      border: "1px solid var(--border)",
      maxWidth: 480,
    }}>
      {children}
    </div>
  );
}

export function Methodology() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "36px 24px", display: "flex", flexDirection: "column", gap: 40 }}>

      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>How It Works</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7 }}>
          A breakdown of our normalization method, data sources, and the modeling decisions behind every chart.
        </p>
      </div>

      <Section title="The Problem with Raw Stream Counts">
        <P>
          Spotify had 75 million monthly active users in 2015. By 2025 that number had grown to an estimated 750 million —
          a 10× increase. An album released in 2015 was competing for ears on a platform one-tenth the size of today's.
          Comparing raw stream totals across that gap isn't a fair comparison; it's like comparing box office numbers
          from different eras without adjusting for ticket price inflation.
        </P>
        <P>
          A debut album that cracked 100M streams in 2016 reached roughly 1 in every 1,000 Spotify users.
          The same 100M streams in 2024 only reached 1 in every 6,780. The music didn't get less popular —
          the ocean just got bigger.
        </P>
        <Callout>
          <strong style={{ color: "var(--accent-a)" }}>The fix:</strong> divide stream counts by the number of Spotify
          monthly active users at that point in time. The result is a "streams per MAU" ratio that puts every album
          on the same playing field, regardless of when it was released.
        </Callout>
      </Section>

      <Section title="The Normalization Formula">
        <P>
          For each point in an album's trajectory, we compute a normalized score expressed as
          cumulative streams per Spotify user. A value of 0.5 means the album has been streamed
          an average of half a time by every Spotify user at that point — a useful cross-era benchmark.
        </P>
        <Formula>
          normalized = cumulative streams ÷ (MAU × 1,000,000)
        </Formula>
        <P>
          MAU values between annual data points are linearly interpolated month-by-month, so an album released
          in June 2019 uses a MAU figure that reflects the midpoint between the 2019 and 2020 annual totals —
          not a stale year-end snapshot.
        </P>
      </Section>

      <Section title="Spotify MAU Baseline">
        <P>
          These figures come from Spotify's public annual reports and investor relations disclosures.
          The 2025 value is an estimate based on the growth trend.
        </P>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 260 }}>
            <thead>
              <tr>
                <th style={thStyle}>Year</th>
                <th style={thStyle}>MAU (millions)</th>
                <th style={thStyle}>YoY Growth</th>
              </tr>
            </thead>
            <tbody>
              {MAU_TABLE.map((row, i) => {
                const prev = MAU_TABLE[i - 1];
                const growth = prev ? (((row.mau - prev.mau) / prev.mau) * 100).toFixed(0) + "%" : "—";
                return (
                  <tr key={row.year}>
                    <td style={tdStyle}>{row.year}{row.year === 2025 ? " *" : ""}</td>
                    <td style={tdStyle}>{row.mau}M</td>
                    <td style={{ ...tdStyle, color: "var(--accent-b)" }}>{growth}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>* 2025 is an estimate.</p>
      </Section>

      <Section title="Stream Trajectory Modeling">
        <P>
          Day-by-day historical stream counts are not publicly available without a Luminate (formerly Nielsen Music)
          data license. Instead, we model each album's trajectory using two known anchors and a decay curve:
        </P>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 8 }}>
          {[
            ["Day 0", "Release date from Spotify / MusicBrainz. Streams start at zero."],
            ["Endpoint", "Current total stream count scraped from Kworb.net."],
            ["Curve shape", "Two-phase decay: exponential drop-off in the first 90 days (half-life ~14 days, reflecting the release-week spike and its decay), followed by a power-law catalog tail for the remaining life of the album."],
          ].map(([term, def]) => (
            <div key={term} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7 }}>
              <span style={{ fontWeight: 700, color: "var(--accent-a)", minWidth: 80, flexShrink: 0 }}>{term}</span>
              <span style={{ color: "var(--text-muted)" }}>{def}</span>
            </div>
          ))}
        </div>
        <Callout>
          The curve is calibrated so its cumulative area equals the known total stream count at today's date.
          This means the shape is plausible and the endpoint is accurate — but the path between them is an
          approximation. A disclaimer is shown on every chart that uses modeled data.
        </Callout>
      </Section>

      <Section title="Data Sources">
        {[
          ["Spotify Web API", "Album search, metadata, release dates, and popularity scores."],
          ["MusicBrainz", "Cross-referenced release dates and structured catalog metadata."],
          ["Kworb.net", "Total stream counts by album. Scraped on demand; used as the trajectory endpoint. Falls back to a Spotify-popularity-based estimate if unavailable."],
          ["RIAA Public Database", "Certification milestones (Gold, Platinum, Diamond) annotated on the chart as vertical reference lines."],
        ].map(([src, desc]) => (
          <div key={src} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, color: "var(--text)", minWidth: 140, flexShrink: 0 }}>{src}</span>
            <span style={{ color: "var(--text-muted)" }}>{desc}</span>
          </div>
        ))}
      </Section>

      <Section title="Known Limitations">
        {[
          ["Modeled trajectories", "The streaming curve between release day and today is a model, not recorded history. Early-career or catalog-heavy streaming patterns may not fit the default decay shape well."],
          ["Spotify-only", "Normalization uses Spotify MAU only. Apple Music, Tidal, Amazon Music, and YouTube are not factored in. Cross-platform normalization is a v2 roadmap item."],
          ["Pre-2015 not supported", "Reliable streaming-era MAU data begins in 2015. Albums from before then lack the baseline needed for normalization. A future version will use sales and radio data as a proxy index."],
          ["GDLU edition fragmentation", "God Does Like Ugly exists in multiple editions on Spotify. We aggregate all editions into one combined stream count by default, with a per-edition breakdown available."],
        ].map(([title, desc]) => (
          <div key={title} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, color: "var(--danger)", minWidth: 140, flexShrink: 0 }}>{title}</span>
            <span style={{ color: "var(--text-muted)" }}>{desc}</span>
          </div>
        ))}
      </Section>

      <Section title="Your Data & Privacy">
        <P>
          Signing in with Spotify lets you save comparisons and build a listening history on Contour.
          We request only the minimum Spotify permissions needed to identify you.
        </P>
        {[
          ["What we store", "Your Spotify display name and profile photo — used to show who you are in the header."],
          ["What we don't store", "Your listening history, playlists, saved songs, follows, or subscription type. We never read or write anything in your Spotify account."],
          ["Why Spotify at all?", "Spotify is our identity layer — it lets you sign in without creating yet another password. Your Contour account is separate from your Spotify account in all other respects."],
        ].map(([term, desc]) => (
          <div key={term} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, color: "var(--text)", minWidth: 160, flexShrink: 0 }}>{term}</span>
            <span style={{ color: "var(--text-muted)" }}>{desc}</span>
          </div>
        ))}
      </Section>

      <Section title="Roadmap">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["v2", "Ratings and reviews · Era-adjusted leaderboard · Multi-album comparison · Cross-platform normalization"],
            ["v3", "True historical stream data via Luminate API · Pre-2015 era support using sales + radio proxy index"],
          ].map(([v, items]) => (
            <div key={v} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7 }}>
              <span style={{
                fontWeight: 700, color: "#000", background: "var(--accent-b)",
                padding: "1px 8px", borderRadius: 4, fontSize: 11, alignSelf: "flex-start", marginTop: 3, flexShrink: 0
              }}>{v}</span>
              <span style={{ color: "var(--text-muted)" }}>{items}</span>
            </div>
          ))}
        </div>
      </Section>

    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "8px 16px 8px 0",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
};

const tdStyle = {
  padding: "7px 16px 7px 0",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
};
