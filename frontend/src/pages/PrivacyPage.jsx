const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

function Section({ title, children }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{title}</h2>
      <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.75 }}>
        {children}
      </div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px 60px", display: "flex", flexDirection: "column", gap: 32 }}>

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{
          fontSize: 28, fontWeight: 800,
          background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Last updated: May 2025
        </p>
      </div>

      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.75 }}>
        Contour ("we", "our", or "us") is a music data platform that lets you explore era-adjusted
        stream trajectories, compare albums and tracks, and share ratings and reviews with other
        listeners. This policy explains what data we collect, how we use it, and your rights.
      </p>

      <Section title="1. Information We Collect">
        <p>When you sign in with Spotify, we receive from Spotify's API:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <li><strong style={{ color: "var(--text)" }}>Spotify user ID</strong> — a unique identifier for your account</li>
          <li><strong style={{ color: "var(--text)" }}>Display name</strong> — the name shown on your Spotify profile</li>
          <li><strong style={{ color: "var(--text)" }}>Profile photo</strong> — your Spotify profile image URL</li>
          <li><strong style={{ color: "var(--text)" }}>Email address</strong> — used only for account identification, never for marketing</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          We also store content you create on Contour: ratings, reviews, favorite artists,
          and who you follow.
        </p>
      </Section>

      <Section title="2. How We Use Your Information">
        <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>To create and maintain your Contour account</li>
          <li>To display your ratings and reviews publicly on the platform</li>
          <li>To show your activity to users who follow you</li>
          <li>To personalize your experience (e.g. showing your ratings on album pages)</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          We do <strong style={{ color: "var(--text)" }}>not</strong> sell your data, use it for
          advertising, or share it with third parties beyond what is necessary to operate the service.
        </p>
      </Section>

      <Section title="3. Spotify">
        <p>
          Contour uses the Spotify API for authentication and to retrieve music metadata
          (album art, track names, stream counts). We access only the minimum Spotify scopes
          required: <code style={{ background: "var(--surface2)", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>user-read-private</code> and{" "}
          <code style={{ background: "var(--surface2)", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>user-read-email</code>.
        </p>
        <p style={{ marginTop: 8 }}>
          Contour is not affiliated with Spotify. Your use of Spotify is governed by{" "}
          <a href="https://www.spotify.com/legal/privacy-policy/" target="_blank" rel="noreferrer"
            style={{ color: ACCENT_A }}>
            Spotify's Privacy Policy
          </a>.
        </p>
      </Section>

      <Section title="4. Data Storage">
        <p>
          Your account data is stored in a secured PostgreSQL database. We use industry-standard
          practices including encrypted connections (TLS) and access controls. We do not store
          Spotify access tokens beyond the active session.
        </p>
      </Section>

      <Section title="5. Public Content">
        <p>
          Ratings, reviews, and your display name are visible to other Contour users. Your follower
          and following lists are also public. If you want to remove this content, you can delete
          your account (see Section 7).
        </p>
      </Section>

      <Section title="6. Data Retention">
        <p>
          We retain your account data for as long as your account exists. Stream count data and
          music metadata are sourced from public APIs and third-party databases and are not
          personally linked to you.
        </p>
      </Section>

      <Section title="7. Your Rights & Account Deletion">
        <p>
          You have the right to access, correct, or delete your personal data at any time.
          To request deletion of your account and all associated data, email us at{" "}
          <a href="mailto:privacy@contour.app" style={{ color: ACCENT_A }}>privacy@contour.app</a>.
          We will process deletion requests within 30 days.
        </p>
      </Section>

      <Section title="8. Children's Privacy">
        <p>
          Contour is not directed at children under 13. We do not knowingly collect personal
          information from anyone under 13. If you believe a child has provided us with personal
          information, contact us at the address below.
        </p>
      </Section>

      <Section title="9. Changes to This Policy">
        <p>
          We may update this policy from time to time. We'll update the "last updated" date at
          the top and, for significant changes, notify users via the app.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Questions about this policy? Reach us at{" "}
          <a href="mailto:privacy@contour.app" style={{ color: ACCENT_A }}>privacy@contour.app</a>.
        </p>
      </Section>

    </div>
  );
}
