// Thin wrapper around PostHog. If VITE_POSTHOG_KEY is not set, every function
// is a silent no-op so the rest of the app can call `track(...)` unconditionally.
// PostHog autocapture is enabled in init() — these named events are the manually
// instrumented signals that matter for the social-first pivot.
import posthog from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

let ready = false;

export function initAnalytics() {
  if (!KEY || ready) return;
  posthog.init(KEY, {
    api_host: HOST,
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    persistence: "localStorage+cookie",
    person_profiles: "identified_only",
  });
  ready = true;
}

export function identify(userId, traits = {}) {
  if (!ready) return;
  posthog.identify(userId, traits);
}

export function reset() {
  if (!ready) return;
  posthog.reset();
}

export function track(event, props = {}) {
  if (!ready) return;
  posthog.capture(event, props);
}

// ── Named event helpers ──────────────────────────────────────────────────────
// Keeping these as functions rather than free-form strings prevents typos in
// callers and makes the full event catalog discoverable in one place.

export const analytics = {
  signupCompleted: (auth_provider) => track("signup_completed", { auth_provider }),
  ratingSubmitted: (entity_type, entity_id, rating_value) =>
    track("rating_submitted", { entity_type, entity_id, rating_value }),
  reviewSubmitted: (entity_type, review_length) =>
    track("review_submitted", { entity_type, review_length }),
  reviewVoted: (vote_type) => track("review_voted", { vote_type }),
  followUser: () => track("follow_user"),
  eraAdjustmentViewed: (entity_type) =>
    track("era_adjustment_viewed", { entity_type }),
  comparisonCreated: () => track("comparison_created"),
  comparisonShared: (sides) => track("comparison_shared", { sides }),
  listCreated: () => track("list_created"),
  forYouTrackPlayed: (tier_source) =>
    track("for_you_track_played", { tier_source }),
  forYouRated: (tier_source, rating_value) =>
    track("for_you_rated", { tier_source, rating_value }),
  appleMusicLinkClicked: (entity_type) =>
    track("apple_music_link_clicked", { entity_type }),
  spotifyLinkClicked: (entity_type) =>
    track("spotify_link_clicked", { entity_type }),
  // ShareButton clicks that completed (native share sheet did not throw, OR
  // clipboard write succeeded). Cancellations and clipboard failures don't
  // fire — we want to measure shares the user actually committed to. The
  // `method` property lets us see whether mobile (native sheet) or desktop
  // (clipboard) is driving the volume, and `surface` tells us which feature
  // is generating shares (review vs entity page).
  contentShared: (surface, method) =>
    track("content_shared", { surface, method }),

  // ── Conversion / discovery (Task 9) ──────────────────────────────────────
  importCompleted: (source, matched_count, unmatched_count) =>
    track("import_completed", { source, matched_count, unmatched_count }),
  backlogAdded: (album_id) => track("backlog_added", { album_id }),
  backlogPromotedToRating: (album_id, rating_value) =>
    track("backlog_promoted_to_rating", { album_id, rating_value }),
  trendingModuleClicked: (surface, entity_type, entity_id) =>
    track("trending_module_clicked", { surface, entity_type, entity_id }),
  trendingPageViewed: () => track("trending_page_viewed"),
  onboardingStepCompleted: (step_name, skipped) =>
    track("onboarding_step_completed", { step_name, skipped }),

  // ── Onboarding-rework instrumentation (2026-05-30) ────────────────────────
  // How a user seeded their feed at onboarding. `method` ∈ "artist" (picked
  // artists they love → similarity-seeded feed) | "genre" (fell back to the
  // genre picker). `artist_count` is how many artists they picked (0 for the
  // genre-fallback path). This is the core funnel input: compare first-rating
  // conversion and early-return for artist-seeded vs genre-seeded cohorts.
  onboardingSeeded: (method, artist_count) =>
    track("onboarding_seeded", { method, artist_count }),

  // The labeled "Adjust your feed" control (gear) was opened. Primary
  // in-session recovery path for a misfired seed — measure whether opening
  // it (and switching to genre browse) correlates with longer sessions /
  // return visits.
  feedAdjustOpened: () => track("feed_adjust_opened"),

  // User committed a genre-browse selection from the Adjust-your-feed panel.
  // `genre_count` is how many genres they picked.
  feedBrowseEntered: (genre_count) =>
    track("feed_browse_entered", { genre_count }),

  // ── Contextual auth funnel (2026-05-31) ───────────────────────────────────
  // The auth moment is the single highest-risk point in the funnel and is
  // invisible in most products. `trigger` is which gated action surfaced the
  // prompt: rate | review | save | card | profile | onboarding. Compare
  // shown→completed per trigger to see which action converts best AND to catch
  // any entry point whose intent-preservation is silently broken (a big
  // shown-without-completed gap at one trigger).
  signupPromptShown: (trigger) => track("signup_prompt_shown", { trigger }),
  signupPromptCompleted: (trigger) => track("signup_prompt_completed", { trigger }),
  signupPromptDismissed: (trigger) => track("signup_prompt_dismissed", { trigger }),

  // A shareable card (review / comparison / hot-take / taste-card /
  // taste-match) failed to render in CardPreviewModal. `card_type` is the OG
  // endpoint slug; `reason` is one of not_enough_ratings / no_hot_take /
  // not_found / server_error / client_error / network_error; `status` is the
  // HTTP status (null for network failures). Lets us measure retention drag
  // from new users hitting the taste-card rating floor or the hot-take
  // eligibility gate vs. genuine render failures.
  cardGenerationFailed: (card_type, reason, status) =>
    track("card_generation_failed", { card_type, reason, status }),

  // ── Failure / friction monitoring (2026-05-31) ────────────────────────────
  // A For You preview failed to play. The usual cause is an expired Deezer
  // Akamai-signed URL (hdnea=exp=…) surfacing as MEDIA_ERR_SRC_NOT_SUPPORTED
  // (code 4) — previously console-only, so silent churn from the core feed.
  // `media_error_code` is the HTMLMediaError code (1–4).
  feedAudioFailed: (tier_source, media_error_code, track_id) =>
    track("feed_audio_failed", { tier_source, media_error_code, track_id }),
  // A For You rating failed to PERSIST to the backend. `reason` is
  // `unresolved_track` (Deezer-only track we couldn't map to a Spotify id) or
  // `save_error` (the rate API threw). The local/optimistic UI still updated,
  // so this is otherwise invisible — it measures rating data loss.
  feedRatingFailed: (tier_source, reason) =>
    track("feed_rating_failed", { tier_source, reason }),
  // A misclick-recovery un-rate on the For You deck.
  forYouRatingRemoved: (tier_source) =>
    track("for_you_rating_removed", { tier_source }),

  // ── Intent signals (previously ghost calls that silently no-op'd) ─────────
  // A sign-in gate was shown to a logged-out user attempting a gated action.
  // `action` = what they tried (e.g. "rate"); `entity_type` = album/track/artist.
  // Top-of-funnel acquisition signal — pairs with signup_completed.
  signinPrompted: (action, entity_type) =>
    track("signin_prompted", { action, entity_type }),
  // A share affordance was TAPPED (intent), distinct from content_shared which
  // only fires on a completed share. The gap between them = abandon/failure rate.
  shareClicked: (surface) => track("share_clicked", { surface }),
};
