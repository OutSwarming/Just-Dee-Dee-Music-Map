#!/usr/bin/env python3
"""
Build the Just Dee Dee Music Ohio music intelligence workbook.

This is intentionally dependency-free so it can run on a clean Mac with the
system Python. It writes a multi-tab .xlsx workbook that can be imported into
Google Sheets as the long-term storage database for Ohio venues, artists, gigs,
and raw scrape observations.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VENUES_CSV = ROOT / "assets/data/jddm-venues.csv"
DEFAULT_CALENDAR_GIGS_CSV = ROOT / "data/staged/jddm-calendar-gigs.csv"
DEFAULT_WEBSITE_HISTORY_CSV = ROOT / "data/staged/jddm-website-booking-history.csv"
DEFAULT_SCRAPER_CSV = ROOT / "data/scraped/live_music/neo_live_music_latest.csv"
DEFAULT_SCRAPER_DB = ROOT / "data/scraped/neo_live_music.sqlite3"
DEFAULT_OUTPUT = ROOT / "outputs/ohio_music_intel/JustDeeDeeMusic_Ohio_Music_Intel_Database.xlsx"


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

RAW_HEADERS = [
    "raw_id",
    "source",
    "query_used",
    "title",
    "url",
    "event_date",
    "event_time",
    "venue",
    "address",
    "city",
    "bands",
    "ticket_info",
    "description",
    "image_urls",
    "scraped_at",
    "raw_snippet",
    "location_match",
    "distance_miles",
    "relevance_score",
]


def clean(value: object) -> str:
    return str(value or "").strip()


def norm(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def slug(value: object, fallback: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", clean(value).lower()).strip("-")
    return base or fallback


def short_hash(*parts: object, length: int = 10) -> str:
    raw = "|".join(clean(part) for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:length]


def make_id(prefix: str, *parts: object) -> str:
    readable = slug(parts[0] if parts else "", prefix)
    if len(readable) > 44:
        readable = readable[:44].rstrip("-")
    return f"{prefix}-{readable}-{short_hash(*parts, length=8)}"


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def write_csv(path: Path, headers: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: row.get(header, "") for header in headers})


def split_artists(value: str) -> list[str]:
    text = clean(value)
    if not text:
        return []
    text = re.sub(r"\b(w/|with|featuring|feat\.?|ft\.?)\b", ",", text, flags=re.I)
    parts = re.split(r"\s+[+&]\s+|,| / |\|", text)
    names = []
    for part in parts:
        name = clean(part)
        name = re.sub(r"\bdoors?:.*$", "", name, flags=re.I).strip()
        name = re.sub(r"\bshow:.*$", "", name, flags=re.I).strip()
        if name and len(name) >= 2:
            names.append(name)
    return names[:8]


def infer_active_live_music(row: dict[str, str]) -> str:
    status = norm(row.get("Status"))
    if "booked" in status or "played" in status or "open microphone" in status:
        return "yes"
    if "no music" in status or "closed" in status or "told no" in status:
        return "no"
    counts = [
        clean(row.get("Past Gig Count")),
        clean(row.get("Future Gig Count")),
        clean(row.get("Total Gig Count")),
        clean(row.get("Past Gigs")),
        clean(row.get("Future Gigs")),
    ]
    return "yes" if any(value and value != "0" for value in counts) else "unknown"


def build_venues(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], dict[str, str], dict[str, str]]:
    venues: list[dict[str, str]] = []
    by_name: dict[str, str] = {}
    display_by_id: dict[str, str] = {}
    for row in rows:
        name = clean(row.get("Place Name"))
        place_id = clean(row.get("Place ID")) or make_id("venue", name, row.get("Address"), row.get("City"))
        venue = {
            "venue_id": place_id,
            "place_name": name,
            "address": clean(row.get("Address")),
            "city": clean(row.get("City")),
            "zip": clean(row.get("Zip")),
            "state": clean(row.get("State")) or "OH",
            "longitude": clean(row.get("Longitude")),
            "latitude": clean(row.get("Latitude")),
            "crm_status": clean(row.get("Status")),
            "last_contacted": clean(row.get("Last Contacted")),
            "contact_name": clean(row.get("Contact Name")),
            "email_contact": clean(row.get("Email/Contact")),
            "phone_number": clean(row.get("Phone Number")),
            "booking_contact": clean(row.get("Booking Contact")),
            "contact_type": clean(row.get("Contact Type")),
            "priority": clean(row.get("Priority")),
            "next_follow_up": clean(row.get("Next Follow Up")),
            "venue_type": clean(row.get("Venue Type")),
            "website": clean(row.get("Website")),
            "active_live_music": infer_active_live_music(row),
            "past_gig_count": clean(row.get("Past Gig Count")),
            "future_gig_count": clean(row.get("Future Gig Count")),
            "total_gig_count": clean(row.get("Total Gig Count")),
            "source": "master_sheet_sheet1",
            "source_place_id": place_id,
            "last_synced": clean(row.get("Last Synced")),
            "notes": clean(row.get("Notes")),
        }
        venues.append(venue)
        if name:
            by_name[norm(name)] = place_id
        display_by_id[place_id] = name
    return venues, by_name, display_by_id


@dataclass
class WorkbookSeeds:
    artists: dict[str, dict[str, object]]
    events: dict[str, dict[str, object]]
    event_artists: dict[str, dict[str, object]]
    raw_scrape: list[dict[str, object]]
    review_queue: dict[str, dict[str, object]]


def get_artist(artists: dict[str, dict[str, object]], name: str, source: str, artist_type: str = "unknown") -> str:
    canonical = clean(name)
    key = norm(canonical)
    if not canonical:
        canonical = "Unknown Artist"
        key = "unknown artist"
    artist_id = make_id("artist", key)
    existing = artists.get(artist_id)
    if existing:
        if existing.get("artist_type") == "unknown" and artist_type != "unknown":
            existing["artist_type"] = artist_type
        return artist_id
    artists[artist_id] = {
        "artist_id": artist_id,
        "canonical_name": canonical,
        "artist_type": artist_type,
        "home_city": "",
        "home_state": "OH",
        "genres": "",
        "website": "",
        "socials": "",
        "booking_email": "",
        "phone": "",
        "first_seen": "",
        "last_seen": "",
        "times_seen": 0,
        "source": source,
        "confidence": "seed" if artist_type != "unknown" else "needs_review",
        "notes": "",
    }
    return artist_id


def add_review(
    review_queue: dict[str, dict[str, object]],
    review_type: str,
    priority: str,
    related_id: str,
    reason: str,
    suggested_action: str,
    **fields: object,
) -> None:
    review_id = make_id("review", review_type, related_id, reason)
    review_queue[review_id] = {
        "review_id": review_id,
        "review_type": review_type,
        "priority": priority,
        "status": "needs_review",
        "related_id": related_id,
        "venue_name": fields.get("venue_name", ""),
        "artist_name": fields.get("artist_name", ""),
        "event_title": fields.get("event_title", ""),
        "event_date": fields.get("event_date", ""),
        "source": fields.get("source", ""),
        "source_url": fields.get("source_url", ""),
        "reason": reason,
        "suggested_action": suggested_action,
        "notes": fields.get("notes", ""),
    }


def add_event(
    seeds: WorkbookSeeds,
    venue_by_name: dict[str, str],
    event_date: str,
    start_time: str,
    end_time: str,
    title: str,
    venue_name: str,
    city: str,
    state: str,
    source: str,
    source_record_id: str,
    source_url: str,
    description: str,
    ticket_info: str = "",
    image_urls: str = "",
    scraped_at: str = "",
    artist_names: Iterable[str] = (),
    default_artist: str = "",
    confidence: str = "seed",
    status: str = "new",
) -> str:
    venue_id = venue_by_name.get(norm(venue_name), "")
    dedupe_key = "|".join([norm(event_date), norm(start_time), norm(venue_name), norm(title)])
    event_id = make_id("event", dedupe_key or source_record_id or source_url or title)
    seeds.events[event_id] = {
        "event_id": event_id,
        "event_date": event_date,
        "start_time": start_time,
        "end_time": end_time,
        "title": title,
        "venue_id": venue_id,
        "venue_name_snapshot": venue_name,
        "city": city,
        "state": state or "OH",
        "source": source,
        "source_record_id": source_record_id,
        "source_url": source_url,
        "status": status,
        "confidence": confidence,
        "description": description,
        "ticket_info": ticket_info,
        "image_urls": image_urls,
        "scraped_at": scraped_at,
        "dedupe_key": dedupe_key,
        "notes": "",
    }
    names = list(artist_names) or ([default_artist] if default_artist else [])
    for index, artist_name in enumerate(names, start=1):
        artist_id = get_artist(seeds.artists, artist_name, source)
        event_artist_id = make_id("eventartist", event_id, artist_id)
        seeds.event_artists[event_artist_id] = {
            "event_artist_id": event_artist_id,
            "event_id": event_id,
            "artist_id": artist_id,
            "artist_name_snapshot": artist_name,
            "artist_type_at_event": seeds.artists[artist_id].get("artist_type", "unknown"),
            "billing_order": index,
            "role": "headliner" if index == 1 else "support",
            "confidence": confidence,
            "source": source,
        }
        if seeds.artists[artist_id].get("artist_type") == "unknown":
            add_review(
                seeds.review_queue,
                "artist_type",
                "medium",
                artist_id,
                "Artist type is unknown.",
                "Set artist_type to solo, duo, band, DJ, open_mic_host, tribute, or other.",
                artist_name=artist_name,
                event_title=title,
                event_date=event_date,
                source=source,
                source_url=source_url,
            )
    if venue_name and not venue_id:
        add_review(
            seeds.review_queue,
            "venue_match",
            "high",
            event_id,
            "Event venue did not match a master venue row.",
            "Match to an existing venue_id or add this as a new venue.",
            venue_name=venue_name,
            event_title=title,
            event_date=event_date,
            source=source,
            source_url=source_url,
        )
    return event_id


def seed_events(venue_by_name: dict[str, str]) -> WorkbookSeeds:
    now = datetime.now().isoformat(timespec="seconds")
    seeds = WorkbookSeeds(artists={}, events={}, event_artists={}, raw_scrape=[], review_queue={})
    jddm_artist_id = get_artist(seeds.artists, "Just Dee Dee Music", "internal", artist_type="solo")
    seeds.artists[jddm_artist_id]["notes"] = "Primary Just Dee Dee Music performance identity."

    for row in read_csv(DEFAULT_CALENDAR_GIGS_CSV):
        if clean(row.get("isPrivateEvent")).lower() == "true":
            continue
        venue_name = clean(row.get("venueName"))
        title = clean(row.get("summary")) or f"Just Dee Dee Music at {venue_name or 'Unknown Venue'}"
        add_event(
            seeds,
            venue_by_name,
            clean(row.get("eventDate")),
            clean(row.get("eventTime")),
            clean(row.get("eventEndTime")),
            title,
            venue_name,
            "",
            "OH",
            "jddm_calendar",
            clean(row.get("calendarEventId")),
            clean(row.get("sourceUrl")),
            clean(row.get("location")),
            default_artist="Just Dee Dee Music",
            confidence="calendar_export",
            status=clean(row.get("status")) or "new",
        )

    for row in read_csv(DEFAULT_WEBSITE_HISTORY_CSV):
        if clean(row.get("isPrivateEvent")).lower() == "true":
            continue
        venue_name = clean(row.get("venueName"))
        title = clean(row.get("title")) or f"Just Dee Dee Music at {venue_name or 'Unknown Venue'}"
        add_event(
            seeds,
            venue_by_name,
            clean(row.get("eventDate")),
            clean(row.get("eventTime")),
            clean(row.get("eventEndTime")),
            title,
            venue_name,
            clean(row.get("city")),
            clean(row.get("state")) or "OH",
            "jddm_website_history",
            clean(row.get("eventId")),
            clean(row.get("sourceUrls")),
            clean(row.get("notes")),
            default_artist="Just Dee Dee Music",
            confidence="website_history",
            status="needs_confirmation" if clean(row.get("isPublicPlaceholder")).lower() == "true" else "new",
        )

    scraper_rows = read_csv(DEFAULT_SCRAPER_CSV)
    if not scraper_rows and DEFAULT_SCRAPER_DB.exists():
        scraper_rows = read_scraper_db(DEFAULT_SCRAPER_DB)
    for row in scraper_rows:
        raw_id = make_id("raw", row.get("url"), row.get("title"), row.get("scraped_at"))
        seeds.raw_scrape.append({"raw_id": raw_id, **{header: clean(row.get(header)) for header in RAW_HEADERS if header != "raw_id"}})
        artist_names = split_artists(clean(row.get("bands")) or clean(row.get("title")))
        add_event(
            seeds,
            venue_by_name,
            clean(row.get("event_date")),
            clean(row.get("event_time")),
            "",
            clean(row.get("title")),
            clean(row.get("venue")),
            clean(row.get("city")),
            "OH",
            clean(row.get("source")) or "scraper",
            raw_id,
            clean(row.get("url")),
            clean(row.get("description")),
            ticket_info=clean(row.get("ticket_info")),
            image_urls=clean(row.get("image_urls")),
            scraped_at=clean(row.get("scraped_at")) or now,
            artist_names=artist_names,
            confidence="scraped",
            status="needs_review",
        )

    update_artist_seen_stats(seeds)
    return seeds


def read_scraper_db(path: Path) -> list[dict[str, str]]:
    try:
        connection = sqlite3.connect(path)
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT source, query_used, title, url, event_date, event_time, venue,
                   address, city, bands, ticket_info, description, image_urls,
                   scraped_at, raw_snippet, location_match, distance_miles,
                   relevance_score
            FROM events
            ORDER BY scraped_at DESC
            LIMIT 500
            """
        ).fetchall()
        connection.close()
        return [dict(row) for row in rows]
    except sqlite3.Error:
        return []


def update_artist_seen_stats(seeds: WorkbookSeeds) -> None:
    dates_by_artist: dict[str, list[str]] = defaultdict(list)
    for event_artist in seeds.event_artists.values():
        event = seeds.events.get(clean(event_artist.get("event_id")))
        if not event:
            continue
        date = clean(event.get("event_date"))
        if date:
            dates_by_artist[clean(event_artist.get("artist_id"))].append(date)
    for artist_id, dates in dates_by_artist.items():
        artist = seeds.artists.get(artist_id)
        if not artist:
            continue
        ordered = sorted(dates)
        artist["first_seen"] = ordered[0]
        artist["last_seen"] = ordered[-1]
        artist["times_seen"] = len(dates)


def build_history(
    venues: list[dict[str, str]],
    artists: dict[str, dict[str, object]],
    events: dict[str, dict[str, object]],
    event_artists: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    venue_name_by_id = {row["venue_id"]: row["place_name"] for row in venues}
    stats: dict[tuple[str, str], dict[str, object]] = {}
    for event_artist in event_artists.values():
        event_id = clean(event_artist.get("event_id"))
        event = events.get(event_id)
        if not event or not clean(event.get("venue_id")):
            continue
        venue_id = clean(event.get("venue_id"))
        artist_id = clean(event_artist.get("artist_id"))
        key = (venue_id, artist_id)
        date = clean(event.get("event_date"))
        record = stats.setdefault(
            key,
            {
                "venue_id": venue_id,
                "venue_name": venue_name_by_id.get(venue_id, clean(event.get("venue_name_snapshot"))),
                "artist_id": artist_id,
                "artist_name": clean((artists.get(artist_id) or {}).get("canonical_name")),
                "times_played": 0,
                "first_seen": date,
                "last_seen": date,
                "last_event_id": event_id,
                "last_source_url": clean(event.get("source_url")),
            },
        )
        record["times_played"] = int(record["times_played"]) + 1
        if date and (not clean(record.get("first_seen")) or date < clean(record.get("first_seen"))):
            record["first_seen"] = date
        if date and (not clean(record.get("last_seen")) or date >= clean(record.get("last_seen"))):
            record["last_seen"] = date
            record["last_event_id"] = event_id
            record["last_source_url"] = clean(event.get("source_url"))
    return sorted(stats.values(), key=lambda row: (clean(row.get("venue_name")), clean(row.get("artist_name"))))


def build_readme_rows(counts: dict[str, int]) -> list[list[object]]:
    return [
        ["Just Dee Dee Music Ohio Music Intel Database", ""],
        ["Purpose", "Track Ohio venues, artists, gigs, repeat performers, and raw scrape evidence without creating one tab per artist or venue."],
        ["Best practice", "Use Venues, Artists, Events, and Event_Artists as the source tables. Use filters/pivots for views like a single artist or single venue."],
        ["Seeded venues", counts.get("venues", 0)],
        ["Seeded artists", counts.get("artists", 0)],
        ["Seeded events", counts.get("events", 0)],
        ["Seeded event-artist links", counts.get("event_artists", 0)],
        ["Review queue items", counts.get("review_queue", 0)],
        ["How this scales", "A venue with music three nights a week creates three event rows. A four-band bill creates one event row and four Event_Artists rows. Returning artists naturally show up in Venue_Artist_History."],
        ["Artist type values", "solo, duo, band, DJ, open_mic_host, tribute, other, unknown"],
        ["Event status values", "new, needs_review, needs_confirmation, reviewed, confirmed, duplicate, ignore, completed"],
        ["Deduping", "Prefer URL first, then event_date + start_time + venue_id/name + normalized title."],
    ]


def build_lookup_rows() -> list[list[object]]:
    return [
        ["lookup_type", "value", "meaning"],
        ["artist_type", "solo", "One primary performer"],
        ["artist_type", "duo", "Two-person act"],
        ["artist_type", "band", "Group act"],
        ["artist_type", "DJ", "DJ or electronic act"],
        ["artist_type", "open_mic_host", "Host/recurring open mic identity"],
        ["artist_type", "tribute", "Tribute or cover concept"],
        ["artist_type", "other", "Use when the standard types do not fit"],
        ["artist_type", "unknown", "Needs review"],
        ["event_status", "new", "Fresh record from a source"],
        ["event_status", "needs_review", "Needs human confirmation"],
        ["event_status", "needs_confirmation", "Likely event but venue/date details may be incomplete"],
        ["event_status", "reviewed", "Human reviewed"],
        ["event_status", "confirmed", "Confirmed active gig"],
        ["event_status", "duplicate", "Duplicate of another event"],
        ["event_status", "ignore", "Not relevant"],
        ["event_status", "completed", "Past completed gig"],
        ["review_type", "venue_match", "Event venue needs matching to master venue"],
        ["review_type", "artist_type", "Artist needs solo/band/etc classification"],
        ["review_type", "duplicate", "Potential duplicate event or artist"],
    ]


def ordered_rows(headers: list[str], rows: Iterable[dict[str, object]]) -> list[list[object]]:
    return [[row.get(header, "") for header in headers] for row in rows]


def col_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def cell_ref(row: int, col: int) -> str:
    return f"{col_name(col)}{row}"


def xml_text(value: object) -> str:
    return escape(clean(value), {"\n": "&#10;", "\r": "&#13;"})


def sheet_xml(rows: list[list[object]], widths: list[int] | None = None, autofilter: bool = True) -> str:
    row_count = len(rows)
    col_count = max((len(row) for row in rows), default=1)
    dimension = f"A1:{cell_ref(max(row_count, 1), max(col_count, 1))}"
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        f'<dimension ref="{dimension}"/>',
        "<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/><selection pane=\"bottomLeft\" activeCell=\"A2\" sqref=\"A2\"/></sheetView></sheetViews>",
        "<sheetFormatPr defaultRowHeight=\"15\"/>",
    ]
    if widths:
        parts.append("<cols>")
        for idx, width in enumerate(widths[:col_count], start=1):
            parts.append(f'<col min="{idx}" max="{idx}" width="{width}" customWidth="1"/>')
        parts.append("</cols>")
    parts.append("<sheetData>")
    for row_index, row in enumerate(rows, start=1):
        style = " s=\"1\"" if row_index == 1 else ""
        parts.append(f'<row r="{row_index}">')
        for col_index, value in enumerate(row, start=1):
            ref = cell_ref(row_index, col_index)
            if value is None or clean(value) == "":
                parts.append(f'<c r="{ref}"{style}/>')
            elif isinstance(value, (int, float)) and not isinstance(value, bool):
                parts.append(f'<c r="{ref}"{style}><v>{value}</v></c>')
            else:
                parts.append(f'<c r="{ref}" t="inlineStr"{style}><is><t>{xml_text(value)}</t></is></c>')
        parts.append("</row>")
    parts.append("</sheetData>")
    if autofilter and row_count > 1:
        parts.append(f'<autoFilter ref="A1:{cell_ref(row_count, col_count)}"/>')
    parts.append("</worksheet>")
    return "".join(parts)


def workbook_xml(sheet_names: list[str]) -> str:
    sheets = "".join(
        f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>'
        for index, name in enumerate(sheet_names, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{sheets}</sheets></workbook>"
    )


def workbook_rels_xml(sheet_names: list[str]) -> str:
    rels = []
    for index, _name in enumerate(sheet_names, start=1):
        rels.append(
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{index}.xml"/>'
        )
    rels.append(
        f'<Relationship Id="rId{len(sheet_names) + 1}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(rels)
        + "</Relationships>"
    )


def content_types_xml(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ]
    overrides.extend(
        f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, sheet_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        + "".join(overrides)
        + "</Types>"
    )


def root_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )


def styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Aptos\"/></font><font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Aptos\"/></font></fonts>"
        "<fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF0F5F67\"/><bgColor indexed=\"64\"/></patternFill></fill></fills>"
        "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
        "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
        "<cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/></cellXfs>"
        "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
        "</styleSheet>"
    )


def write_xlsx(path: Path, sheets: list[tuple[str, list[list[object]], list[int]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as xlsx:
        sheet_names = [name for name, _rows, _widths in sheets]
        xlsx.writestr("[Content_Types].xml", content_types_xml(len(sheets)))
        xlsx.writestr("_rels/.rels", root_rels_xml())
        xlsx.writestr("xl/workbook.xml", workbook_xml(sheet_names))
        xlsx.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml(sheet_names))
        xlsx.writestr("xl/styles.xml", styles_xml())
        for index, (_name, rows, widths) in enumerate(sheets, start=1):
            xlsx.writestr(f"xl/worksheets/sheet{index}.xml", sheet_xml(rows, widths))


def export_database(output: Path, csv_dir: Path | None = None) -> dict[str, int]:
    venue_source_rows = read_csv(DEFAULT_VENUES_CSV)
    venues, venue_by_name, _display_by_id = build_venues(venue_source_rows)
    seeds = seed_events(venue_by_name)
    history = build_history(venues, seeds.artists, seeds.events, seeds.event_artists)

    counts = {
        "venues": len(venues),
        "artists": len(seeds.artists),
        "events": len(seeds.events),
        "event_artists": len(seeds.event_artists),
        "review_queue": len(seeds.review_queue),
        "raw_scrape": len(seeds.raw_scrape),
    }

    artists_sorted = sorted(seeds.artists.values(), key=lambda row: clean(row.get("canonical_name")).lower())
    events_sorted = sorted(seeds.events.values(), key=lambda row: (clean(row.get("event_date")), clean(row.get("start_time")), clean(row.get("venue_name_snapshot"))))
    event_artists_sorted = sorted(seeds.event_artists.values(), key=lambda row: (clean(row.get("event_id")), int(row.get("billing_order") or 0)))
    reviews_sorted = sorted(seeds.review_queue.values(), key=lambda row: (clean(row.get("priority")), clean(row.get("review_type"))))

    sheets = [
        ("README", build_readme_rows(counts), [32, 120]),
        ("Venues", [VENUE_HEADERS] + ordered_rows(VENUE_HEADERS, venues), [28, 32, 34, 18, 10, 10, 14, 14, 26, 16, 22, 28, 18, 28, 18, 12, 16, 18, 28, 18, 14, 14, 14, 20, 28, 20, 44]),
        ("Artists", [ARTIST_HEADERS] + ordered_rows(ARTIST_HEADERS, artists_sorted), [32, 30, 16, 18, 12, 22, 28, 34, 28, 18, 14, 14, 12, 22, 16, 44]),
        ("Events", [EVENT_HEADERS] + ordered_rows(EVENT_HEADERS, events_sorted), [32, 14, 14, 14, 40, 32, 32, 18, 10, 22, 32, 42, 18, 18, 56, 22, 28, 20, 54, 44]),
        ("Event_Artists", [EVENT_ARTIST_HEADERS] + ordered_rows(EVENT_ARTIST_HEADERS, event_artists_sorted), [32, 32, 32, 32, 20, 14, 16, 16, 22]),
        ("Venue_Artist_History", [HISTORY_HEADERS] + ordered_rows(HISTORY_HEADERS, history), [32, 32, 32, 32, 14, 14, 14, 32, 42]),
        ("Artist_Aliases", [["alias", "artist_id", "confidence", "source", "notes"]], [30, 32, 16, 22, 44]),
        ("Venue_Aliases", [["alias", "venue_id", "confidence", "source", "notes"]], [30, 32, 16, 22, 44]),
        ("Review_Queue", [REVIEW_HEADERS] + ordered_rows(REVIEW_HEADERS, reviews_sorted), [32, 18, 12, 18, 32, 30, 30, 40, 14, 22, 42, 42, 52, 44]),
        ("Raw_Scrape_Log", [RAW_HEADERS] + ordered_rows(RAW_HEADERS, seeds.raw_scrape), [32, 22, 34, 42, 42, 14, 14, 30, 36, 18, 34, 22, 58, 28, 20, 58, 18, 14, 14]),
        ("Lookups", build_lookup_rows(), [18, 24, 76]),
    ]

    write_xlsx(output, sheets)

    if csv_dir:
        write_csv(csv_dir / "venues.csv", VENUE_HEADERS, venues)
        write_csv(csv_dir / "artists.csv", ARTIST_HEADERS, artists_sorted)
        write_csv(csv_dir / "events.csv", EVENT_HEADERS, events_sorted)
        write_csv(csv_dir / "event_artists.csv", EVENT_ARTIST_HEADERS, event_artists_sorted)
        write_csv(csv_dir / "venue_artist_history.csv", HISTORY_HEADERS, history)
        write_csv(csv_dir / "review_queue.csv", REVIEW_HEADERS, reviews_sorted)
        write_csv(csv_dir / "raw_scrape_log.csv", RAW_HEADERS, seeds.raw_scrape)

    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Ohio music intelligence database workbook.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output .xlsx path.")
    parser.add_argument("--csv-dir", type=Path, default=None, help="Optional folder for tab-level CSV exports.")
    parser.add_argument("--summary-json", type=Path, default=None, help="Optional JSON summary output path.")
    args = parser.parse_args()

    counts = export_database(args.output, args.csv_dir)
    summary = {"output": str(args.output), **counts}
    if args.summary_json:
        args.summary_json.parent.mkdir(parents=True, exist_ok=True)
        args.summary_json.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
