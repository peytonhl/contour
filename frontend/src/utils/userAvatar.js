/**
 * User avatar helpers.
 *
 * The stored `image_url` for most users is their Google profile photo
 * (`lh3.googleusercontent.com/...`, set from the OAuth `picture` claim at
 * signup). Google increasingly returns 403/429 for those photos when the
 * request carries a referrer header (hotlink protection) — which makes the
 * <img> render broken with no fallback. Two mitigations, applied at every
 * avatar <img> via the helpers here:
 *   1. referrerPolicy="no-referrer"  → avoids Google's referrer-based block.
 *   2. onError={avatarOnError(user)} → if the photo still fails (dead/expired
 *      URL, offline), swap to the generated initials avatar instead of a
 *      broken-image icon.
 */

/** Generated initials avatar (always loads — no auth, no hotlink rules). */
export function initialsAvatar(user, size = 128) {
  const name = encodeURIComponent(user?.display_name || user?.name || "?");
  return `https://ui-avatars.com/api/?name=${name}&background=7c3aed&color=fff&bold=true&size=${size}`;
}

/**
 * Photo URL for a user — their image_url if set, else the initials avatar.
 * Pair with referrerPolicy="no-referrer" + onError={avatarOnError(user, size)}
 * on the <img> so a blocked/dead photo degrades to initials.
 */
export function userAvatar(user, size = 128) {
  if (user?.image_url) return user.image_url;
  return initialsAvatar(user, size);
}

/**
 * onError handler factory for avatar <img> tags. On the first load failure it
 * swaps the src to the initials avatar; a dataset guard prevents an infinite
 * loop if the fallback itself ever fails.
 */
export function avatarOnError(user, size = 128) {
  return (e) => {
    const img = e.currentTarget;
    if (!img || img.dataset.avatarFellBack) return;
    img.dataset.avatarFellBack = "1";
    img.src = initialsAvatar(user, size);
  };
}
