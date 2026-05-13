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
          Last updated: May 2026
        </p>
      </div>

      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.75 }}>
        Contour ("we", "our", or "us") is a music ratings and discovery platform.
        You can rate and review albums, tracks, and artists, follow other listeners,
        build lists, and discover new music through a personalized feed. This policy
        explains what data we collect, how we use it, and your rights.
      </p>

      <Section title="1. Information We Collect">
        <p>When you sign in, we receive identity information from your chosen provider:</p>
        <p style={{ marginTop: 8 }}>
          <strong style={{ color: "var(--text)" }}>Google:</strong> Google user ID,
          display name, profile photo, and email address.
        </p>
        <p style={{ marginTop: 6 }}>
          <strong style={{ color: "var(--text)" }}>Sign in with Apple:</strong> an
          Apple user identifier, your name (provided once at first sign-in), and an
          email address. You may choose Apple's private relay email — in that case
          we never see your real address.
        </p>
        <p style={{ marginTop: 10 }}>
          Emails are used only for account identification, never for marketing.
        </p>
        <p style={{ marginTop: 10 }}>
          We also store content you create on Contour: ratings, reviews, written
          replies, your upvotes and downvotes on reviews, lists, backlog ("Want to
          Listen") items, who you follow, your bio, any profile photo you upload,
          your taste profile (genre preferences from onboarding plus genres added
          automatically when you rate something 4–5★), and the private "not
          interested" and blocked-user lists you build to tune your feed.
        </p>
        <p style={{ marginTop: 10 }}>
          If you choose <strong style={{ color: "var(--text)" }}>Browse without
          signing in</strong>, we do not create an account or collect identity
          data. Some preferences may be saved on your device only — see
          "Cookies & Local Storage" below.
        </p>
      </Section>

      <Section title="2. How We Use Your Information">
        <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>To create and maintain your Contour account</li>
          <li>To display your ratings, reviews, replies, and lists publicly on the platform</li>
          <li>To show your activity to users who follow you and notify users you interact with (follows, replies, upvotes)</li>
          <li>To personalize your For You feed using your ratings, taste profile, and the artists you've marked "not interested"</li>
          <li>To process imports of your ratings from other platforms (e.g. a Rate Your Music CSV) when you upload them</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          We do <strong style={{ color: "var(--text)" }}>not</strong> sell your
          data, use it for advertising, or share it with third parties beyond what
          is necessary to operate the service.
        </p>
      </Section>

      <Section title="3. Third-Party Services">
        <p>Contour relies on a small number of third parties:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>
            <strong style={{ color: "var(--text)" }}>Google OAuth</strong> and{" "}
            <strong style={{ color: "var(--text)" }}>Sign in with Apple</strong>{" "}
            handle authentication. Their handling of your sign-in is governed by{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" style={{ color: ACCENT_A }}>Google's Privacy Policy</a>
            {" "}and{" "}
            <a href="https://www.apple.com/legal/privacy/" target="_blank" rel="noreferrer" style={{ color: ACCENT_A }}>Apple's Privacy Policy</a>.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Spotify Web API</strong> — for
            music metadata (album art, track names, popularity, stream-related data).
            Spotify is a data source only; we don't authenticate you with Spotify
            and we don't share your Contour identity with them.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Last.fm</strong>,{" "}
            <strong style={{ color: "var(--text)" }}>Kworb</strong>,{" "}
            <strong style={{ color: "var(--text)" }}>the Wayback Machine</strong>,
            and <strong style={{ color: "var(--text)" }}>Deezer</strong> — used for
            music metadata, historical stream snapshots, and preview audio. None
            of these receive your identity.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Apple Music</strong> — used
            only for catalog deep-links (the "Open in Apple Music" button on entity
            pages). You are not signed in to Apple Music through Contour.
          </li>
        </ul>
        <p style={{ marginTop: 10 }}>
          Contour is not affiliated with any of these services.
        </p>
      </Section>

      <Section title="4. Analytics">
        <p>When configured, Contour uses two analytics services:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>
            <strong style={{ color: "var(--text)" }}>PostHog</strong> — for product
            analytics. Captures anonymous events (e.g. "a rating was submitted") and
            ties them to your account ID once you sign in. When you sign out we
            instruct PostHog to forget you on that device.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Vercel Web Analytics</strong>{" "}
            — for aggregate web traffic statistics.
          </li>
        </ul>
        <p style={{ marginTop: 10 }}>
          Both are operational. Neither is used for advertising or sold to third
          parties.
        </p>
      </Section>

      <Section title="5. Cookies & Local Storage">
        <p>
          Contour uses your browser's local storage to remember small preferences
          across visits:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>Whether you chose "Browse without signing in"</li>
          <li>Your genre selections from onboarding</li>
          <li>Recent searches</li>
          <li>The "English / Latin-only songs" toggle on For You</li>
          <li>A local copy of recent For You ratings, used to retry submissions that failed to reach the server</li>
          <li>The session token issued when you sign in</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          We do not use third-party advertising cookies. Clearing your browser's
          site data will wipe these preferences without affecting the data stored
          on your Contour account.
        </p>
      </Section>

      <Section title="6. Data Storage">
        <p>
          Account data is stored in a PostgreSQL database hosted on Railway. We
          use a Redis cache (also on Railway) for performance — no personal data
          is cached, only public music metadata. The frontend is served by Vercel.
          Connections use industry-standard TLS encryption. We do not store
          Spotify access tokens beyond the active session.
        </p>
        <p style={{ marginTop: 10 }}>
          When you import ratings from another platform (e.g. a Rate Your Music
          CSV), the file itself is processed in memory and is not retained. The
          ratings extracted from it are stored on your account like any other
          rating, alongside a small log entry recording the filename, source, and
          match counts for support purposes.
        </p>
      </Section>

      <Section title="7. Public vs Private Content">
        <p><strong style={{ color: "var(--text)" }}>Public on Contour:</strong></p>
        <ul style={{ paddingLeft: 20, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>Your display name, profile photo, and bio</li>
          <li>Your ratings, reviews, and replies</li>
          <li>Your lists and backlog</li>
          <li>Your follower and following lists</li>
        </ul>
        <p style={{ marginTop: 12 }}><strong style={{ color: "var(--text)" }}>Private to you:</strong></p>
        <ul style={{ paddingLeft: 20, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>Your email address</li>
          <li>The artists you've marked "not interested" on For You</li>
          <li>Users you've blocked</li>
          <li>Reports you submit against content</li>
          <li>Your individual upvote/downvote attribution (only the aggregate score is shown publicly)</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          To remove public content, you can delete individual items in-app or
          delete your account entirely (see Section 9).
        </p>
      </Section>

      <Section title="8. Data Retention">
        <p>
          We retain your account data for as long as your account exists. When you
          delete your account, we remove your personal data within 30 days.
          Anonymous music metadata sourced from third-party APIs is not personally
          linked to you and is retained for the operation of the service.
        </p>
      </Section>

      <Section title="9. Your Rights & Account Deletion">
        <p>
          You have the right to access, correct, or delete your personal data at
          any time. To request deletion of your account and all associated data,
          email us at{" "}
          <a href="mailto:privacy@contour.app" style={{ color: ACCENT_A }}>privacy@contour.app</a>.
          We will process deletion requests within 30 days.
        </p>
      </Section>

      <Section title="10. Children's Privacy">
        <p>
          Contour is not directed at children under 13. We do not knowingly collect
          personal information from anyone under 13. If you believe a child has
          provided us with personal information, contact us at the address below.
        </p>
      </Section>

      <Section title="11. Changes to This Policy">
        <p>
          We may update this policy from time to time. We'll update the "Last
          updated" date at the top and, for significant changes, notify users
          via the app.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          Questions about this policy? Reach us at{" "}
          <a href="mailto:privacy@contour.app" style={{ color: ACCENT_A }}>privacy@contour.app</a>.
        </p>
      </Section>

    </div>
  );
}
