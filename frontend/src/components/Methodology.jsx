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
  { year: 2026, mau: 800 },
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

function FeaturePill({ label }) {
  return (
    <span style={{
      display: "inline-block",
      fontSize: 11, fontWeight: 700, padding: "2px 9px",
      borderRadius: 20,
      background: "rgba(52, 211, 153, 0.1)",
      border: "1px solid rgba(52, 211, 153, 0.3)",
      color: "#34d399",
      marginRight: 6, marginBottom: 6,
    }}>
      {label}
    </span>
  );
}

export function Methodology() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "36px 24px", display: "flex", flexDirection: "column", gap: 40 }}>

      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>How It Works</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7 }}>
          Contour is a music rating and discovery app built around one core idea: streaming numbers only make sense
          when you account for when they happened. Here's how everything works.
        </p>
      </div>

      <Section title="What You Can Do">
        <P>
          Contour combines a social music rating layer with era-adjusted streaming analytics. Think IMDb for music,
          but with the context to actually compare across decades.
        </P>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {[
            "Rate albums & tracks (1–5 stars)",
            "Write reviews",
            "Follow other listeners",
            "Build & share lists",
            "Discover new music (For You feed)",
            "View streaming trajectories",
            "Era Score leaderboard",
            "Artist Known For",
            "Community ratings",
          ].map((f) => <FeaturePill key={f} label={f} />)}
        </div>
        <P>
          Your taste profile is learned from your ratings and onboarding choices, so the For You feed personalizes
          across devices as you rate more music.
        </P>
      </Section>

      <Section title="The Problem with Raw Stream Counts">
        <P>
          Spotify had 75 million monthly active users in 2015. By 2026 that number has grown to an estimated
          800 million, more than 10× larger. An album released in 2015 was competing for ears on a platform
          one-tenth the size of today's. Comparing raw stream totals across that gap isn't a fair comparison;
          it's like comparing box office numbers from different eras without adjusting for ticket price inflation.
        </P>
        <P>
          A debut album that cracked 100M streams in 2016 reached roughly 1 in every 1,000 Spotify users.
          The same 100M streams in 2024 only reached 1 in every 6,780. The music didn't get less popular;
          the ocean just got bigger.
        </P>
        <Callout>
          <strong style={{ color: "var(--accent-a)" }}>The fix:</strong> divide stream counts by the number of Spotify
          monthly active users at that point in time. The result is a "streams per MAU" ratio that puts every album
          on the same playing field, regardless of when it was released.
        </Callout>
      </Section>

      <Section title="Era Score & The Normalization Formula">
        <P>
          <strong style={{ color: "var(--text)" }}>Era Score</strong> asks: "how many streams would this album have
          if it were released today?" It multiplies raw streams by the ratio of current Spotify MAU to the MAU
          at the time of release.
        </P>
        <Formula>
          Era Score = raw streams × (MAU today ÷ MAU at release)
        </Formula>
        <P>
          A ×5 multiplier means Spotify had 5× fewer users when the album came out, so each of those streams
          was 5× harder to earn than a stream today. The Charts leaderboard ranks albums by Era Score by default,
          with raw streams available as an alternative sort.
        </P>
        <P>
          For trajectory charts, each data point is also normalized as cumulative streams per Spotify user:
        </P>
        <Formula>
          normalized = cumulative streams ÷ (MAU × 1,000,000)
        </Formula>
        <P>
          MAU values between annual data points are linearly interpolated month-by-month, so an album released
          in June 2019 uses a MAU figure that reflects the midpoint between the 2019 and 2020 annual totals,
          not a stale year-end snapshot.
        </P>
      </Section>

      <Section title="Spotify MAU Baseline">
        <P>
          These figures come from Spotify's public annual reports and investor relations disclosures.
          2025–2026 values are estimates based on the growth trend.
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
                const isEst = row.year >= 2025;
                return (
                  <tr key={row.year}>
                    <td style={tdStyle}>{row.year}{isEst ? " *" : ""}</td>
                    <td style={tdStyle}>{row.mau}M</td>
                    <td style={{ ...tdStyle, color: "var(--accent-b)" }}>{growth}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>* 2025–2026 are estimates.</p>
      </Section>

      <Section title="Stream Trajectory Modeling">
        <P>
          Day-by-day historical stream counts are not publicly available without a Luminate (formerly Nielsen Music)
          data license. Instead, we model each album's trajectory using two known anchors and a decay curve:
        </P>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 8 }}>
          {[
            ["Day 0", "Release date from Spotify. Streams start at zero."],
            ["Endpoint", "Current total stream count scraped from Kworb.net."],
            ["Curve shape", "Two-phase decay for post-2015 releases: exponential drop-off in the first 180 days (half-life ~45 days, reflecting the release-week spike and its decay), followed by a power-law catalog tail. Pre-2015 releases skip the spike phase entirely (they were already in catalog mode when streaming began) and use a pure power-law model from day one."],
          ].map(([term, def]) => (
            <div key={term} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7 }}>
              <span style={{ fontWeight: 700, color: "var(--accent-a)", minWidth: 80, flexShrink: 0 }}>{term}</span>
              <span style={{ color: "var(--text-muted)" }}>{def}</span>
            </div>
          ))}
        </div>
        <Callout>
          The curve is calibrated so its cumulative area equals the known total stream count at today's date.
          This means the shape is plausible and the endpoint is accurate, but the path between them is an
          approximation. A disclaimer is shown on every chart that uses modeled data.
        </Callout>
      </Section>

      <Section title="For You Feed & Taste Profile">
        <P>
          The For You feed is a personalized track discovery scroll, similar to TikTok but for music previews.
          It learns from two sources:
        </P>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 8 }}>
          {[
            ["Genre picker", "When you first open the app, you choose genres you're into. These are saved to your taste profile."],
            ["Ratings", "Any time you give a track 4 or 5 stars, the artist is added to your taste profile. The feed immediately starts surfacing tracks from similar artists."],
            ["Cross-device", "Your taste profile is stored server-side (tied to your account), so it follows you across devices."],
          ].map(([term, def]) => (
            <div key={term} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7 }}>
              <span style={{ fontWeight: 700, color: "var(--accent-a)", minWidth: 120, flexShrink: 0 }}>{term}</span>
              <span style={{ color: "var(--text-muted)" }}>{def}</span>
            </div>
          ))}
        </div>
        <P>
          Logged-out users get a Global Top 50 + new releases feed until they sign in and build a profile.
        </P>
      </Section>

      <Section title="Artist Known For">
        <P>
          The "Known For" section on artist pages highlights the artist's biggest hits using Spotify's popularity
          ranking, with no extra computation required. Spotify already surfaces an artist's top tracks sorted by
          total streams, so we display the top 4 as a visual card grid with album art, track name, and release year.
        </P>
      </Section>

      <Section title="Data Sources">
        {[
          ["Spotify Web API", "Album and track search, metadata, release dates, popularity scores, artist top tracks, related artists, and new releases."],
          ["Kworb.net", "Total stream counts by album and track, and the global top albums chart. Scraped on demand and cached in Redis for 24 hours."],
          ["Deezer", "30-second preview clips for tracks where Spotify's preview URL is unavailable."],
          ["RIAA Public Database", "Certification milestones (Gold, Platinum, Diamond) annotated on the chart as vertical reference lines."],
        ].map(([src, desc]) => (
          <div key={src} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, color: "var(--text)", minWidth: 140, flexShrink: 0 }}>{src}</span>
            <span style={{ color: "var(--text-muted)" }}>{desc}</span>
          </div>
        ))}
      </Section>

      <Section title="Early Streaming Era">
        <P>
          Releases before 2013 arrived when Spotify had a fraction of its current user base (US launch: late 2011).
          Historical streaming data from this window is often sparse or entirely absent from sources like Kworb.
          When no chart data is available, album and track pages show a clear placeholder rather than a blank chart,
          with context explaining why data may be missing.
        </P>
        <P>
          For releases before Spotify's launch (pre-2008), any trajectory shown is modeled from 2008 onward.
          The chart reflects only the streaming portion of the album's commercial life.
        </P>
      </Section>

      <Section title="Known Limitations">
        {[
          ["Modeled trajectories", "The streaming curve between release day and today is a model, not recorded history. Early-career or catalog-heavy streaming patterns may not fit the default decay shape well."],
          ["Spotify-only", "Normalization uses Spotify MAU only. Apple Music, Tidal, Amazon Music, and YouTube are not factored in."],
          ["Charts data lag", "The leaderboard is seeded from Kworb's top albums list on startup and cached for 24 hours. Very new albums may not appear immediately."],
          ["Preview availability", "30-second previews in the For You feed depend on Spotify or Deezer having a clip available. Some tracks have no preview on either platform."],
        ].map(([title, desc]) => (
          <div key={title} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, color: "var(--danger)", minWidth: 160, flexShrink: 0 }}>{title}</span>
            <span style={{ color: "var(--text-muted)" }}>{desc}</span>
          </div>
        ))}
      </Section>

      <Section title="Your Data & Privacy">
        <P>
          Signing in with Google lets you rate albums and tracks, write reviews, follow other listeners,
          build lists, and keep your taste profile synced across devices. We request only your basic Google profile.
        </P>
        {[
          ["What we store", "Your Google display name and profile photo, used to show who you are in the app. Your ratings, reviews, lists, and follows are stored in our database."],
          ["What we don't store", "Your Google Drive, Gmail, contacts, or any other Google account data. We never read or write anything in your Google account beyond basic profile info."],
          ["Why Google?", "Google Sign-In is a familiar, secure, password-free way to create an account. Your Contour activity is kept entirely separate from your Google account."],
        ].map(([term, desc]) => (
          <div key={term} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, color: "var(--text)", minWidth: 160, flexShrink: 0 }}>{term}</span>
            <span style={{ color: "var(--text-muted)" }}>{desc}</span>
          </div>
        ))}
      </Section>

      <Section title="What's Next">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["exploring", "True historical stream data via Luminate API · Cross-platform normalization (Apple Music, YouTube, Tidal)"],
            ["considering", "Track-level trajectory charts with day-by-day Kworb data · Decade leaderboards · Collaborative lists"],
          ].map(([v, items]) => (
            <div key={v} style={{ display: "flex", gap: 12, fontSize: 13, lineHeight: 1.7 }}>
              <span style={{
                fontWeight: 700, color: "#000", background: "var(--accent-b)",
                padding: "1px 8px", borderRadius: 4, fontSize: 11, alignSelf: "flex-start", marginTop: 3, flexShrink: 0,
                textTransform: "capitalize",
              }}>{v}</span>
              <span style={{ color: "var(--text-muted)" }}>{items}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Privacy link — always accessible for App Store compliance */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20, display: "flex", gap: 20, fontSize: 13, color: "var(--text-muted)" }}>
        <a href="/privacy" style={{ color: "var(--text-muted)" }}>Privacy Policy</a>
        <span>© {new Date().getFullYear()} Contour</span>
      </div>

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
