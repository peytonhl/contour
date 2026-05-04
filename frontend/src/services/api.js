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
  getReviews: (entityType, entityId) => request(`/ratings/${entityType}/${entityId}/reviews`),
  toggleLike: (reviewId) => post(`/ratings/reviews/${reviewId}/like`, {}),

  // Saved comparisons
  saveComparison: (body) => post("/comparisons/", body),
  getComparison: (id) => request(`/comparisons/${id}`),

  // Auth
  getProfile: () => request(`/auth/profile`),

  // Featured
  getFeatured: () => request(`/featured`),

  // Users (follow / public profiles)
  getUser: (id) => request(`/users/${id}`),
  toggleFollow: (id) => post(`/users/${id}/follow`, {}),
  getFollowing: (id) => request(`/users/${id}/following`),
  getFollowers: (id) => request(`/users/${id}/followers`),

  getMe: (token) => {
    return fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => {
      if (!r.ok) throw new Error("Not authenticated");
      return r.json();
    });
  },
};
