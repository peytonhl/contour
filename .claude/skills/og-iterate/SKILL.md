---
name: og-iterate
description: Iterate on OG card / Satori PNG renderers in frontend/api/og/*.tsx. Use whenever editing one of those files, when the user asks to tweak how a share/preview card looks, or when generating a new OG card. Enforces the curl-download-Read-iterate inner loop — do not ship a visual change until I have personally fetched and Read the rendered PNG.
allowed-tools: Bash(curl:*), Read, Edit, Write
---

When working on any file under `frontend/api/og/*.tsx`, OR when the user asks to change how a share card / OG image / preview card looks:

## The inner loop (do not skip)

1. Edit the `.tsx` renderer.
2. Wait for Vercel to deploy (or run locally if a dev server is available — these are edge functions so usually faster to test against prod).
3. Fetch the rendered PNG:
   ```
   curl -sS "https://contour-rosy.vercel.app/api/og/<route>?<query>" -o /tmp/og-check.png
   ```
4. **Read `/tmp/og-check.png` with the Read tool.** Look at it. Decide if it's right.
5. If not right: back to step 1. Do NOT hand off to the user with "should be good now" — that violates `feedback_iterate_on_visuals_yourself` and `feedback_test_what_you_push`.

## Verify the function actually registered

After any new `frontend/api/og/<name>.tsx`:
```
curl -I "https://contour-rosy.vercel.app/api/og/<name>?<query>"
```
Expect `200` with `Content-Type: image/png` (or a 4xx from the handler with `text/plain`). A `404` + `X-Vercel-Error: NOT_FOUND` means the function didn't register — almost always a `.jsx` instead of `.tsx`, or a missing `frontend/api/tsconfig.json`. See CLAUDE.md "Vercel Edge Functions" section.

## Common gotchas

- `.tsx` not `.jsx` — Vercel autoregisters by extension.
- `frontend/api/tsconfig.json` must include `"jsx": "react-jsx"`.
- Vercel deploys dedupe by SHA — if the same commit was pushed to a feature branch first, Production may skip. See `feedback_vercel_dedup`. Force a no-op commit if Production is stale.
- **Bump `CARD_VERSION` in `frontend/src/components/CardPreviewModal.jsx`** whenever a renderer changes. The mobile app + iOS WebView cache the OG PNG under a key that includes `?v=<CARD_VERSION>`, so users on previous versions keep hitting the OLD CDN cache for HOURS even after a successful redeploy. Symptom: user screenshot shows the pre-change layout (old truncate length, old attribution copy, old cover size) while my `curl ?v=<timestamp>` returns the new render. Bumping the version rotates the cache key so the next preview pull lands on the fresh PNG. Old `v=N-1` URLs go cold naturally — nobody requests them anymore. The version-stamp history at the top of CardPreviewModal.jsx documents each bump's rationale; add an entry there too.

## Done means

- The latest PNG is on disk locally
- I have Read it in this session
- I can describe what it looks like without hedging
