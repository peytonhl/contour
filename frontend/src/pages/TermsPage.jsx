const ACCENT_A = "#d97a3b";

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

// Mirrors PrivacyPage.jsx structure so the two read as a matching pair.
// Generic enough to cover a v1 launch; revisit with a lawyer before any
// material change in the business model (paid tiers, music licensing, etc.).
export function TermsPage() {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px 60px", display: "flex", flexDirection: "column", gap: 32 }}>

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{
          fontSize: 38, fontWeight: 400,
          color: "var(--text)",
        }}>
          Terms of service
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Last updated: May 2026
        </p>
      </div>

      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.75 }}>
        These terms govern your use of Contour ("we", "our", or "us") — the
        music ratings, reviews, and discovery platform available at{" "}
        <a href="https://contour-rosy.vercel.app" style={{ color: ACCENT_A }}>contour-rosy.vercel.app</a>{" "}
        and via the Contour Music apps for iOS and Android. By using the
        service you agree to these terms. If you don't agree, please don't
        use Contour.
      </p>

      <Section title="1. Eligibility">
        <p>
          You must be at least 13 years old to use Contour. If you live in a
          jurisdiction that requires a higher minimum age for consent to
          online services, you must meet that threshold instead. Contour is
          not directed at children under 13, and we don't knowingly accept
          accounts from them.
        </p>
        <p style={{ marginTop: 8 }}>
          By creating an account or using the service as a guest, you confirm
          you meet this age requirement and that you have the authority to
          agree to these terms.
        </p>
      </Section>

      <Section title="2. Your Account">
        <p>
          You can sign in to Contour with Google or Apple. You're responsible
          for keeping the credentials of your linked identity provider secure.
          We're not liable for activity on your account that results from
          someone else accessing your Google or Apple account.
        </p>
        <p style={{ marginTop: 8 }}>
          You can have only one account. Creating duplicate accounts to evade
          blocks, moderation actions, or rating limits is grounds for
          termination of all of your accounts.
        </p>
        <p style={{ marginTop: 8 }}>
          Push notifications on the iOS / Android app are optional. We send
          push only for direct interactions with your account (follows,
          replies, upvotes, @-mentions) and never for marketing. You can
          opt out of any or all push types under Settings → Push
          notifications, or revoke permission entirely from your device's
          system Settings. See the Privacy Policy for details.
        </p>
      </Section>

      <Section title="3. Your Content">
        <p>
          Contour lets you post ratings, written reviews, replies, custom
          lists, profile information, and backlog items ("your content"). You
          retain ownership of your content. By posting, you grant us a
          worldwide, non-exclusive, royalty-free license to host, display,
          share, and adapt it for the purpose of operating and improving the
          service — including showing your reviews to other users, generating
          shareable cards that include your content, and surfacing your
          ratings in aggregate community statistics.
        </p>
        <p style={{ marginTop: 8 }}>
          You're responsible for what you post. Don't post anything you don't
          have the right to publish.
        </p>
      </Section>

      <Section title="4. Acceptable Use">
        <p>You agree not to:</p>
        <ul style={{ marginTop: 8, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>Harass, threaten, dox, or impersonate other users.</li>
          <li>Post content that's unlawful, defamatory, hateful, sexually explicit, or that infringes someone else's rights.</li>
          <li>Spam, fake-rate, vote-brigade, or otherwise manipulate community signals.</li>
          <li>Scrape the service or its underlying data feeds in bulk, or build derivative datasets without our written permission.</li>
          <li>Probe, attack, or attempt to circumvent the service's security, rate limits, or moderation systems.</li>
          <li>Use Contour to promote commercial products, services, or content unrelated to discussing music.</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          We can remove content and suspend or terminate accounts that
          violate these rules. We try to give warnings for borderline cases
          but reserve the right to act immediately when content is clearly
          harmful.
        </p>
      </Section>

      <Section title="5. Music Metadata & Third-Party Services">
        <p>
          Album, track, and artist information shown in Contour is sourced
          from third-party music services (currently Spotify, Apple Music,
          Last.fm, and Deezer) under their respective developer terms. We
          don't host or stream the music itself — playback is provided via
          embedded players or deep-links into those services.
        </p>
        <p style={{ marginTop: 8 }}>
          Stream count trajectories and era-adjusted statistics are derived
          from publicly available data points (e.g. archived Kworb pages,
          Wayback Machine snapshots). These numbers are best-effort
          approximations, not authoritative figures.
        </p>
        <p style={{ marginTop: 8 }}>
          Your use of Spotify, Apple Music, or any other linked service is
          governed by that service's own terms. We're not responsible for
          their availability, content, or data practices.
        </p>
      </Section>

      <Section title="6. Our Content">
        <p>
          The Contour name, wordmark, software, user interface, era-adjusted
          chart methodology, and editorial copy are our intellectual
          property. You can share screenshots and shareable cards generated
          by the service for personal, non-commercial use. You may not
          replicate, fork, or resell Contour itself.
        </p>
      </Section>

      <Section title="7. Shareable Cards">
        <p>
          Contour generates PNG cards (album reviews, comparisons, hot takes)
          that include your username, profile photo, the reviewed entity's
          cover art (sourced from the linked third-party services), and the
          content of your review or rating. By creating a public review or
          rating, you authorize us to render these cards on demand and serve
          them at predictable URLs (e.g.{" "}
          <a href="https://contour-rosy.vercel.app/api/og/review" style={{ color: ACCENT_A }}>/api/og/review?id=&lt;your-review-id&gt;</a>).
          Once you delete a review or rating, the corresponding card stops
          rendering.
        </p>
      </Section>

      <Section title="8. Termination">
        <p>
          You can delete your account at any time — email{" "}
          <a href="mailto:contour.app.demo@gmail.com" style={{ color: ACCENT_A }}>contour.app.demo@gmail.com</a>{" "}
          to request deletion. We process requests within 30 days. Some
          information may remain in backups for a limited period after that,
          but it's no longer linked to your identity.
        </p>
        <p style={{ marginTop: 8 }}>
          We can suspend or terminate your account at our discretion if you
          violate these terms or use the service in a way that harms other
          users. We'll give notice when we can.
        </p>
      </Section>

      <Section title="9. Disclaimers">
        <p>
          Contour is provided "as is" and "as available." We don't warrant
          that the service will be uninterrupted, error-free, or that any
          particular feature will be available indefinitely. Era-adjusted
          stream counts and chart positions are approximations derived from
          third-party data; they should not be relied upon as authoritative.
        </p>
        <p style={{ marginTop: 8 }}>
          We disclaim all warranties to the maximum extent permitted by law,
          express or implied, including merchantability, fitness for a
          particular purpose, and non-infringement.
        </p>
      </Section>

      <Section title="10. Limitation of Liability">
        <p>
          To the maximum extent permitted by law, neither we nor any
          third-party data provider will be liable for indirect, incidental,
          consequential, special, or exemplary damages arising from your use
          of Contour — including loss of data, lost profits, or loss of
          goodwill. Our total liability for any claim relating to the
          service is limited to the amount you have paid us in the prior
          twelve months (which, as Contour is currently free, is typically
          zero).
        </p>
      </Section>

      <Section title="11. Indemnification">
        <p>
          You agree to indemnify and hold us harmless from any claim, demand,
          or expense (including legal fees) arising out of your use of
          Contour, your violation of these terms, or your violation of any
          third party's rights.
        </p>
      </Section>

      <Section title="12. Changes to These Terms">
        <p>
          We may update these terms from time to time. We'll update the
          "Last updated" date at the top and, for material changes, notify
          users via the app. Continued use of Contour after a change means
          you accept the new terms.
        </p>
      </Section>

      <Section title="13. Governing Law">
        <p>
          These terms are governed by the laws of the State of New York,
          USA, without regard to its conflict-of-laws principles. Any
          dispute that can't be resolved informally will be brought
          exclusively in the state or federal courts located in New York
          County, New York.
        </p>
      </Section>

      <Section title="14. Contact">
        <p>
          Questions about these terms? Reach us at{" "}
          <a href="mailto:contour.app.demo@gmail.com" style={{ color: ACCENT_A }}>contour.app.demo@gmail.com</a>.
        </p>
      </Section>

    </div>
  );
}
