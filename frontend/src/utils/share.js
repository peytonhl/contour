/**
 * Card-share dispatcher — routes through @capacitor/share + @capacitor/filesystem
 * on the native iOS/Android shell, and Web Share Level 2 / browser download
 * on the web.
 *
 * Why both paths exist: Web Share Level 2 (navigator.share({ files })) works
 * inconsistently in iOS Capacitor's WKWebView — canShare({ files }) often
 * returns false even when the share would actually succeed, and silent
 * failures fall through to URL-only share. The native path uses Capacitor's
 * Share plugin which talks straight to UIActivityViewController and reliably
 * attaches the PNG.
 *
 * Both "share" and "save" go through the system share sheet on native; the
 * difference is that save passes only the file (no text/url) so the share
 * sheet's "Save Image" / "Add to Photos" actions surface at the top.
 */
import { isNativePlatform } from "./native.js";

export async function shareCard({ cardUrl, shareUrl, shareText, fileName }) {
  if (isNativePlatform()) {
    return shareCardNative({ cardUrl, shareUrl, shareText, fileName, mode: "share" });
  }
  return shareCardWeb({ cardUrl, shareUrl, shareText, fileName });
}

export async function saveCard({ cardUrl, fileName }) {
  if (isNativePlatform()) {
    return saveCardNative({ cardUrl, fileName });
  }
  return downloadCardWeb({ cardUrl, fileName });
}

// Write the OG card PNG to the app's Cache directory and return its file://
// URI. Used by both share and save flows on native — the Share + Media
// plugins both take filesystem paths, not blobs. Cache lives entirely
// inside the app sandbox so no user permission is required to write here;
// iOS reclaims it when the device is low on space.
async function writeCardToCache(cardUrl, fileName) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const res = await fetch(cardUrl);
  if (!res.ok) throw new Error(`Card fetch failed: ${res.status}`);
  const blob = await res.blob();
  const base64 = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });
  return uri;
}

async function shareCardNative({ cardUrl, shareUrl, shareText, fileName }) {
  const { Share } = await import("@capacitor/share");
  const uri = await writeCardToCache(cardUrl, fileName);
  await Share.share({
    files: [uri],
    text: shareText,
    url: shareUrl,
    dialogTitle: "Share your card",
  });
  return "shared";
}

// Save the card directly to the iOS / Android photo library. Uses
// @capacitor-community/media (Share.share would only open the share sheet,
// which is what users had to navigate through previously — they reported it
// "didn't actually save, just allowed me to export"). iOS requires
// NSPhotoLibraryAddUsageDescription in Info.plist (injected by
// codemagic.yaml); first call prompts the user once.
async function saveCardNative({ cardUrl, fileName }) {
  const { Media } = await import("@capacitor-community/media");
  const uri = await writeCardToCache(cardUrl, fileName);
  await Media.savePhoto({ path: uri });
  return "saved";
}

async function shareCardWeb({ cardUrl, shareUrl, shareText, fileName }) {
  try {
    const res = await fetch(cardUrl);
    if (res.ok && navigator.share) {
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: blob.type || "image/png" });
      // Skip the navigator.canShare({ files }) gate — it false-negatives in some
      // browsers (notably iOS Capacitor WKWebView) even when share() itself works.
      // Catch and fall through if share throws.
      try {
        await navigator.share({ files: [file], text: shareText, url: shareUrl });
        return "shared";
      } catch { /* fall through */ }
    }
  } catch { /* fetch/blob failed */ }

  if (navigator.share) {
    try { await navigator.share({ url: shareUrl, text: shareText }); return "shared"; }
    catch { /* cancelled */ }
  }

  try { await navigator.clipboard.writeText(shareUrl); return "copied"; }
  catch { return "failed"; }
}

async function downloadCardWeb({ cardUrl, fileName }) {
  // Anchor with `download` attribute is the most reliable browser save —
  // works in every desktop browser and iOS Safari (saves to Files / Photos
  // via the system download flow).
  const res = await fetch(cardUrl);
  if (!res.ok) throw new Error(`Card fetch failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      // FileReader produces "data:image/png;base64,XYZ..." — strip the prefix
      // since Filesystem.writeFile expects raw base64.
      const comma = typeof result === "string" ? result.indexOf(",") : -1;
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
