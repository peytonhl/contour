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
  listCreated: () => track("list_created"),
  forYouTrackPlayed: (tier_source) =>
    track("for_you_track_played", { tier_source }),
  forYouRated: (tier_source, rating_value) =>
    track("for_you_rated", { tier_source, rating_value }),
  appleMusicLinkClicked: (entity_type) =>
    track("apple_music_link_clicked", { entity_type }),
  spotifyLinkClicked: (entity_type) =>
    track("spotify_link_clicked", { entity_type }),
};
