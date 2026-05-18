#!/usr/bin/env python3
"""
Daily artist-site sync for the master Google Sheets gig tracker.

Workflow:
- Read the current cloud tracker tabs through Google Sheets CSV export.
- Check every artist website that has a supported public calendar.
- Upsert future gigs into Events / Event_Artists / Venue_Artist_History.
- Preserve every past event.
- If a future artist-site event disappears, mark it canceled_or_removed.
- If it disappears but the same artist/title/venue appears on a new date, mark
  the old row rescheduled_or_date_changed and keep both rows.
- Optionally import the repaired full CSV tables back into the live Google Sheet
  through the logged-in Chrome session.

This intentionally avoids paid APIs. The browser import mode expects the user to
be logged into Google in Chrome.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable

try:
    from playwright.sync_api import sync_playwright
except Exception:  # pragma: no cover
    sync_playwright = None


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SPREADSHEET_ID = "1UBuHO1MSwYTuSobheGFyt-b05HTxHVbKrr_u7M8q2Sw"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "scraped" / "artist_site_sync"
LOG_PATH = Path.home() / "Library" / "Logs" / "jddm-artist-gig-tracker-sync.log"
CHROME_DEBUG_URL = "http://127.0.0.1:9222"

SHEET_GIDS = {
    "Venues": "494362240",
    "Artists": "1440748684",
    "Events": "1265082734",
    "Event_Artists": "345768205",
    "Venue_Artist_History": "208389095",
    "Review_Queue": "1591439609",
}

VENUE_HEADERS = [
    "venue_id",
    "place_name",
    "address",
    "city",
    "zip",
    "state",
    "longitude",
    "latitude",
    "crm_status",
    "last_contacted",
    "contact_name",
    "email_contact",
    "phone_number",
    "booking_contact",
    "contact_type",
    "priority",
    "next_follow_up",
    "venue_type",
    "website",
    "active_live_music",
    "past_gig_count",
    "future_gig_count",
    "total_gig_count",
    "source",
    "source_place_id",
    "last_synced",
    "notes",
]

ARTIST_HEADERS = [
    "artist_id",
    "canonical_name",
    "artist_type",
    "home_city",
    "home_state",
    "genres",
    "website",
    "socials",
    "booking_email",
    "phone",
    "first_seen",
    "last_seen",
    "times_seen",
    "source",
    "confidence",
    "notes",
]

EVENT_HEADERS = [
    "event_id",
    "event_date",
    "start_time",
    "end_time",
    "title",
    "venue_id",
    "venue_name_snapshot",
    "city",
    "state",
    "source",
    "source_record_id",
    "source_url",
    "status",
    "confidence",
    "description",
    "ticket_info",
    "image_urls",
    "scraped_at",
    "dedupe_key",
    "notes",
]

EVENT_ARTIST_HEADERS = [
    "event_artist_id",
    "event_id",
    "artist_id",
    "artist_name_snapshot",
    "artist_type_at_event",
    "billing_order",
    "role",
    "confidence",
    "source",
]

HISTORY_HEADERS = [
    "venue_id",
    "venue_name",
    "artist_id",
    "artist_name",
    "times_played",
    "first_seen",
    "last_seen",
    "last_event_id",
    "last_source_url",
]

REVIEW_HEADERS = [
    "review_id",
    "review_type",
    "priority",
    "status",
    "related_id",
    "venue_name",
    "artist_name",
    "event_title",
    "event_date",
    "source",
    "source_url",
    "reason",
    "suggested_action",
    "notes",
]


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def norm(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def slug(value: object, fallback: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", clean(value).lower()).strip("-")
    return result or fallback


def short_hash(*parts: object, length: int = 8) -> str:
    return hashlib.sha1("|".join(clean(part) for part in parts).encode("utf-8")).hexdigest()[:length]


def make_id(prefix: str, *parts: object) -> str:
    readable = slug(parts[0] if parts else "", prefix)[:44].rstrip("-") or prefix
    return f"{prefix}-{readable}-{short_hash(*parts)}"


def parse_iso(value: object) -> date | None:
    text = clean(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def read_sheet_csv(spreadsheet_id: str, sheet: str) -> list[dict[str, str]]:
    query_sheet = urllib.parse.quote(sheet)
    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/gviz/tq?tqx=out:csv&sheet={query_sheet}"
    with urllib.request.urlopen(url, timeout=40) as response:
        data = response.read().decode("utf-8")
    return list(csv.DictReader(io.StringIO(data)))


def write_csv(path: Path, headers: list[str], rows: Iterable[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: row.get(header, "") for header in headers})


class CalendarTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_tr = False
        self.in_td = False
        self.rows: list[list[str]] = []
        self.current_row: list[str] = []
        self.current_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self.in_tr = True
            self.current_row = []
        elif tag == "td" and self.in_tr:
            self.in_td = True
            self.current_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self.in_td:
            self.current_row.append(clean("".join(self.current_text)))
            self.in_td = False
        elif tag == "tr" and self.in_tr:
            if len(self.current_row) >= 3:
                self.rows.append(self.current_row[:3])
            self.in_tr = False

    def handle_data(self, data: str) -> None:
        if self.in_td:
            self.current_text.append(data)


@dataclass
class ScrapedArtistEvent:
    artist_id: str
    artist_name: str
    artist_type: str
    event_date: str
    start_time: str
    end_time: str
    title: str
    venue_name: str
    city: str
    state: str
    zip_code: str
    source: str
    source_record_id: str
    source_url: str
    description: str

    @property
    def dedupe_key(self) -> str:
        return "|".join([self.event_date, self.start_time, norm(self.venue_name), norm(self.title)])

    @property
    def event_id(self) -> str:
        return make_id("event", self.dedupe_key)


@dataclass
class ArtistSiteScrape:
    events: list[ScrapedArtistEvent]
    checked_artist_ids: set[str]
    checked_sources: set[str]


def fetch_url(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read().decode("utf-8", errors="ignore")


def find_bandzoogle_calendar_feature(html: str) -> str | None:
    match = re.search(r"calendar_feature_(\d+)", html)
    return match.group(1) if match else None


def parse_bandzoogle_date(text: str, default_year: int) -> tuple[str, str, str] | None:
    match = re.search(
        r"([A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2})\s+@\s+(\d{1,2}:\d{2}\s*[AP]M)(?:\s+—\s+(\d{1,2}:\d{2}\s*[AP]M))?",
        text,
    )
    if not match:
        return None
    _weekday, month, day, start, end = match.groups()
    parsed = datetime.strptime(f"{default_year} {month} {day}", "%Y %B %d").date()
    # If a January event is viewed from late December, this keeps future pages sane.
    if parsed < date.today().replace(day=1) and date.today().month >= 11:
        parsed = parsed.replace(year=default_year + 1)
    return parsed.isoformat(), clean(start).replace(" ", ""), clean(end or "").replace(" ", "")


def parse_bandzoogle_calendar(artist: dict[str, str], logger: logging.Logger) -> list[ScrapedArtistEvent]:
    website = clean(artist.get("website"))
    if not website:
        return []
    try:
        home_html = fetch_url(website)
    except Exception as exc:
        logger.warning("Could not fetch artist site %s: %s", website, exc)
        return []
    feature_id = find_bandzoogle_calendar_feature(home_html)
    if not feature_id:
        logger.info("No Bandzoogle calendar found for %s", artist.get("canonical_name"))
        return []

    parsed_url = urllib.parse.urlparse(website)
    base = f"{parsed_url.scheme}://{parsed_url.netloc}"
    path_prefix = parsed_url.path.rstrip("/") or "/home"
    pages = [website]
    pages.extend(f"{base}{path_prefix}/features/load/calendar_feature_{feature_id}.turbo_stream?calendar_page={page}" for page in range(2, 13))

    rows: list[tuple[str, str, str]] = []
    for page_url in pages:
        try:
            html = fetch_url(page_url)
        except Exception as exc:
            logger.info("Stopping calendar pagination for %s at %s: %s", artist.get("canonical_name"), page_url, exc)
            break
        parser = CalendarTableParser()
        parser.feed(html)
        page_rows = [tuple(row) for row in parser.rows if row and not row[0].lower().startswith("date")]
        if not page_rows and page_url != website:
            break
        rows.extend(page_rows)

    seen: set[tuple[str, str, str]] = set()
    events: list[ScrapedArtistEvent] = []
    artist_name = clean(artist.get("canonical_name"))
    artist_id = clean(artist.get("artist_id")) or make_id("artist", artist_name)
    artist_type = clean(artist.get("artist_type")) or "unknown"

    for date_text, title_text, location_text in rows:
        key = (date_text, title_text, location_text)
        if key in seen:
            continue
        seen.add(key)
        parsed = parse_bandzoogle_date(date_text, date.today().year)
        if not parsed:
            continue
        event_date, start_time, end_time = parsed
        venue = clean(location_text.split(",")[0])
        city = ""
        zip_code = ""
        city_match = re.search(r",\s*([^,]+),\s*OH\s*(\d{5})?", location_text)
        if city_match:
            city = clean(city_match.group(1))
            zip_code = clean(city_match.group(2))
        title = f"{artist_name} @ {venue}" if venue else clean(title_text)
        events.append(
            ScrapedArtistEvent(
                artist_id=artist_id,
                artist_name=artist_name,
                artist_type=artist_type,
                event_date=event_date,
                start_time=start_time,
                end_time=end_time,
                title=title,
                venue_name=venue,
                city=city,
                state="OH",
                zip_code=zip_code,
                source=artist_site_source(website),
                source_record_id=short_hash(*key, length=12),
                source_url=website,
                description=f"{title_text} | {location_text}",
            )
        )
    return events


def artist_site_source(website: str) -> str:
    return f"artist_site:{urllib.parse.urlparse(website).netloc.lower().removeprefix('www.')}"


def parse_jddm_website_calendar(artist: dict[str, str], logger: logging.Logger) -> list[ScrapedArtistEvent]:
    artist_name = clean(artist.get("canonical_name"))
    website = clean(artist.get("website"))
    if "justdeedeemusic.com" not in website.lower():
        return []

    calendar_url = urllib.parse.urljoin(website.rstrip("/") + "/", "calendar/")
    node_bin = os.environ.get("JDDM_NODE_BIN") or shutil.which("node") or "node"
    command = [
        node_bin,
        str(REPO_ROOT / "scripts" / "pull-jddm-website-bookings.mjs"),
        "--url",
        calendar_url,
        "--json",
    ]
    try:
        result = subprocess.run(command, cwd=REPO_ROOT, check=True, capture_output=True, text=True, timeout=90)
    except Exception as exc:
        logger.warning("Could not parse Just Dee Dee website calendar: %s", exc)
        return []

    payload = json.loads(result.stdout)
    artist_id = clean(artist.get("artist_id")) or make_id("artist", artist_name)
    artist_type = clean(artist.get("artist_type")) or "solo"
    events: list[ScrapedArtistEvent] = []
    for booking in payload.get("bookings", []):
        venue = clean(booking.get("venueName"))
        title = clean(booking.get("title")) or f"{artist_name} @ {venue}"
        events.append(
            ScrapedArtistEvent(
                artist_id=artist_id,
                artist_name=artist_name,
                artist_type=artist_type,
                event_date=clean(booking.get("eventDate")),
                start_time=clean(booking.get("eventTime")).replace(" ", ""),
                end_time=clean(booking.get("eventEndTime")).replace(" ", ""),
                title=title,
                venue_name=venue,
                city=clean(booking.get("city")),
                state=clean(booking.get("state")) or "OH",
                zip_code=clean(booking.get("zip")),
                source=artist_site_source(website),
                source_record_id=clean(booking.get("eventId")) or short_hash(title, venue, booking.get("eventDate"), length=12),
                source_url=calendar_url,
                description=clean(" | ".join(part for part in [booking.get("location"), booking.get("notes")] if clean(part))),
            )
        )
    return events


def scrape_supported_artist_sites(artists: list[dict[str, str]], logger: logging.Logger) -> ArtistSiteScrape:
    events: list[ScrapedArtistEvent] = []
    checked_artist_ids: set[str] = set()
    checked_sources: set[str] = set()
    for artist in artists:
        website = clean(artist.get("website"))
        if not website:
            continue
        artist_id = clean(artist.get("artist_id")) or make_id("artist", artist.get("canonical_name"))
        scraped: list[ScrapedArtistEvent]
        if "justdeedeemusic.com" in website.lower():
            scraped = parse_jddm_website_calendar(artist, logger)
            checked_artist_ids.add(artist_id)
            checked_sources.add(artist_site_source(website))
        else:
            home_html = ""
            try:
                home_html = fetch_url(website)
            except Exception as exc:
                logger.warning("Could not fetch artist site %s: %s", website, exc)
                continue
            if not find_bandzoogle_calendar_feature(home_html):
                logger.info("No supported calendar found for %s", artist.get("canonical_name"))
                continue
            scraped = parse_bandzoogle_calendar(artist, logger)
            checked_artist_ids.add(artist_id)
            checked_sources.add(artist_site_source(website))
        logger.info("%s yielded %d artist-site events", artist.get("canonical_name"), len(scraped))
        events.extend(scraped)
    return ArtistSiteScrape(events=events, checked_artist_ids=checked_artist_ids, checked_sources=checked_sources)


def row_by_key(rows: Iterable[dict[str, str]], key: str) -> dict[str, dict[str, str]]:
    return {clean(row.get(key)): row for row in rows if clean(row.get(key))}


def match_venue_id(venues: list[dict[str, str]], event: ScrapedArtistEvent) -> str:
    by_name = {norm(row.get("place_name") or row.get("Place Name")): clean(row.get("venue_id") or row.get("Place ID")) for row in venues}
    candidates = [
        norm(event.venue_name),
        norm(f"{event.venue_name} {event.city}"),
        norm(f"The {event.venue_name}"),
    ]
    for candidate in candidates:
        if candidate in by_name:
            return by_name[candidate]
    for row in venues:
        name = norm(row.get("place_name") or row.get("Place Name"))
        city = norm(row.get("city") or row.get("City"))
        if name and (name in norm(event.venue_name) or norm(event.venue_name) in name) and (not city or city == norm(event.city)):
            return clean(row.get("venue_id") or row.get("Place ID"))
    return ""


def add_missing_venue(venues_by_id: dict[str, dict[str, str]], event: ScrapedArtistEvent) -> str:
    venue_id = make_id("venue", event.venue_name, event.city, event.state)
    if venue_id not in venues_by_id:
        venues_by_id[venue_id] = {
            "venue_id": venue_id,
            "place_name": event.venue_name,
            "address": "",
            "city": event.city,
            "zip": event.zip_code,
            "state": event.state,
            "longitude": "",
            "latitude": "",
            "crm_status": "Needs Review",
            "last_contacted": "",
            "contact_name": "",
            "email_contact": "",
            "phone_number": "",
            "booking_contact": "",
            "contact_type": "",
            "priority": "",
            "next_follow_up": "",
            "venue_type": "Music Venue",
            "website": "",
            "active_live_music": "yes",
            "past_gig_count": "",
            "future_gig_count": "",
            "total_gig_count": "",
            "source": "artist_site_sync",
            "source_place_id": "",
            "last_synced": now_iso(),
            "notes": "Discovered from artist website calendar; address/coordinates need review.",
        }
    return venue_id


def upsert_review(reviews_by_id: dict[str, dict[str, str]], event: ScrapedArtistEvent, reason: str) -> None:
    review_id = make_id("review", "venue_match", event.event_id)
    reviews_by_id[review_id] = {
        "review_id": review_id,
        "review_type": "venue_match",
        "priority": "high",
        "status": "needs_review",
        "related_id": event.event_id,
        "venue_name": event.venue_name,
        "artist_name": event.artist_name,
        "event_title": event.title,
        "event_date": event.event_date,
        "source": event.source,
        "source_url": event.source_url,
        "reason": reason,
        "suggested_action": "Match to existing venue_id or add/confirm the venue in the master venue list.",
        "notes": "",
    }


def merge_tracker(
    venues: list[dict[str, str]],
    artists: list[dict[str, str]],
    events: list[dict[str, str]],
    event_artists: list[dict[str, str]],
    history: list[dict[str, str]],
    reviews: list[dict[str, str]],
    scrape: ArtistSiteScrape,
) -> dict[str, list[dict[str, str]] | dict[str, int]]:
    today = date.today()
    venues_by_id = row_by_key(venues, "venue_id")
    artists_by_id = row_by_key(artists, "artist_id")
    events_by_id = row_by_key(events, "event_id")
    event_artists_by_id = row_by_key(event_artists, "event_artist_id")
    history_by_key = {
        f"{clean(row.get('venue_id'))}|{clean(row.get('artist_id'))}": row
        for row in history
        if clean(row.get("venue_id")) and clean(row.get("artist_id"))
    }
    reviews_by_id = row_by_key(reviews, "review_id")

    scraped = scrape.events
    scraped_by_event_id = {event.event_id: event for event in scraped}
    added = 0
    updated = 0
    canceled = 0
    rescheduled = 0

    for item in scraped:
        venue_id = match_venue_id(list(venues_by_id.values()), item)
        if not venue_id:
            venue_id = add_missing_venue(venues_by_id, item)
            upsert_review(reviews_by_id, item, "Artist-site event venue needs master venue confirmation.")

        existing = events_by_id.get(item.event_id)
        status = clean(existing.get("status")) if existing else "needs_review"
        if not status:
            status = "needs_review"
        if status in {"canceled_or_removed", "rescheduled_or_date_changed"}:
            status = "needs_review"
        row = {
            "event_id": item.event_id,
            "event_date": item.event_date,
            "start_time": item.start_time,
            "end_time": item.end_time,
            "title": item.title,
            "venue_id": venue_id,
            "venue_name_snapshot": item.venue_name,
            "city": item.city,
            "state": item.state,
            "source": item.source,
            "source_record_id": item.source_record_id,
            "source_url": item.source_url,
            "status": status,
            "confidence": "artist_site_calendar",
            "description": item.description,
            "ticket_info": clean(existing.get("ticket_info")) if existing else "",
            "image_urls": clean(existing.get("image_urls")) if existing else "",
            "scraped_at": now_iso(),
            "dedupe_key": item.dedupe_key,
            "notes": clean(existing.get("notes")) if existing else "",
        }
        events_by_id[item.event_id] = row
        added += 0 if existing else 1
        updated += 1 if existing else 0

        event_artist_id = make_id("eventartist", item.event_id, item.artist_id)
        event_artists_by_id[event_artist_id] = {
            "event_artist_id": event_artist_id,
            "event_id": item.event_id,
            "artist_id": item.artist_id,
            "artist_name_snapshot": item.artist_name,
            "artist_type_at_event": item.artist_type,
            "billing_order": "1",
            "role": "headliner",
            "confidence": "artist_site_calendar",
            "source": item.source,
        }

        hkey = f"{venue_id}|{item.artist_id}"
        hrow = history_by_key.setdefault(
            hkey,
            {
                "venue_id": venue_id,
                "venue_name": item.venue_name,
                "artist_id": item.artist_id,
                "artist_name": item.artist_name,
                "times_played": "0",
                "first_seen": item.event_date,
                "last_seen": item.event_date,
                "last_event_id": item.event_id,
                "last_source_url": item.source_url,
            },
        )
        known_event_ids = {
            clean(row.get("event_id"))
            for row in events_by_id.values()
            if clean(row.get("venue_id")) == venue_id
            and clean(row.get("source", "")).startswith("artist_site:")
            and clean(row.get("status")) not in {"canceled_or_removed", "duplicate", "ignore"}
        }
        dates = [
            clean(row.get("event_date"))
            for row in events_by_id.values()
            if clean(row.get("event_id")) in known_event_ids
            and any(clean(link.get("event_id")) == clean(row.get("event_id")) and clean(link.get("artist_id")) == item.artist_id for link in event_artists_by_id.values())
        ]
        if dates:
            dates = sorted(set(dates))
            hrow["times_played"] = str(len(dates))
            hrow["first_seen"] = dates[0]
            hrow["last_seen"] = dates[-1]
            hrow["last_event_id"] = item.event_id
            hrow["last_source_url"] = item.source_url

    scraped_artist_sources = scrape.checked_sources
    scraped_artist_ids = scrape.checked_artist_ids
    scraped_semantic = {(event.artist_id, norm(event.title), norm(event.venue_name)) for event in scraped}

    for row in list(events_by_id.values()):
        event_day = parse_iso(row.get("event_date"))
        if not event_day or event_day < today:
            continue
        if clean(row.get("event_id")) in scraped_by_event_id:
            continue
        row_source = clean(row.get("source"))
        normalized_row_source = re.sub(r"^artist_site:www\.", "artist_site:", row_source)
        if normalized_row_source not in scraped_artist_sources:
            continue
        linked_artist_ids = [
            clean(link.get("artist_id"))
            for link in event_artists_by_id.values()
            if clean(link.get("event_id")) == clean(row.get("event_id"))
        ]
        if not any(artist_id in scraped_artist_ids for artist_id in linked_artist_ids):
            continue
        semantic = [(artist_id, norm(row.get("title")), norm(row.get("venue_name_snapshot"))) for artist_id in linked_artist_ids]
        next_status = "rescheduled_or_date_changed" if any(item in scraped_semantic for item in semantic) else "canceled_or_removed"
        if clean(row.get("status")) != next_status:
            row["status"] = next_status
            note = f"Artist-site sync {now_iso()}: future event no longer appears on source calendar."
            if next_status == "rescheduled_or_date_changed":
                note += " A similar artist/title/venue appears on another date."
                rescheduled += 1
            else:
                canceled += 1
            row["notes"] = clean(" | ".join(x for x in [row.get("notes"), note] if clean(x)))
            row["scraped_at"] = now_iso()

    return {
        "Venues": sorted(venues_by_id.values(), key=lambda row: clean(row.get("place_name")).lower()),
        "Artists": sorted(artists_by_id.values(), key=lambda row: clean(row.get("canonical_name")).lower()),
        "Events": sorted(events_by_id.values(), key=lambda row: (clean(row.get("event_date")), clean(row.get("start_time")), clean(row.get("title")))),
        "Event_Artists": sorted(event_artists_by_id.values(), key=lambda row: (clean(row.get("event_id")), clean(row.get("billing_order")))),
        "Venue_Artist_History": sorted(history_by_key.values(), key=lambda row: (clean(row.get("venue_name")), clean(row.get("artist_name")))),
        "Review_Queue": sorted(reviews_by_id.values(), key=lambda row: (clean(row.get("status")), clean(row.get("priority")), clean(row.get("event_date")))),
        "summary": {
            "scraped": len(scraped),
            "added": added,
            "updated": updated,
            "canceled_or_removed": canceled,
            "rescheduled_or_date_changed": rescheduled,
        },
    }


def ensure_chrome_debug() -> None:
    try:
        urllib.request.urlopen(f"{CHROME_DEBUG_URL}/json/version", timeout=2).read()
        return
    except Exception:
        pass
    subprocess.run(["open", "-a", "Google Chrome", "--args", "--remote-debugging-port=9222"], check=False)
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{CHROME_DEBUG_URL}/json/version", timeout=2).read()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("Could not connect to Chrome remote debugging on port 9222.")


def import_csv_to_sheet(page: object, spreadsheet_id: str, sheet: str, csv_path: Path) -> None:
    gid = SHEET_GIDS[sheet]
    base = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
    page.goto(f"{base}?gid={gid}#gid={gid}", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    page.keyboard.press("Escape")
    page.locator("#docs-file-menu").click(timeout=15000)
    page.wait_for_timeout(700)
    page.get_by_text("Import", exact=True).last.click(timeout=15000)
    page.wait_for_timeout(2500)
    frame = next(frame for frame in page.frames if "picker" in frame.url)
    frame.get_by_text("Upload", exact=True).click(timeout=15000)
    page.wait_for_timeout(800)
    frame.locator("input[type=file]").set_input_files(str(csv_path.resolve()))
    page.wait_for_timeout(5000)
    page.locator('[role="listbox"]').filter(has_text="Import location").first.click(timeout=15000)
    page.wait_for_timeout(700)
    page.get_by_text("Replace current sheet", exact=True).click(timeout=15000)
    page.wait_for_timeout(800)
    page.get_by_text("Import data", exact=True).click(timeout=15000)
    page.wait_for_timeout(10000)


def import_outputs_to_google_sheet(spreadsheet_id: str, output_paths: dict[str, Path], logger: logging.Logger) -> None:
    if sync_playwright is None:
        raise RuntimeError("Playwright is not installed. Run python3 -m pip install playwright.")
    ensure_chrome_debug()
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(CHROME_DEBUG_URL)
        context = browser.contexts[0]
        page = next((candidate for candidate in context.pages if "docs.google.com/spreadsheets" in candidate.url), None)
        if page is None:
            page = context.new_page()
        for sheet in ["Venues", "Artists", "Events", "Event_Artists", "Venue_Artist_History", "Review_Queue"]:
            logger.info("Importing %s into Google Sheet", sheet)
            import_csv_to_sheet(page, spreadsheet_id, sheet, output_paths[sheet])


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync artist website calendars into the master gig tracker.")
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--import-google-sheet", action="store_true", help="Replace live tracker tabs with repaired CSVs via logged-in Chrome.")
    parser.add_argument("--dry-run", action="store_true", help="Build output files but do not import into Google Sheets.")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args(argv)


def configure_logging(level: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    if not os.environ.get("XPC_SERVICE_NAME"):
        handlers.append(logging.FileHandler(LOG_PATH, encoding="utf-8"))
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
        force=True,
    )


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    configure_logging(args.log_level)
    logger = logging.getLogger("artist_site_sync")

    logger.info("Reading tracker tabs from %s", args.spreadsheet_id)
    venues = read_sheet_csv(args.spreadsheet_id, "Venues")
    artists = read_sheet_csv(args.spreadsheet_id, "Artists")
    events = read_sheet_csv(args.spreadsheet_id, "Events")
    event_artists = read_sheet_csv(args.spreadsheet_id, "Event_Artists")
    history = read_sheet_csv(args.spreadsheet_id, "Venue_Artist_History")
    reviews = read_sheet_csv(args.spreadsheet_id, "Review_Queue")

    scrape = scrape_supported_artist_sites(artists, logger)
    merged = merge_tracker(venues, artists, events, event_artists, history, reviews, scrape)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = args.output_dir / timestamp
    output_paths = {
        "Venues": output_dir / "venues.csv",
        "Artists": output_dir / "artists.csv",
        "Events": output_dir / "events.csv",
        "Event_Artists": output_dir / "event_artists.csv",
        "Venue_Artist_History": output_dir / "venue_artist_history.csv",
        "Review_Queue": output_dir / "review_queue.csv",
    }
    write_csv(output_paths["Venues"], VENUE_HEADERS, merged["Venues"])  # type: ignore[arg-type]
    write_csv(output_paths["Artists"], ARTIST_HEADERS, merged["Artists"])  # type: ignore[arg-type]
    write_csv(output_paths["Events"], EVENT_HEADERS, merged["Events"])  # type: ignore[arg-type]
    write_csv(output_paths["Event_Artists"], EVENT_ARTIST_HEADERS, merged["Event_Artists"])  # type: ignore[arg-type]
    write_csv(output_paths["Venue_Artist_History"], HISTORY_HEADERS, merged["Venue_Artist_History"])  # type: ignore[arg-type]
    write_csv(output_paths["Review_Queue"], REVIEW_HEADERS, merged["Review_Queue"])  # type: ignore[arg-type]

    summary = dict(merged["summary"])  # type: ignore[arg-type]
    summary["output_dir"] = str(output_dir)
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))

    if args.import_google_sheet and not args.dry_run:
        import_outputs_to_google_sheet(args.spreadsheet_id, output_paths, logger)
        logger.info("Imported repaired tracker tabs into Google Sheets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
