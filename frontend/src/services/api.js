// In dev: empty string (Vite proxy handles it). In prod: set VITE_API_URL to your Railway backend URL.
const BASE = import.meta.env.VITE_API_URL ?? "";

function getToken() {
  return localStorage.getItem("contour_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(BASE + path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function post(path, body) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function patch(path, body) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method: "PATCH", headers, body: JSON.stringify(body) });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail ?? `HTTP ${res.status}`); }
  return res.json();
}

async function put(path, body) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail ?? `HTTP ${res.status}`); }
  return res.json();
}

async function del(path) {
  const token = getToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method: "DELETE", headers });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail ?? `HTTP ${res.status}`); }
  return res.json();
}

export const api = {
  // Unified search — returns { users, albums, tracks } in one request with smart triage
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  // Albums
  searchAlbums: (q) => request(`/albums/search?q=${encodeURIComponent(q)}`),
  getAlbum: (id) => request(`/albums/${id}`),
  getEditions: (id) => request(`/albums/${id}/editions`),
  getStreams: (id) => request(`/albums/${id}/streams`),
  getAlbumTrajectory: (id) => request(`/albums/${id}/trajectory`),
  getAlbumTracklist: (id) => request(`/albums/${id}/tracklist`),

  // Tracks
  searchTracks: (q) => request(`/tracks/search?q=${encodeURIComponent(q)}`),
  getTrack: (id) => request(`/tracks/${id}`),
  getTrackStreams: (id) => request(`/tracks/${id}/streams`),
  getTrackTrajectory: (id) => request(`/tracks/${id}/trajectory`),

  // Artists
  searchArtists: (q) => request(`/artists/search?q=${encodeURIComponent(q)}`),
  getArtist: (id) => request(`/artists/${id}`),
  getArtistAlbums: (id) => request(`/artists/${id}/albums`),
  getArtistTopTracks: (id) => request(`/artists/${id}/top-tracks`),

  // Compare — Side C optional. Pass idC=null for a 2-way comparison.
  compare: (idA, idB, idC = null, {
    editionIdsA = null, editionIdsB = null, editionIdsC = null,
    trackIdA = null, trackIdB = null, trackIdC = null,
  } = {}) => {
    const params = new URLSearchParams({ album_a_id: idA, album_b_id: idB });
    if (idC) params.set("album_c_id", idC);
    if (editionIdsA?.length) params.set("edition_ids_a", editionIdsA.join(","));
    if (editionIdsB?.length) params.set("edition_ids_b", editionIdsB.join(","));
    if (editionIdsC?.length) params.set("edition_ids_c", editionIdsC.join(","));
    if (trackIdA) params.set("track_a_id", trackIdA);
    if (trackIdB) params.set("track_b_id", trackIdB);
    if (trackIdC) params.set("track_c_id", trackIdC);
    return request(`/compare/?${params}`);
  },

  // Ratings & reviews
  getRatingSummary: (entityType, entityId) => request(`/ratings/${entityType}/${entityId}/summary`),
  // artistId is optional — pass it when rating a track so the server can update the taste profile
  rateEntity: (entityType, entityId, value, artistId = null) =>
    post(`/ratings/${entityType}/${entityId}/rate`, { value, ...(artistId ? { artist_id: artistId } : {}) }),
  submitReview: (entityType, entityId, body, value) => post(`/ratings/${entityType}/${entityId}/review`, { body, value }),
  deleteReview: (reviewId) => del(`/ratings/reviews/${reviewId}`),
  getReviews: (entityType, entityId, sort = "recent") => request(`/ratings/${entityType}/${entityId}/reviews?sort=${sort}`),
  voteReview: (reviewId, value) => post(`/ratings/reviews/${reviewId}/vote`, { value }),
  getReplies: (reviewId) => request(`/ratings/reviews/${reviewId}/replies`),
  // parent_reply_id is optional — when set, the reply is threaded under
  // another reply (Reddit-style). Null/omitted = top-level reply on the
  // review itself.
  postReply: (reviewId, body, parent_reply_id = null) =>
    post(`/ratings/reviews/${reviewId}/reply`, { body, parent_reply_id }),

  // Global reviews feed
  getGlobalReviews: (sort = "recent", entityType = "all") =>
    request(`/reviews/global?sort=${sort}&entity_type=${entityType}`),

  // Saved comparisons
  saveComparison: (body) => post("/comparisons/", body),
  getComparison: (id) => request(`/comparisons/${id}`),

  // Auth
  getProfile: () => request(`/auth/profile`),
  appleSignIn: (identity_token, nonce, name) =>
    post(`/auth/apple`, { identity_token, nonce, name }),

  // Featured
  getFeatured: () => request(`/featured`),

  // Diagnostics
  getDiscoverDebug: () => request(`/discover/debug`),
  getHealth: () => request(`/health`),

  // Apple Music deep-link resolution. Returns {apple_music_id, url, ...} or
  // throws on 404 (no match or service disabled — caller should hide button).
  //
  // The optional `hint` object ({ name, artist }) supplies fallback metadata
  // for entities whose `entityId` isn't a Spotify ID — e.g. Deezer-sourced
  // For You feed tracks. The backend ignores hints when DB / Spotify lookup
  // already produced the name + artist itself.
  getAppleMusicLink: (entityType, entityId, storefront = "us", hint = null) => {
    const params = new URLSearchParams({ storefront });
    if (hint?.name) params.set("hint_name", hint.name);
    if (hint?.artist) params.set("hint_artist", hint.artist);
    return request(`/apple-music/match/${entityType}/${entityId}?${params.toString()}`);
  },

  // Moderation
  reportContent: (target_type, target_id, reason, notes = null) =>
    post(`/moderation/reports`, { target_type, target_id, reason, notes }),
  blockUser: (id) => post(`/moderation/block/${id}`, {}),
  unblockUser: (id) => del(`/moderation/block/${id}`),
  getMyBlocks: () => request(`/moderation/blocks`),
  // Admin (is_admin gated server-side)
  adminListReports: (status = "open") => request(`/moderation/reports?status=${status}`),
  adminResolveReport: (id, status, delete_content) =>
    patch(`/moderation/reports/${id}`, { status, delete_content }),

  // Leaderboard
  getLeaderboard: (sort = "era", decade = "all", limit = 50) => request(`/leaderboard/?sort=${sort}&decade=${decade}&limit=${limit}`),

  // Notifications
  getNotifications: () => request(`/notifications`),
  getUnreadCount: () => request(`/notifications/unread-count`),
  markNotificationsRead: () => post(`/notifications/read-all`, {}),

  // Profile update
  updateProfile: (bio) => patch(`/auth/profile`, { bio }),
  updateProfilePhoto: (image_url) => patch(`/auth/profile`, { image_url }),
  updatePinnedAlbums: (ids) => patch(`/auth/profile`, { pinned_album_ids: ids }),

  // Taste profile (public, for profile page)
  getUserTaste: (id) => request(`/users/${id}/taste`),
  // Server-side personal taste (requires auth)
  getMyTasteProfile: () => request(`/taste/profile`),
  // `excludedGenres` is an optional 4th arg. Pass `undefined` (not `[]`) to
  // leave the server-side exclusion list untouched — backend treats `null`
  // as "ignore this field" and `[]` as "replace with empty". Existing
  // callers that don't pass the arg keep their previous behavior.
  saveTasteProfile: (genres, likedArtistIds = [], onboardingDone = false, excludedGenres) => {
    const body = { genres, liked_artist_ids: likedArtistIds, onboarding_done: onboardingDone };
    if (excludedGenres !== undefined) body.excluded_genres = excludedGenres;
    return post(`/taste/profile`, body);
  },
  // Hard-dislike list ("Not interested" on a For You card). Idempotent.
  // Best-effort fire-and-forget from the UI; backend is the source of truth.
  addArtistDislike: (artistId) => post(`/taste/dislike`, { artist_id: artistId }),
  removeArtistDislike: (artistId) => del(`/taste/dislike/${artistId}`),
  clearArtistDislikes: () => del(`/taste/dislikes`),
  // Enriched listing (id + name + image_url) for the management page
  listArtistDislikes: () => request(`/taste/dislikes`),

  // Transparency view — server-side diagnostic state. Renders on
  // SettingsPage/TasteTransparencyPage as a "how the algorithm sees me"
  // surface. Includes profile genres, eligible/excluded genres after
  // filters, rating counts, decade pref, vintage-mode trigger,
  // target_popularity, per-genre rating-affinity signal, and predicted
  // tier-1 sampling weights.
  getMyDiscoverState: () => request(`/discover/me-state`),

  // Selective reset of taste-profile fields. Body is an opt-in flag set
  // — at minimum one field must be true. Underlying ratings are NEVER
  // touched; only the per-user state that drives feed personalization.
  resetTasteProfile: (fields) => post(`/taste/reset`, fields),

  // Badge leaderboard (top-5 critics, influencers, connectors)
  getBadges: () => request(`/users/badges`),

  // Suggested users
  getSuggestedUsers: () => request(`/users/suggested`),

  // Discover / For You feed. `fresh=true` asks the server to ignore the
  // logged-in user's personalization (profile, ratings, exclude list)
  // and serve the cold-start ladder instead. Used by the transparency
  // view's "Fresh feed" toggle so users can see what a clean-slate user
  // would see without nuking their profile.
  getDiscoverFeed: ({ genres = [], liked_artists = [], disliked_artists = [], exclude = [], language = "english", limit = 10, fresh = false } = {}) => {
    const params = new URLSearchParams({ limit, language });
    if (genres.length) params.set("genres", genres.join(","));
    if (liked_artists.length) params.set("liked_artists", liked_artists.join(","));
    if (disliked_artists.length) params.set("disliked_artists", disliked_artists.join(","));
    if (exclude.length) params.set("exclude", exclude.join(","));
    if (fresh) params.set("fresh", "true");
    return request(`/discover/feed?${params}`);
  },

  // Feed
  getFeed: () => request(`/feed`),

  // Users (follow / public profiles)
  searchUsers: (q) => request(`/users/search?q=${encodeURIComponent(q)}`),
  getUser: (id) => request(`/users/${id}`),
  toggleFollow: (id) => post(`/users/${id}/follow`, {}),
  getFollowing: (id) => request(`/users/${id}/following`),
  getFollowers: (id) => request(`/users/${id}/followers`),
  getUserReviews: (id) => request(`/users/${id}/reviews`),
  getUserRatings: (id) => request(`/users/${id}/ratings`),
  getUserLists: (id) => request(`/users/${id}/lists`),
  // Head-to-head taste comparison vs another user (auth required — viewer
  // is the JWT subject). Returns shared/agreement counts plus the obscure
  // biggest-agreement + biggest-fight picks. Drives /compare/taste/:id.
  getTasteMatch: (otherUserId) => request(`/users/${otherUserId}/taste-match`),

  // Lists
  createList: (title, description, isRanked) => post(`/lists/`, { title, description, is_ranked: isRanked }),
  getList: (id) => request(`/lists/${id}`),
  updateList: (id, body) => patch(`/lists/${id}`, body),
  deleteList: (id) => del(`/lists/${id}`),
  updateListItems: (id, items) => put(`/lists/${id}/items`, { items }),

  getMe: (token) => {
    return fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => {
      if (!r.ok) throw new Error("Not authenticated");
      return r.json();
    });
  },

  // ── Imports (RYM CSV) ──────────────────────────────────────────────────────
  // Multipart upload — bypasses the JSON `post()` helper.
  importRymCsv: async (file) => {
    const token = getToken();
    const fd = new FormData();
    fd.append("file", file);
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(BASE + "/imports/rym", { method: "POST", headers, body: fd });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.detail ?? `HTTP ${res.status}`);
    }
    return res.json();
  },

  // ── Backlog (Want to listen) ───────────────────────────────────────────────
  // entity_type is "album" or "track".
  addToBacklog: (entityType, entityId, note = null) =>
    post(`/backlog`, { entity_type: entityType, entity_id: entityId, note }),
  removeFromBacklog: (entityType, entityId) => del(`/backlog/${entityType}/${entityId}`),
  getMyBacklog: (sort = "recent") => request(`/backlog?sort=${sort}`),
  getUserBacklog: (userId, sort = "recent") => request(`/backlog/${userId}?sort=${sort}`),
  checkBacklog: (entityType, entityId) => request(`/backlog/check/${entityType}/${entityId}`),
  promoteBacklog: (entityType, entityId, rating = null) =>
    post(`/backlog/${entityType}/${entityId}/promote`, rating == null ? {} : { rating }),

  // ── Trending ───────────────────────────────────────────────────────────────
  getTrendingAlbums: (window = "7d", limit = 20) =>
    request(`/trending/albums?window=${window}&limit=${limit}`),
  getTrendingReviews: (window = "7d", limit = 20) =>
    request(`/trending/reviews?window=${window}&limit=${limit}`),
  getTrendingBacklogged: (window = "7d", limit = 20) =>
    request(`/trending/backlogged?window=${window}&limit=${limit}`),
  getTrendingSearched: (window = "7d", limit = 20) =>
    request(`/trending/searched?window=${window}&limit=${limit}`),
  getBacklogSuggestions: (limit = 5) =>
    request(`/trending/backlog-suggestions?limit=${limit}`),
};
