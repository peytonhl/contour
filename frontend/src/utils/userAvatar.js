/**
 * Returns a photo URL for a user.
 * Falls back to a generated initials avatar if no image is set.
 */
export function userAvatar(user, size = 128) {
  if (user?.image_url) return user.image_url;
  const name = encodeURIComponent(user?.display_name || user?.name || "?");
  return `https://ui-avatars.com/api/?name=${name}&background=7c3aed&color=fff&bold=true&size=${size}`;
}
