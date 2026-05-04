"""
Wayback Machine archive scraper for historical Kworb stream data.

Kworb track/album pages have been archived by the Internet Archive since ~2014.
We query the CDX API to find all archived snapshots, pick a spread of ~12,
fetch them in parallel, parse the cumulative stream count from each, and
return a list of (date, stream_count) anchor points.

These anchors are cached in stream_anchors forever — historical data is immutable.
"""

from __future__ import annotations

import asyncio
import re
from datetime import date, datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup

CDX_API = "https://web.archive.org/cdx/search/cdx"
WB_BASE = "https://web.archive.org/web"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Contour/0.1; +https://contour-rosy.vercel.app)"}

# Max snapshots to fetch per entity — balances accuracy vs. Wayback load
MAX_SNAPSHOTS = 12
# Minimum days between anchor points (deduplicate burst archives)
MIN_GAP_DAYS = 21


async def get_wayback_anchors(
    spotify_id: str,
    entity_type: str,  # "track" or "album"
) -> list[dict]:
    """
    Return a list of {date: str (ISO), streams: int, source: "wayback"} dicts
    representing real historical stream counts scraped from Wayback snapshots
    of the Kworb page for this entity.

    Returns [] if no usable snapshots found.
    """
    kworb_path = f"kworb.net/spotify/{entity_type}/{spotify_id}.html"

    timestamps = await _fetch_cdx_timestamps(kworb_path)
    if len(timestamps) < 2:
        return []

    selected = _spread_select(timestamps, MAX_SNAPSHOTS)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20.0, connect=8.0),
        headers=HEADERS,
        follow_redirects=True,
    ) as client:
        tasks = [_fetch_and_parse(client, ts, kworb_path) for ts in selected]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    anchors: list[dict] = []
    for ts, result in zip(selected, results):
        if isinstance(result, Exception) or result is None:
            continue
        snapshot_date = datetime.strptime(ts[:8], "%Y%m%d").date()
        anchors.append({
            "date": snapshot_date.isoformat(),
            "streams": result,
            "source": "wayback",
        })

    anchors.sort(key=lambda x: x["date"])
    return _deduplicate(anchors, MIN_GAP_DAYS)


async def _fetch_cdx_timestamps(kworb_path: str) -> list[str]:
    """Query CDX API and return sorted list of 200-status snapshot timestamps."""
    params = {
        "url": kworb_path,
        "output": "json",
        "fl": "timestamp,statuscode",
        "filter": "statuscode:200",
        "limit": 150,
        "collapse": "timestamp:8",  # one per day max
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(CDX_API, params=params)
            resp.raise_for_status()
            rows = resp.json()
    except Exception:
        return []

    if not rows or len(rows) < 2:
        return []

    # rows[0] is the header ["timestamp", "statuscode"]
    return [row[0] for row in rows[1:] if len(row) >= 2]


async def _fetch_and_parse(
    client: httpx.AsyncClient,
    timestamp: str,
    kworb_path: str,
) -> Optional[int]:
    """Fetch one Wayback snapshot and extract cumulative stream count."""
    url = f"{WB_BASE}/{timestamp}/{kworb_path}"
    try:
        resp = await client.get(url)
        if resp.status_code != 200:
            return None
        return _parse_kworb_total(resp.text)
    except Exception:
        return None


def _parse_kworb_total(html: str) -> Optional[int]:
    """
    Extract the cumulative/total stream count from an archived Kworb page.

    Kworb pages show a totals row or a headline stream count.
    Strategy: parse the largest plausible number from known Kworb patterns,
    with a regex fallback on the largest comma-formatted number on the page.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Strategy 1: look for a "Total" row in the chart table (track pages)
    for row in soup.find_all("tr"):
        cells = row.find_all("td")
        if not cells:
            continue
        first = cells[0].get_text(strip=True).lower()
        if "total" in first and len(cells) >= 2:
            # Last non-empty cell is usually the cumulative total
            for cell in reversed(cells[1:]):
                val = _parse_int(cell.get_text(strip=True))
                if val and val > 1_000_000:
                    return val

    # Strategy 2: look for a bold/header-level stream count near "Streams" label
    for tag in soup.find_all(["b", "strong", "h1", "h2", "h3", "td", "th"]):
        text = tag.get_text(strip=True)
        if re.search(r"streams?", text, re.IGNORECASE):
            # Try the next sibling
            nxt = tag.find_next_sibling()
            if nxt:
                val = _parse_int(nxt.get_text(strip=True))
                if val and val > 1_000_000:
                    return val

    # Strategy 3: find the single largest comma-formatted number on the page
    # (stream counts are typically the biggest numbers on a Kworb page)
    candidates = []
    for m in re.finditer(r"\b(\d{1,3}(?:,\d{3})+)\b", html):
        val = _parse_int(m.group(1))
        if val and 5_000_000 <= val <= 100_000_000_000:
            candidates.append(val)

    return max(candidates) if candidates else None


def _parse_int(s: str) -> Optional[int]:
    try:
        return int(s.replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def _spread_select(timestamps: list[str], n: int) -> list[str]:
    """Pick n evenly-spaced timestamps, always including first and last."""
    if len(timestamps) <= n:
        return timestamps
    step = (len(timestamps) - 1) / (n - 1)
    indices = {round(i * step) for i in range(n)}
    return [timestamps[i] for i in sorted(indices)]


def _deduplicate(anchors: list[dict], min_gap_days: int) -> list[dict]:
    """Remove anchor points that are too close in time (burst archives)."""
    if not anchors:
        return []
    result = [anchors[0]]
    for anchor in anchors[1:]:
        last = date.fromisoformat(result[-1]["date"])
        this = date.fromisoformat(anchor["date"])
        if (this - last).days >= min_gap_days:
            result.append(anchor)
    return result
