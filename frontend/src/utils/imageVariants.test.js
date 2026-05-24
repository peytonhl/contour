// Tests for utils/imageVariants.js — the Spotify-CDN URL size swap.
//
// This is the unsexy file that, if regressed, would silently re-bloat every
// thumbnail back to 640×640. Pure function, no DOM — easy to test, high
// leverage to test thoroughly because there's no other safety net.
import { describe, it, expect } from "vitest";
import { imageThumb, imageMedium, imageLarge } from "./imageVariants.js";

const REAL = "https://i.scdn.co/image/ab67616d0000b273e8e1a9d9b1c95e8b9c0e9c9a";
const REAL_MEDIUM = "https://i.scdn.co/image/ab67616d00001e02e8e1a9d9b1c95e8b9c0e9c9a";
const REAL_SMALL = "https://i.scdn.co/image/ab67616d00004851e8e1a9d9b1c95e8b9c0e9c9a";

describe("imageVariants", () => {
  describe("imageThumb", () => {
    it("swaps a 640 Spotify URL to the 64 variant", () => {
      expect(imageThumb(REAL)).toBe(REAL_SMALL);
    });

    it("returns null / undefined unchanged so caller's ternary handles missing url", () => {
      expect(imageThumb(null)).toBe(null);
      expect(imageThumb(undefined)).toBe(undefined);
      expect(imageThumb("")).toBe("");
    });

    it("passes through non-Spotify URLs unchanged (Apple Music covers, custom avatars)", () => {
      const apple = "https://is1-ssl.mzstatic.com/image/thumb/Music/foo/100x100bb.jpg";
      const google = "https://lh3.googleusercontent.com/a/ABC123=s56-c";
      expect(imageThumb(apple)).toBe(apple);
      expect(imageThumb(google)).toBe(google);
    });

    it("passes through URLs that match the Spotify host but not the size-code pattern", () => {
      // If Spotify ever rotates the URL scheme, the regex no longer matches
      // and the function degrades to a no-op instead of mangling the URL.
      const malformed = "https://i.scdn.co/image/something-else-entirely";
      expect(imageThumb(malformed)).toBe(malformed);
    });
  });

  describe("imageMedium", () => {
    it("swaps a 640 Spotify URL to the 300 variant", () => {
      expect(imageMedium(REAL)).toBe(REAL_MEDIUM);
    });
  });

  describe("imageLarge", () => {
    it("is a no-op on a Spotify URL that's already at the 640 size", () => {
      expect(imageLarge(REAL)).toBe(REAL);
    });
  });

  describe("round-trips", () => {
    it("thumb → large → medium → thumb preserves the asset hash", () => {
      // The size code changes, but the leading type prefix and the trailing
      // 32-char asset hash MUST stay identical — otherwise we'd be loading
      // a different album's cover, which is much worse than a bad size.
      const sized = imageThumb(REAL);
      const back = imageLarge(sized);
      expect(back).toBe(REAL);
      // And the asset hash (the last 24 chars for album/track) is
      // preserved across every variant — only the 8-char size code in
      // the middle changes.
      const tail = REAL.slice(-24);
      expect(imageThumb(REAL).endsWith(tail)).toBe(true);
      expect(imageMedium(REAL).endsWith(tail)).toBe(true);
    });
  });
});
