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
  getArtistFavorite: (id) => request(`/artists/${id}/favorite`),
  toggleArtistFavorite: (id) => post(`/artists/${id}/favorite`, {}),

  // Compare
  compare: (idA, idB, { editionIdsA = null, editionIdsB = null, trackIdA = null, trackIdB = null } = {}) => {
    const params = new URLSearchParams({ album_a_id: idA, album_b_id: idB });
    if (editionIdsA?.length) params.set("edition_ids_a", editionIdsA.join(","));
    if (editionIdsB?.length) params.set("edition_ids_b", editionIdsB.join(","));
    if (trackIdA) params.set("track_a_id", trackIdA);
    if (trackIdB) params.set("track_b_id", trackIdB);
    return request(`/compare/?${params}`);
  },

  // Ratings & reviews
  getRatingSummary: (entityType, entityId) => request(`/ratings/${entityType}/${entityId}/summary`),
  rateEntity: (entityType, entityId, value) => post(`/ratings/${entityType}/${entityId}/rate`, { value }),
  submitReview: (entityType, entityId, body, value) => post(`/ratings/${entityType}/${entityId}/review`, { body, value }),
  getReviews: (entityType, entityId, sort = "recent") => request(`/ratings/${entityType}/${entityId}/reviews?sort=${sort}`),
  voteReview: (reviewId, value) => post(`/ratings/reviews/${reviewId}/vote`, { value }),
  getReplies: (reviewId) => request(`/ratings/reviews/${reviewId}/replies`),
  postReply: (reviewId, body) => post(`/ratings/reviews/${reviewId}/reply`, { body }),

  // Global reviews feed
  getGlobalReviews: (sort = "recent", entityType = "all") =>
    request(`/reviews/global?sort=${sort}&entity_type=${entityType}`),

  // Saved comparisons
  saveComparison: (body) => post("/comparisons/", body),
  getComparison: (id) => request(`/comparisons/${id}`),

  // Auth
  getProfile: () => request(`/auth/profile`),

  // Featured
  getFeatured: () => request(`/featured`),

  // Leaderboard
  getLeaderboard: (sort = "era", limit = 50) => request(`/leaderboard/?sort=${sort}&limit=${limit}`),

  // Notifications
  getNotifications: () => request(`/notifications`),
  getUnreadCount: () => request(`/notifications/unread-count`),
  markNotificationsRead: () => post(`/notifications/read-all`, {}),

  // Profile update
  updateProfile: (bio) => patch(`/auth/profile`, { bio }),
  updatePinnedAlbums: (ids) => patch(`/auth/profile`, { pinned_album_ids: ids }),

  // Taste profile
  getUserTaste: (id) => request(`/users/${id}/taste`),

  // Suggested users
  getSuggestedUsers: () => request(`/users/suggested`),

  // Discover / For You feed
  getDiscoverFeed: ({ genres = [], exclude = [], limit = 10 } = {}) => {
    const params = new URLSearchParams({ limit });
    if (genres.length) params.set("genres", genres.join(","));
    if (exclude.length) params.set("exclude", exclude.join(","));
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
};
