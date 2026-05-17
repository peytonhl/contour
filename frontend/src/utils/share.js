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
    return shareCardNative({ cardUrl, fileName, mode: "save" });
  }
  return downloadCardWeb({ cardUrl, fileName });
}

async function shareCardNative({ cardUrl, shareUrl, shareText, fileName, mode }) {
  const [{ Share }, { Filesystem, Directory }] = await Promise.all([
    import("@capacitor/share"),
    import("@capacitor/filesystem"),
  ]);

  const res = await fetch(cardUrl);
  if (!res.ok) throw new Error(`Card fetch failed: ${res.status}`);
  const blob = await res.blob();
  const base64 = await blobToBase64(blob);

  // Write to Cache so iOS can hand the file:// URI to UIActivityViewController.
  // Cache directory needs no user permission and gets cleaned up by the OS.
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });

  const args = mode === "save"
    ? { files: [uri], dialogTitle: "Save your card" }
    : { files: [uri], text: shareText, url: shareUrl, dialogTitle: "Share your card" };

  await Share.share(args);
  return "shared";
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
