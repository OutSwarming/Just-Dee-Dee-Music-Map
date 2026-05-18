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
import difflib
import hashlib
import html
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
DEFAULT_APP_URL = "https://outswarming.github.io/Just-Dee-Dee-Music-Map/"
DEFAULT_TEXT_RECIPIENTS = ["+14403054062", "+12168499292"]
SERVICE_PRIORITY = ["iMessage", "SMS"]

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


STREET_SUFFIX_PATTERN = r"(?:st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|cir|circle|pkwy|parkway|hwy|highway|way|pl|place)"
STREET_ADDRESS_RE = re.compile(
    rf"\b\d{{1,6}}\s+[a-z0-9 .'-]+?\s+{STREET_SUFFIX_PATTERN}\.?(?:\s+(?:NE|NW|SE|SW|N|S|E|W))?\b",
    re.IGNORECASE,
)
VENUE_GENERIC_WORDS_RE = re.compile(
    r"\b(?:the|of|richfield|cleveland|akron|oh|ohio|tavern|taverne|bar|pub|grill|grille|restaurant|brewery|brewing|winery|cafe|coffee|music|venue)\b",
    re.IGNORECASE,
)
SCRAPER_VENUE_SOURCES = {"artist_site_sync", "furious_george_website"}
NON_VENUE_NAMES = {
    "jddm holiday tour",
    "jddm summer tour",
    "private event",
    "scheduled public event",
    "jddm 2026 scheduled public event",
    "north olmsted",
    "olmsted falls",
}
KNOWN_VENUE_ALIASES = {
    "blue heron": "blue-heron-brewery-and-event-center-medina-oh-44256",
    "blue turtle": "blue-turtle-tavern-north-olmsted-oh-44070",
    "bait house brewery": "bait-house-brewery-223-meigs-st-sandusky-oh-44870",
    "ballentine": "ballantine-willoughby-oh-44094",
    "beachland ballroom": "beachland-ballroom-cleveland-oh-44110",
    "beachland tavern": "beachland-ballroom-cleveland-oh-44110",
    "beau grille": "beau-s-grille-akron-oh-44333",
    "beaus grille": "beau-s-grille-akron-oh-44333",
    "blu tique hotel": "blu-tique-hotel-akron-oh-44308",
    "brighten brewing": "brighten-brewing-company-copley-oh-44321",
    "brewster": "brewsters-cafe-bistro-pub-twinsburg-oh-44087",
    "caddyshack": "the-caddy-shack-115-division-st-kelleys-island-oh-43438",
    "caddy shack": "the-caddy-shack-115-division-st-kelleys-island-oh-43438",
    "collision bend": "collision-bend-brewing-1261-babbitt-road-oh",
    "collision bend in east bank flat": "collision-bend-brewing-company-1250-old-river-road-cleveland-oh-44113",
    "crafted artisan meadery": "crafted-artisan-meadery-mogadore-oh-44260",
    "crocker park in park": "crocker-park-177-market-st-westlake-oh-44145",
    "dean martin lanning restaurant": "dean-martin-s-lanning-s-restaurant-akron-oh-44333",
    "esp brewing": "esp-brewing-united-states-oh",
    "divot": "divot-s-sports-bar-13393-york-rd-north-royalton-oh-44133",
    "fairview": "the-fairview-tavern-cleveland-oh-44126",
    "galaxy": "galaxy-restaurant-wadsworth-oh-44281",
    "gervasi vineyard": "gervasi-vineyard-1700-55th-st-ne-canton-oh-44721",
    "gideon owen winery": "gideon-owen-port-clinton-oh-43452",
    "grab n go": "grab-n-go-beverage-drivethru-and-pub-236-n-state-rd-medina-oh-44256",
    "glenwillow grille": "glenwillow-grille-29765-pettibone-rd-solon-oh-44139",
    "house of blues cleveland": "venue-house-of-blues-cleveland-ad9bdfdb",
    "jenks building": "the-jenks-building-1884-front-st-cuyahoga-falls-oh-44221",
    "la las": "la-la-s-in-the-lakes-akron-oh-44319",
    "la la in lake": "lala-s-in-the-lakes-akron-oh",
    "lala in lake": "lala-s-in-the-lakes-akron-oh",
    "lannings": "dean-martin-s-lanning-s-restaurant-akron-oh-44333",
    "loby": "lobys-irish-pub-and-grill-canton-oh-44708",
    "jimmy bukketts": "jimmy-bukkett-s-fremont-oh-43420",
    "medina brewing company": "medina-brewing-company-320-s-court-st-g9-medina-oh-44256",
    "olesia taverne": "olesias-tavern-3960-broadview-rd-richfield-oh-44286",
    "on tap": "on-tap-medina-medina-oh-44256",
    "panini brunswick": "paninis-grill-3520-center-rd-brunswick-oh-44212",
    "pipe creek warf": "pipe-creek-wharf-sandusky-oh-44870",
    "pipe creek wharf": "pipe-creek-wharf-sandusky-oh-44870",
    "runinmuck": "camp-runinmuck-lakeside-marblehead-oh-43440",
    "sarah vineyard": "sarah-s-vineyard-cuyahoga-falls-oh-44223",
    "seeing double": "seeing-double-speakeasy-bar-north-olmsted-oh-44070",
    "secret at center": "secret-of-center-3511-center-road-oh-oh",
    "sharon james cellars": "sharon-james-cellars-11303-kinsman-rd-newbury-oh-44065",
    "speak of the devil": "speak-of-the-devil-cocktail-bar-lorain-oh-44052",
    "square 22": "square-22-restaurant-and-bar-strongsville-oh-44136",
    "local strongsville": "the-local-bar-strongsville-oh-44136",
    "the basement": "the-basement-sports-bar-and-grill-cuyahoga-falls-oh-44221",
    "the keys": "the-keys-put-in-bay-put-in-bay-oh-43456",
    "the pint pie work": "the-pint-and-pie-works-bath-oh",
    "pint pie work": "the-pint-and-pie-works-bath-oh",
    "twin oast": "twin-oast-brewing-port-clinton-oh-43452",
    "trivs": "trivs-strongsville-oh-44136",
    "waters edge": "waters-edge-tiki-bar-and-grill-lakeside-marblehead-oh-43440",
    "west main st winery": "west-main-st-winery-and-brewery-ravenna-oh-44266",
    "wolf creek tavern": "wolf-creek-tavern-norton-oh-44203",
    "wolfcreek tavern": "wolf-creek-tavern-norton-oh-44203",
    "wine room": "the-wine-room-avon-avon-oh-44011",
}
KNOWN_VENUE_CITY_ALIASES = {
    ("leo italian social", "cuyahoga falls"): "leo-s-italian-social-burntwood-holdings-2251-front-st-cuyahoga-falls-oh-44221",
    ("leo italian social", "westlake"): "leo-s-italian-social-burntwood-holdings-200-crocker-park-blvd-westlake-oh-44145",
    ("peninsula wine cellar", "peninsula"): "peninsula-coffee-house-and-market-peninsula-oh-44264",
    ("visible voice", "cleveland"): "venue-visible-voice-books-23046200",
}
KNOWN_NEW_VENUE_DETAILS = {
    "berea fairground": {
        "place_name": "Cuyahoga County Fairgrounds",
        "address": "19201 E Bagley Rd",
        "city": "Middleburg Heights",
        "zip": "44130",
        "venue_type": "Fairground",
        "phone_number": "440-243-0090",
        "website": "https://cuyfair.com/",
    },
    "solid gold lounge": {
        "place_name": "Solid Gold Lounge",
        "address": "15005 Snow Rd",
        "city": "Brook Park",
        "zip": "44142",
        "venue_type": "Pub/Bar",
        "phone_number": "216-267-3909",
    },
    "strike out lane": {
        "place_name": "Strike Out Lanes",
        "address": "48324 OH-18",
        "city": "Wellington",
        "zip": "44090",
        "venue_type": "Bowling Alley",
        "phone_number": "440-647-2268",
        "website": "https://strikeoutlanes.com/",
    },
    "strossmayer croatian picnic ground": {
        "place_name": "Strossmayer Croatian Picnic Grounds",
        "address": "4202 Smith-Stewart Rd",
        "city": "Vienna",
        "zip": "44473",
        "venue_type": "Event Venue",
    },
    "jolly scholar": {
        "place_name": "The Jolly Scholar",
        "address": "11111 Euclid Ave",
        "city": "Cleveland",
        "zip": "44106",
        "venue_type": "Brewpub",
        "phone_number": "216-368-0090",
        "website": "https://thejollyscholar.com/",
    },
    "blossom center vip club": {
        "place_name": "Blossom Music Center VIP Club",
        "address": "1145 W Steels Corners Rd",
        "city": "Cuyahoga Falls",
        "zip": "44223",
        "venue_type": "Live Music Venue",
        "phone_number": "330-920-8040",
        "website": "https://www.blossommusic.com/",
    },
    "copper top": {
        "place_name": "Coppertop at Cherokee Hills",
        "address": "5740 Center Rd",
        "city": "Valley City",
        "zip": "44280",
        "venue_type": "Event Venue",
        "phone_number": "330-225-6122",
        "website": "https://www.coppertopgolf.com/",
    },
    "john s knight center": {
        "place_name": "John S. Knight Center",
        "address": "77 E Mill St",
        "city": "Akron",
        "zip": "44308",
        "venue_type": "Event Venue",
        "phone_number": "330-374-8900",
    },
    "julia 1902 house": {
        "place_name": "Julia's 1902 House",
        "address": "37819 Euclid Ave",
        "city": "Willoughby",
        "zip": "44094",
        "venue_type": "Restaurant",
        "phone_number": "440-306-8332",
        "website": "https://www.julias1902.com/",
    },
    "ottawa county fairground": {
        "place_name": "Ottawa County Fairgrounds",
        "address": "7870 W State Route 163",
        "city": "Oak Harbor",
        "zip": "43449",
        "venue_type": "Fairground",
        "website": "https://www.ottawacountyfair.org/",
    },
    "st ladisla": {
        "place_name": "St. Ladislas",
        "address": "2345 Bassett Rd",
        "city": "Westlake",
        "zip": "44145",
        "venue_type": "Church",
        "website": "https://stladislas.org/",
    },
    "turkeyfoot island club": {
        "place_name": "Turkeyfoot Island Club",
        "address": "4528 Lahm Dr",
        "city": "Akron",
        "zip": "44319",
        "venue_type": "Event Venue",
        "phone_number": "330-644-7797",
        "website": "https://www.turkeyfootislandclub.com/",
    },
    "beau bar bistro": {
        "place_name": "Beau's Bar & Bistro",
        "address": "1275 S Cleveland Massillon Rd",
        "city": "Copley",
        "zip": "44321",
        "venue_type": "Restaurant",
        "phone_number": "234-466-7720",
        "website": "https://beausbarandbistro.com/",
    },
    "beachland ballroom": {
        "place_name": "Beachland Ballroom & Tavern",
        "address": "15711 Waterloo Rd",
        "city": "Cleveland",
        "zip": "44110",
        "venue_type": "Live Music Venue",
        "phone_number": "216-383-1124",
        "website": "https://www.beachlandballroom.com/",
    },
    "beachland tavern": {
        "place_name": "Beachland Ballroom & Tavern",
        "address": "15711 Waterloo Rd",
        "city": "Cleveland",
        "zip": "44110",
        "venue_type": "Live Music Venue",
        "phone_number": "216-383-1124",
        "website": "https://www.beachlandballroom.com/",
    },
    "bop stop": {
        "place_name": "BOP STOP at The Music Settlement",
        "address": "2920 Detroit Ave",
        "city": "Cleveland",
        "zip": "44113",
        "venue_type": "Live Music Venue",
        "phone_number": "216-771-6551",
        "website": "https://www.themusicsettlement.org/bop-stop/",
    },
    "chagrin lagoons yacht club": {
        "place_name": "Chagrin Lagoons Yacht Club",
        "address": "35111 Halsey Dr",
        "city": "Eastlake",
        "zip": "44095",
        "venue_type": "Yacht Club",
        "phone_number": "440-942-0299",
        "website": "https://www.clycohio.com/",
    },
    "federated church family life center": {
        "place_name": "Federated Church Family Life Center",
        "address": "76 Bell St",
        "city": "Chagrin Falls",
        "zip": "44022",
        "venue_type": "Event Venue",
        "phone_number": "440-247-6490",
        "website": "https://fedchurch.org/pas/",
    },
    "gar hall": {
        "place_name": "G.A.R. Hall",
        "address": "1785 Main St",
        "city": "Peninsula",
        "zip": "44264",
        "venue_type": "Event Venue",
    },
    "hester holbrook hollows": {
        "place_name": "Hester Holbrook Hollows",
        "address": "7250 Country Ln",
        "city": "Chagrin Falls",
        "zip": "44023",
        "venue_type": "Park/Event Venue",
        "phone_number": "440-286-9516",
        "website": "https://www.geaugaparkdistrict.org/park/holbrook-hollows/",
    },
    "kent blues fest": {
        "place_name": "Kent Blues Fest",
        "city": "Kent",
        "zip": "44240",
        "venue_type": "Festival",
        "website": "https://www.kentbluesfest.com/",
    },
    "music box supper club": {
        "place_name": "Music Box Supper Club",
        "address": "1148 Main Ave",
        "city": "Cleveland",
        "zip": "44113",
        "venue_type": "Live Music Venue",
        "phone_number": "216-242-1250",
        "website": "https://musicboxcle.com/",
    },
    "peninsula wine cellar": {
        "place_name": "Peninsula Wine Cellar",
        "address": "1653 Main St",
        "city": "Peninsula",
        "zip": "44264",
        "venue_type": "Wine Bar",
        "phone_number": "330-242-2661",
        "website": "https://peninsulacoffeehouse.com/wine-cellar/",
    },
    "regency wine seller": {
        "place_name": "Regency Wine Sellers",
        "address": "115 Ghent Rd",
        "city": "Fairlawn",
        "zip": "44333",
        "venue_type": "Wine Bar",
        "phone_number": "330-836-3447",
        "website": "https://www.regencywinesellers.com/",
    },
    "visible voice books": {
        "place_name": "Visible Voice Books",
        "address": "4601 Lorain Ave",
        "city": "Cleveland",
        "zip": "44102",
        "venue_type": "Bookstore",
        "website": "https://www.visiblevoicebooks.com/",
    },
}


def slug(value: object, fallback: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", clean(value).lower()).strip("-")
    return result or fallback


def short_hash(*parts: object, length: int = 8) -> str:
    return hashlib.sha1("|".join(clean(part) for part in parts).encode("utf-8")).hexdigest()[:length]


def make_id(prefix: str, *parts: object) -> str:
    readable = slug(parts[0] if parts else "", prefix)[:44].rstrip("-") or prefix
    return f"{prefix}-{readable}-{short_hash(*parts)}"


def extract_street_address(value: object) -> str:
    for match in STREET_ADDRESS_RE.finditer(clean(value)):
        candidate = match.group(0)
        if re.search(r"\b\d+\s+years?\b", candidate, re.I):
            continue
        return norm(candidate)
    return ""


def extract_display_street_address(value: object) -> str:
    for match in STREET_ADDRESS_RE.finditer(clean(value)):
        candidate = clean(match.group(0))
        if re.search(r"\b\d+\s+years?\b", candidate, re.I):
            continue
        return candidate
    return ""


def row_text(row: dict[str, str], *keys: str) -> str:
    return " ".join(clean(row.get(key)) for key in keys if clean(row.get(key)))


def venue_city_tokens(*parts: object) -> set[str]:
    tokens = set(norm(" ".join(clean(part) for part in parts)).split())
    stopwords = {"oh", "ohio", "north", "south", "east", "west", "main", "st", "street", "rd", "road", "ave", "avenue"}
    return {token for token in tokens if token and token not in stopwords and not token.isdigit()}


def venue_zip_tokens(*parts: object) -> set[str]:
    return set(re.findall(r"\b\d{5}\b", " ".join(clean(part) for part in parts)))


def canonical_venue_name(value: object) -> str:
    text = clean(value).replace("’", "'").lower()
    text = re.sub(r"\b(\w+)'s\b", r"\1", text)
    text = STREET_ADDRESS_RE.sub(" ", text)
    text = VENUE_GENERIC_WORDS_RE.sub(" ", text)
    tokens = []
    for token in norm(text).split():
        if len(token) > 4 and token.endswith("s"):
            token = token[:-1]
        tokens.append(token)
    return " ".join(tokens)


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


def normalize_phone(value: object) -> str:
    text = clean(value)
    if not text:
        return ""
    if text.startswith("+"):
        digits = re.sub(r"\D+", "", text[1:])
        return f"+{digits}"
    digits = re.sub(r"\D+", "", text)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return digits


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


class GspbTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_text = False
        self.depth = 0
        self.current_text: list[str] = []
        self.current_first_link = ""
        self.current_first_href = ""
        self.in_link = False
        self.link_text: list[str] = []
        self.blocks: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        class_name = attr.get("class") or ""
        if tag == "div" and "gspb_text" in class_name and not self.in_text:
            self.in_text = True
            self.depth = 1
            self.current_text = []
            self.current_first_link = ""
            self.current_first_href = ""
            return
        if not self.in_text:
            return
        if tag == "div":
            self.depth += 1
        if tag == "a":
            self.in_link = True
            self.link_text = []
            if not self.current_first_href:
                self.current_first_href = attr.get("href") or ""
        if tag in {"br", "p"}:
            self.current_text.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if not self.in_text:
            return
        if tag == "a":
            if not self.current_first_link:
                self.current_first_link = clean("".join(self.link_text))
            self.in_link = False
        if tag == "div":
            self.depth -= 1
            if self.depth <= 0:
                text = clean("".join(self.current_text))
                if text:
                    self.blocks.append(
                        {
                            "text": text,
                            "first_link": self.current_first_link,
                            "first_href": self.current_first_href,
                        }
                    )
                self.in_text = False

    def handle_data(self, data: str) -> None:
        if self.in_text:
            self.current_text.append(data)
            if self.in_link:
                self.link_text.append(data)


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag in {"br", "p", "div", "li", "tr", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.skip_depth:
            self.skip_depth -= 1
            return
        if not self.skip_depth and tag in {"p", "div", "li", "tr", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)

    def lines(self) -> list[str]:
        text = re.sub(r"\n\s*\n+", "\n", "".join(self.parts))
        return [clean(line) for line in text.splitlines() if clean(line)]


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
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        if exc.code != 406:
            raise
    result = subprocess.run(
        [
            "curl",
            "-L",
            "-s",
            "-A",
            headers["User-Agent"],
            "-H",
            f"Accept: {headers['Accept']}",
            "-H",
            f"Accept-Language: {headers['Accept-Language']}",
            url,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=45,
    )
    return result.stdout


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


def strip_html(value: str) -> str:
    return clean(re.sub(r"<[^>]+>", " ", html.unescape(value)))


def parse_bandzoogle_card_date(text: str, default_year: int, past_page: bool, last_month: int = 0) -> tuple[str, int] | None:
    match = re.match(r"^(?:[A-Za-z]{3,9}),\s+([A-Za-z]+)\s+(\d{1,2})$", clean(text))
    if not match:
        return None
    month_name, day = match.groups()
    try:
        month_number = datetime.strptime(month_name, "%B").month
    except ValueError:
        return None
    if past_page and month_number > date.today().month:
        year = default_year - 1
    else:
        year = default_year + (1 if last_month >= 11 and month_number < last_month else 0)
    return date(year, month_number, int(day)).isoformat(), month_number


def parse_bandzoogle_city_zip(value: str) -> tuple[str, str]:
    text = clean(value)
    zip_match = re.search(r"\b(\d{5})\b", text)
    zip_code = zip_match.group(1) if zip_match else ""
    city = re.sub(r"\b(?:OH|Ohio)\b", " ", text, flags=re.IGNORECASE)
    city = re.sub(r"\b\d{5}\b", " ", city)
    return clean(city.strip(" ,")), zip_code


def parse_bandzoogle_location(location_text: str) -> tuple[str, str, str, str]:
    parts = [clean(part) for part in location_text.split(",") if clean(part)]
    if not parts:
        return "", "", "", ""
    venue = parts[0]
    address = ""
    city = ""
    zip_code = ""
    if len(parts) >= 4 and extract_street_address(parts[1]):
        address = parts[1]
        city = parts[2]
        state_zip = parts[3]
    elif len(parts) >= 3:
        city = parts[-2]
        state_zip = parts[-1]
    elif len(parts) == 2:
        state_zip = parts[-1]
        city, zip_code = parse_bandzoogle_city_zip(state_zip)
    else:
        state_zip = ""
    if not zip_code:
        _, zip_code = parse_bandzoogle_city_zip(state_zip)
    return venue, address, city, zip_code


def parse_bandzoogle_event_cards(
    html_text: str,
    default_year: int,
    source_base_url: str,
    past_page: bool = False,
) -> list[dict[str, str]]:
    cards: list[dict[str, str]] = []
    last_month = 0
    for raw in re.split(r'<div class="event-detail"', html_text)[1:]:
        chunk = '<div class="event-detail"' + raw.split('<div class="event-clear"></div>', 1)[0]
        event_id = clean((re.search(r'data-event-id="([^"]+)"', chunk) or ["", ""])[1])
        occurrence_id = clean((re.search(r'data-occurrence-id="([^"]+)"', chunk) or ["", ""])[1])
        title_match = re.search(r'<h2[^>]*class="[^"]*event-title[^"]*"[^>]*>\s*<a href="([^"]+)">(.*?)</a>', chunk, re.S)
        if not title_match:
            continue
        event_url, title_html = title_match.groups()
        title = strip_html(title_html)
        date_block = re.search(r'<span class="date-long">(.*?)</span>\s*</span>', chunk, re.S)
        if not date_block:
            continue
        date_text_match = re.search(r'<span class="date">([^<]+)</span>', date_block.group(1))
        time_matches = re.findall(r'<span class="time">([^<]+)</span>', date_block.group(1))
        if not date_text_match:
            continue
        parsed_date = parse_bandzoogle_card_date(date_text_match.group(1), default_year, past_page, last_month)
        if not parsed_date:
            continue
        event_date, last_month = parsed_date
        location_match = re.search(r'<p class="event-info event-location">\s*(.*?)\s*</p>', chunk, re.S)
        location_text = strip_html(location_match.group(1)) if location_match else ""
        venue, address, city, zip_code = parse_bandzoogle_location(location_text)
        notes_match = re.search(r'<div class="event-info event-notes">(.*?)</div>', chunk, re.S)
        notes = strip_html(notes_match.group(1)) if notes_match else ""
        source_record_id = occurrence_id or event_id or short_hash(event_date, title, location_text, length=12)
        cards.append(
            {
                "event_date": event_date,
                "start_time": clean(time_matches[0]).replace(" ", "") if time_matches else "",
                "end_time": clean(time_matches[1]).replace(" ", "") if len(time_matches) > 1 else "",
                "title": title,
                "venue": venue,
                "address": address,
                "city": city,
                "zip_code": zip_code,
                "source_record_id": source_record_id,
                "source_url": urllib.parse.urljoin(source_base_url, html.unescape(event_url)),
                "description": clean(" | ".join(part for part in [title, location_text, address, notes] if clean(part))),
            }
        )
    return cards


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
    detail_rows: list[dict[str, str]] = []
    for page_url in pages:
        try:
            html = fetch_url(page_url)
        except Exception as exc:
            logger.info("Stopping calendar pagination for %s at %s: %s", artist.get("canonical_name"), page_url, exc)
            break
        parser = CalendarTableParser()
        parser.feed(html)
        page_rows = [tuple(row) for row in parser.rows if row and not row[0].lower().startswith("date")]
        rows.extend(page_rows)
        page_detail_rows: list[dict[str, str]] = []
        if not page_rows:
            page_detail_rows = parse_bandzoogle_event_cards(html, date.today().year, website)
            detail_rows.extend(page_detail_rows)
        if not page_rows and not page_detail_rows and page_url != website:
            break

    if detail_rows:
        previous_pages = [
            f"{base}{path_prefix}/features/load/calendar_feature_{feature_id}.turbo_stream?calendar_page_prev={page}"
            for page in range(1, 7)
        ]
        for page, page_url in enumerate(previous_pages, start=1):
            try:
                html = fetch_url(page_url)
            except Exception as exc:
                logger.info("Stopping previous calendar pagination for %s at %s: %s", artist.get("canonical_name"), page_url, exc)
                break
            page_detail_rows = parse_bandzoogle_event_cards(html, date.today().year, website, past_page=True)
            if not page_detail_rows:
                break
            detail_rows.extend(page_detail_rows)
            if f"calendar_page_prev={page + 1}" not in html:
                break

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
        venue, _address, city, zip_code = parse_bandzoogle_location(location_text)
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
    for item in detail_rows:
        venue = clean(item.get("venue"))
        title_text = clean(item.get("title"))
        if not venue:
            continue
        key = (item["event_date"], item["start_time"], venue, title_text)
        if key in seen:
            continue
        seen.add(key)
        event_title = f"{artist_name} @ {venue}" if venue != "Private Event" else title_text or f"{artist_name} private event"
        events.append(
            ScrapedArtistEvent(
                artist_id=artist_id,
                artist_name=artist_name,
                artist_type=artist_type,
                event_date=item["event_date"],
                start_time=item["start_time"],
                end_time=item["end_time"],
                title=event_title,
                venue_name=venue,
                city=clean(item.get("city")),
                state="OH",
                zip_code=clean(item.get("zip_code")),
                source=artist_site_source(website),
                source_record_id=clean(item.get("source_record_id")) or short_hash(*key, length=12),
                source_url=clean(item.get("source_url")) or website,
                description=clean(item.get("description")),
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


def parse_jim_gill_date(text: str, current_year: int, last_month: int) -> tuple[str, int, int] | None:
    match = re.match(r"^(?:[A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2})$", clean(text))
    if not match:
        return None
    month_name, day = match.groups()
    try:
        month_number = datetime.strptime(month_name, "%B").month
    except ValueError:
        return None
    year = current_year + (1 if last_month >= 11 and month_number < last_month else 0)
    return date(year, month_number, int(day)).isoformat(), year, month_number


JIM_GILL_RECOVERED_PAST_EVENTS = [
    {
        "event_date": "2026-05-16",
        "start_time": "6:30pm",
        "title": "Jim Gill @ Filia Cellars Winery",
        "venue_name": "Filia Cellars Winery",
        "address": "3059 Greenwich Road",
        "city": "Wadsworth",
        "zip_code": "44281",
        "description": (
            "Recovered from public Google search cache after the live calendar rolled forward. "
            "Filia Cellars Winery 3059 Greenwich Road, Wadsworth, OH 44281. 6:30pm."
        ),
    },
    {
        "event_date": "2026-05-17",
        "start_time": "3:30pm",
        "title": "Jim Gill @ Rocky Point Winery",
        "venue_name": "Rocky Point Winery",
        "address": "111 West Main Street",
        "city": "Marblehead",
        "zip_code": "43440",
        "description": (
            "Recovered from public Google search cache after the live calendar rolled forward. "
            "Rocky Point Winery 111 West Main Street, Marblehead, OH 43440. 3:30pm."
        ),
    },
]


def parse_jim_gill_location(detail: str) -> tuple[str, str, str, str]:
    match = re.search(
        r"^\s*(.+?)\s+(\d{1,6}\s+.*?),\s*([^,]+?),?\s+OH\s+(\d{5})\b",
        detail,
        re.I,
    )
    if match:
        venue_prefix, address, city, zip_code = match.groups()
        venue = clean(re.sub(r"\s+(?:at|in)$", "", venue_prefix))
        return venue, clean(address), clean(city), clean(zip_code)
    city_match = re.search(r"\b([^.,]+),\s*OH\s+(\d{5})\b", detail, re.I)
    return (
        "",
        "",
        clean(city_match.group(1)) if city_match else "",
        clean(city_match.group(2)) if city_match else "",
    )


def parse_jim_gill_calendar_detail(block: dict[str, str]) -> tuple[str, str, str, str, str]:
    text = clean(block.get("text"))
    link_name = clean(block.get("first_link"))
    venue_from_text, address, city, zip_code = parse_jim_gill_location(text)
    venue = link_name or venue_from_text
    if re.search(r"\b(private event|members only|vow renewal|anniversary party)\b", text, re.I) and not link_name:
        venue = "Private Event"
    if not venue:
        venue = clean(text.split(".")[0])
    times = re.findall(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b", text, flags=re.I)
    start_time = " & ".join(clean(match).replace(" ", "") for match in times[-2:]) if times else ""
    return venue, address, city, zip_code, start_time


def parse_jim_gill_calendar(artist: dict[str, str], logger: logging.Logger) -> list[ScrapedArtistEvent]:
    artist_name = clean(artist.get("canonical_name"))
    website = clean(artist.get("website"))
    calendar_url = urllib.parse.urljoin(website.rstrip("/") + "/", "calendar/")
    try:
        html = fetch_url(calendar_url)
    except Exception as exc:
        logger.warning("Could not fetch Jim Gill calendar %s: %s", calendar_url, exc)
        return []

    parser = GspbTextParser()
    parser.feed(html)
    artist_id = clean(artist.get("artist_id")) or make_id("artist", artist_name)
    artist_type = clean(artist.get("artist_type")) or "solo"
    events: list[ScrapedArtistEvent] = []
    year = date.today().year
    last_month = 0
    index = 0
    seen: set[str] = set()
    while index < len(parser.blocks) - 1:
        date_block = parser.blocks[index]
        parsed_date = parse_jim_gill_date(date_block["text"], year, last_month)
        if not parsed_date:
            index += 1
            continue
        event_date, year, last_month = parsed_date
        detail_block = parser.blocks[index + 1]
        if parse_jim_gill_date(detail_block["text"], year, last_month):
            index += 1
            continue
        venue, address, city, zip_code, start_time = parse_jim_gill_calendar_detail(detail_block)
        venue = clean(venue)
        if not venue:
            index += 2
            continue
        act_name = "Jim Gill & The Locomotives" if "Jim Gill & The Locomotives" in detail_block["text"] else artist_name
        title = (
            f"{act_name} @ {venue}"
            if venue != "Private Event"
            else clean(detail_block["text"].split(".")[0]) or f"{artist_name} private event"
        )
        description = clean(" | ".join(part for part in [detail_block["text"], address] if part))
        dedupe = "|".join([event_date, start_time, norm(venue), norm(title)])
        if dedupe in seen:
            index += 2
            continue
        seen.add(dedupe)
        events.append(
            ScrapedArtistEvent(
                artist_id=artist_id,
                artist_name=artist_name,
                artist_type=artist_type,
                event_date=event_date,
                start_time=start_time,
                end_time="",
                title=title,
                venue_name=venue,
                city=city,
                state="OH",
                zip_code=zip_code,
                source=artist_site_source(website),
                source_record_id=short_hash(event_date, start_time, venue, title, length=12),
                source_url=calendar_url,
                description=description,
            )
        )
        index += 2
    for recovered in JIM_GILL_RECOVERED_PAST_EVENTS:
        dedupe = "|".join([
            recovered["event_date"],
            recovered["start_time"],
            norm(recovered["venue_name"]),
            norm(recovered["title"]),
        ])
        if dedupe in seen:
            continue
        seen.add(dedupe)
        events.append(
            ScrapedArtistEvent(
                artist_id=artist_id,
                artist_name=artist_name,
                artist_type=artist_type,
                event_date=recovered["event_date"],
                start_time=recovered["start_time"],
                end_time="",
                title=recovered["title"],
                venue_name=recovered["venue_name"],
                city=recovered["city"],
                state="OH",
                zip_code=recovered["zip_code"],
                source=artist_site_source(website),
                source_record_id=short_hash(
                    recovered["event_date"],
                    recovered["start_time"],
                    recovered["venue_name"],
                    recovered["title"],
                    length=12,
                ),
                source_url=calendar_url,
                description=recovered["description"],
            )
        )
    return events


def parse_jerry_popiel_date(text: str) -> tuple[str, str] | None:
    match = re.match(r"^([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2})\s+(.+)$", clean(text))
    if not match:
        return None
    month, day, year, detail = match.groups()
    try:
        event_day = datetime.strptime(f"{year} {month} {day}", "%Y %B %d").date()
    except ValueError:
        return None
    return event_day.isoformat(), clean(detail)


def normalize_time_value(value: str, suffix: str) -> str:
    value = clean(value).upper()
    if ":" in value:
        hour, minute = value.split(":", 1)
        return f"{int(hour)}:{minute}{suffix.upper()}"
    return f"{int(value)}{suffix.upper()}"


def parse_jerry_popiel_times(detail: str) -> tuple[str, str, str]:
    match = re.search(
        r"\b(?:from\s+)?(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*([AP]M)\b",
        detail,
        re.I,
    )
    if not match:
        return "", "", clean(detail)
    start, end, suffix = match.groups()
    clean_detail = clean((detail[: match.start()] + detail[match.end() :]).replace("from", " "))
    return normalize_time_value(start, suffix), normalize_time_value(end, suffix), clean_detail


JERRY_POPIEL_KNOWN_VENUES = {
    "blossom music center vip club": {
        "venue": "Blossom Music Center VIP Club",
        "city": "Cuyahoga Falls",
        "zip_code": "44223",
    },
    "angel art auction john s knight center": {
        "venue": "John S. Knight Center",
        "city": "Akron",
    },
    "salon series julia": {
        "venue": "Julia's 1902 House",
        "city": "Willoughby",
    },
    "mardi gras at collision bend": {
        "venue": "Collision Bend",
        "city": "Euclid",
    },
    "crocker park": {
        "venue": "Crocker Park",
        "city": "Westlake",
    },
    "food truck tuesday": {
        "venue": "Public Square",
        "city": "Cleveland",
    },
    "ormaco event": {
        "venue": "ORMACO Event",
        "city": "Medina",
    },
    "ottawa county fair": {
        "venue": "Ottawa County Fairgrounds",
        "city": "Oak Harbor",
    },
    "turkeyfoot island club": {
        "venue": "Turkeyfoot Island Club",
        "city": "Portage Lakes",
    },
    "made in ohio arts festival": {
        "venue": "Made in Ohio Arts Festival",
        "city": "Peninsula",
    },
    "west pavilion lakeside": {
        "venue": "West Pavilion",
        "city": "Lakeside",
    },
}


def parse_jerry_popiel_location(detail: str) -> tuple[str, str, str]:
    cleaned = clean(re.sub(r"\([^)]*private event[^)]*\)", "", detail, flags=re.I).strip(" ,"))
    if re.match(r"^private event\b", cleaned, re.I):
        parts = [clean(part) for part in cleaned.split(",")]
        return "Private Event", parts[1] if len(parts) > 1 and norm(parts[1]) != "oh" else "", ""
    if re.match(r"^corporate event\b", cleaned, re.I):
        parts = [clean(part) for part in cleaned.split(",")]
        if len(parts) >= 3 and parts[1] and norm(parts[1]) != "oh":
            return parts[1], parts[2] if len(parts) > 2 and norm(parts[2]) != "oh" else "", ""
        return "Private Event", parts[1] if len(parts) > 1 and norm(parts[1]) != "oh" else "", ""
    for key, value in JERRY_POPIEL_KNOWN_VENUES.items():
        if key in norm(cleaned):
            return value["venue"], value.get("city", ""), value.get("zip_code", "")
    match = re.search(r"^(.+?),\s*([^,]+),\s*OH\b", cleaned, re.I)
    if match:
        return clean(match.group(1)), clean(match.group(2)), ""
    return cleaned, "", ""


def parse_jerry_popiel_schedule_lines(lines: list[str], artist: dict[str, str]) -> list[ScrapedArtistEvent]:
    artist_name = clean(artist.get("canonical_name"))
    artist_id = clean(artist.get("artist_id")) or make_id("artist", artist_name)
    artist_type = clean(artist.get("artist_type")) or "solo"
    website = clean(artist.get("website"))
    events: list[ScrapedArtistEvent] = []
    seen: set[str] = set()
    for line in lines:
        parsed = parse_jerry_popiel_date(line)
        if not parsed:
            continue
        event_date, detail = parsed
        start_time, end_time, detail_without_time = parse_jerry_popiel_times(detail)
        venue, city, zip_code = parse_jerry_popiel_location(detail_without_time)
        if not venue:
            continue
        title = f"{artist_name} @ {venue}" if venue != "Private Event" else f"{artist_name} private event"
        dedupe = "|".join([event_date, start_time, norm(venue), norm(title)])
        if dedupe in seen:
            continue
        seen.add(dedupe)
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
                source_record_id=short_hash(event_date, start_time, venue, detail, length=12),
                source_url=website,
                description=detail,
            )
        )
    return events


ROB_ROCKS_KNOWN_VENUES = {
    "bait house sandusky": {"venue": "Bait House Brewery", "city": "Sandusky", "zip_code": "44870"},
    "ballentine": {"venue": "Ballantine", "city": "Willoughby", "zip_code": "44094"},
    "caddyshack": {"venue": "Caddyshack", "city": "Kelleys Island"},
    "canoe club": {"venue": "Canoe Club", "city": "Marblehead"},
    "das weinhaus": {"venue": "Das Weinhaus", "city": "Litchfield", "zip_code": "44253"},
    "edison pub": {"venue": "Edison's Pub", "city": "Cleveland"},
    "esp brewing": {"venue": "ESP Brewing", "city": "Amherst"},
    "galaxy": {"venue": "Galaxy Restaurant", "city": "Wadsworth", "zip_code": "44281"},
    "gideon owen": {"venue": "Gideon Owen", "city": "Port Clinton", "zip_code": "43452"},
    "gideon owen winery": {"venue": "Gideon Owen", "city": "Port Clinton", "zip_code": "43452"},
    "grab n go": {"venue": "Grab N Go Beverage • Drivethru & Pub", "city": "Medina", "zip_code": "44256"},
    "hidden beach bar": {"venue": "Hidden Beach Bar", "city": "Lakeside Marblehead", "zip_code": "43440"},
    "jimmy bukketts": {"venue": "Jimmy Bukkett's", "city": "Fremont", "zip_code": "43420"},
    "lorain brewing company": {"venue": "Lorain Brewing Company and Event Center", "city": "Lorain", "zip_code": "44052"},
    "mad river harley davidson": {"venue": "Mad River Harley-Davidson", "city": "Sandusky", "zip_code": "44870"},
    "medina brewing company": {"venue": "Medina Brewing Company", "city": "Medina", "zip_code": "44256"},
    "olesia taverne": {"venue": "Olesias Tavern", "city": "Richfield", "zip_code": "44286"},
    "on tap": {"venue": "On Tap Medina", "city": "Medina", "zip_code": "44256"},
    "paninis": {"venue": "Paninis", "city": "Concord"},
    "red wine brew": {"venue": "Red Wine & Brew", "city": "Mentor", "zip_code": "44060"},
    "runinmuck": {"venue": "Camp Runinmuck", "city": "Lakeside Marblehead", "zip_code": "43440"},
    "sandusky koa": {"venue": "Sandusky KOA", "city": "Sandusky", "zip_code": "44870"},
    "sandusky rv resort": {"venue": "Sandusky RV Resort", "city": "Sandusky", "zip_code": "44870"},
    "sandusky yacht club": {"venue": "Sandusky Yacht Club", "city": "Sandusky", "zip_code": "44870"},
    "secret at center": {"venue": "Secret of Center", "city": "Brunswick"},
    "the keys": {"venue": "The Keys Put-In-Bay", "city": "Put-In-Bay", "zip_code": "43456"},
    "twin oast": {"venue": "Twin Oast Brewing", "city": "Port Clinton", "zip_code": "43452"},
    "waters edge": {"venue": "Waters Edge Tiki Bar & Grill", "city": "Lakeside Marblehead", "zip_code": "43440"},
}

ROB_ROCKS_KNOWN_VENUE_LOOKUP = {canonical_venue_name(key): value for key, value in ROB_ROCKS_KNOWN_VENUES.items()}


ROB_ROCKS_CITY_ALIASES = {
    "catawba": "Port Clinton",
    "concorde": "Concord",
    "kellys island": "Kelleys Island",
    "marblehead": "Lakeside Marblehead",
    "pib": "Put-In-Bay",
    "tremont": "Cleveland",
    "west park": "Cleveland",
}


def parse_rob_rocks_times(detail: str) -> tuple[str, str, str]:
    time_re = re.compile(
        r"\b(\d{1,2}(?::\d{2})?)\s*(?:-\s*(\d{1,2}(?::\d{2})?)\s*)?([AP]M)\b",
        re.I,
    )
    starts: list[str] = []
    ends: list[str] = []
    for match in time_re.finditer(detail):
        start, end, suffix = match.groups()
        starts.append(normalize_time_value(start, suffix))
        if end:
            ends.append(normalize_time_value(end, suffix))
    cleaned = clean(time_re.sub(" ", detail).strip(" ,-"))
    return " & ".join(starts), " & ".join(ends), cleaned


def parse_rob_rocks_location(detail: str) -> tuple[str, str, str]:
    if re.fullmatch(r"private event", clean(detail), re.I):
        return "Private Event", "", ""

    parts = [clean(part) for part in re.split(r"\s+-\s+", detail) if clean(part)]
    venue = parts[0] if parts else clean(detail)
    city = parts[1] if len(parts) > 1 else ""
    city = ROB_ROCKS_CITY_ALIASES.get(canonical_venue_name(city), city)
    known_key = canonical_venue_name(" ".join(part for part in [venue, city] if part))
    known = ROB_ROCKS_KNOWN_VENUE_LOOKUP.get(known_key) or ROB_ROCKS_KNOWN_VENUE_LOOKUP.get(canonical_venue_name(venue))
    if known:
        return known["venue"], known.get("city", city), known.get("zip_code", "")
    return venue, city, ""


def parse_rob_rocks_schedule_lines(lines: list[str], artist: dict[str, str]) -> list[ScrapedArtistEvent]:
    artist_name = clean(artist.get("canonical_name"))
    artist_id = clean(artist.get("artist_id")) or make_id("artist", artist_name)
    artist_type = clean(artist.get("artist_type")) or "solo"
    website = clean(artist.get("website"))
    year = date.today().year
    events: list[ScrapedArtistEvent] = []
    seen: set[str] = set()
    for line in lines:
        if re.fullmatch(r"20\d{2}", line):
            year = int(line)
            continue
        match = re.match(r"^(\d{1,2})/(\d{1,2})\s+(.+)$", line)
        if not match:
            continue
        month, day, detail = match.groups()
        try:
            event_date = date(year, int(month), int(day)).isoformat()
        except ValueError:
            continue
        start_time, end_time, location_detail = parse_rob_rocks_times(detail)
        venue, city, zip_code = parse_rob_rocks_location(location_detail)
        if not venue:
            continue
        title = f"{artist_name} @ {venue}" if venue != "Private Event" else f"{artist_name} private event"
        dedupe = "|".join([event_date, start_time, norm(venue), norm(title)])
        if dedupe in seen:
            continue
        seen.add(dedupe)
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
                source_record_id=short_hash(event_date, start_time, venue, detail, length=12),
                source_url=website,
                description=detail,
            )
        )
    return events


def parse_rob_rocks_calendar(artist: dict[str, str], logger: logging.Logger) -> list[ScrapedArtistEvent]:
    website = clean(artist.get("website")) or "https://robrockscle.com/home"
    calendar_url = "https://robrockscle.com/home"
    try:
        html = fetch_url(calendar_url)
    except Exception as exc:
        logger.warning("Could not fetch Rob Rocks calendar %s: %s", calendar_url, exc)
        return []
    parser = VisibleTextParser()
    parser.feed(html)
    return parse_rob_rocks_schedule_lines(parser.lines(), {**artist, "website": website})


AUSTIN_WALKIN_CANE_CALENDAR_PAGES = [
    "https://walkincane.com/events/list/?eventDisplay=past",
    *[f"https://walkincane.com/events/list/page/{page}/?eventDisplay=past" for page in range(2, 9)],
    "https://walkincane.com/events/list/",
]

AUSTIN_WALKIN_CANE_EXTRA_PAGES = [
    "https://www.forestcitybrewery.com/events",
    "https://www.visiblevoicebooks.com/calendar-of-events",
    "https://fedchurch.org/pas/",
    "https://www.kentbluesfest.com/artist/austin-walkin-cane",
    "https://musicboxcle.com/schedule/at-a-glance-concert-schedule/",
]

AUSTIN_CITY_ALIASES = {
    "cle": "Cleveland",
    "cuyahoga falls": "Cuyahoga Falls",
}

AUSTIN_KNOWN_VENUES = {
    "a j rocco": {"venue": "A.J. Rocco's", "city": "Cleveland"},
    "beachland ballroom": {"venue": "Beachland Ballroom & Tavern", "city": "Cleveland", "zip_code": "44110"},
    "beachland tavern": {"venue": "Beachland Ballroom & Tavern", "city": "Cleveland", "zip_code": "44110"},
    "brother lounge": {"venue": "Brother's Lounge", "city": "Cleveland"},
    "cbg": {"venue": "Chestnut Beer Garden", "city": "Akron"},
    "chestnut beer garden": {"venue": "Chestnut Beer Garden", "city": "Akron"},
    "collision bend": {"venue": "Collision Bend Brewing", "city": "Euclid"},
    "federated church family life center": {
        "venue": "Federated Church Family Life Center",
        "city": "Chagrin Falls",
        "zip_code": "44022",
    },
    "forest city brewery": {"venue": "Forest City Brewery", "city": "Cleveland", "zip_code": "44113"},
    "harpersfield winery": {"venue": "Harpersfield Winery", "city": "Madison"},
    "house of blues": {"venue": "House of Blues Cleveland", "city": "Cleveland"},
    "jenks building": {"venue": "The Jenks Building", "city": "Cuyahoga Falls", "zip_code": "44221"},
    "kent blues fest": {"venue": "Kent Blues Fest", "city": "Kent", "zip_code": "44240"},
    "music box": {"venue": "Music Box Supper Club", "city": "Cleveland", "zip_code": "44113"},
    "music box supper club": {"venue": "Music Box Supper Club", "city": "Cleveland", "zip_code": "44113"},
    "olde towne charleston social club": {"venue": "Olde Towne Charleston Social Club", "city": "Lorain"},
    "rush inn": {"venue": "Rush Inn", "city": ""},
    "sarah vineyard": {"venue": "Sarah's Vineyard", "city": "Cuyahoga Falls", "zip_code": "44223"},
    "speak of the devil": {"venue": "Speak of the Devil Cocktail Bar", "city": "Lorain", "zip_code": "44052"},
    "the treelawn": {"venue": "Treelawn Social Club", "city": "Cleveland"},
    "union house": {"venue": "Union House", "city": "Cleveland"},
    "visible voice books": {"venue": "Visible Voice Books", "city": "Cleveland", "zip_code": "44102"},
    "west park station": {"venue": "West Park Station", "city": "Cleveland"},
    "wine dive": {"venue": "Wine Dive", "city": "Lakewood"},
    "windows on the river": {"venue": "Windows on the River", "city": "Cleveland"},
}

AUSTIN_KNOWN_VENUE_LOOKUP = {canonical_venue_name(key): value for key, value in AUSTIN_KNOWN_VENUES.items()}


def austin_known_venue(key: str) -> dict[str, str]:
    return AUSTIN_KNOWN_VENUE_LOOKUP[canonical_venue_name(key)]


def format_24h_time(value: str) -> str:
    match = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?$", clean(value))
    if not match:
        return clean(value)
    hour, minute = (int(match.group(1)), match.group(2))
    suffix = "AM" if hour < 12 else "PM"
    hour = hour % 12 or 12
    return f"{hour}:{minute}{suffix}"


def extract_json_ld_events(html_text: str) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for match in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>\s*(.*?)\s*</script>', html_text, re.S | re.I):
        raw = html.unescape(match.group(1))
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        items = payload if isinstance(payload, list) else [payload]
        rows.extend(item for item in items if isinstance(item, dict) and clean(item.get("@type")).lower() == "event")
    return rows


def parse_schema_event_datetime(value: object) -> tuple[str, str]:
    text = clean(value)
    match = re.match(r"^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?))?", text)
    if not match:
        return "", ""
    event_date, event_time = match.groups()
    return event_date, format_24h_time(event_time or "")


def normalize_austin_venue_part(value: str) -> str:
    text = clean(value)
    text = re.split(r"\s+w/\s+|\s+with\s+", text, maxsplit=1, flags=re.I)[0]
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\b(?:opening for|jam night|festival|cancelled|canceled)\b.*$", " ", text, flags=re.I)
    return clean(text.strip(" •-"))


def parse_austin_walkin_cane_location(title: str) -> tuple[str, str, str] | None:
    cleaned = html.unescape(clean(title)).replace("&#038;", "&")
    if re.search(r"\b(cancelled|canceled|wruw|ivy.?s red sweater)\b", cleaned, re.I):
        return None
    if re.search(r"\bprivate party\b", cleaned, re.I):
        return "Private Event", "", ""
    parts = [clean(part) for part in cleaned.split("•") if clean(part)]
    if not parts:
        return None
    state = "OH" if any(re.search(r"\bOH\b", part) for part in parts) else ""
    if not state and any(re.search(r"\b(MI|MS|PA|NY|IN|KY|WV)\b", part) for part in parts):
        return None

    city = ""
    for part in parts:
        city_match = re.search(r"\b([A-Za-z .'-]+),\s*OH\b", part)
        if city_match:
            city = clean(city_match.group(1))
            city = AUSTIN_CITY_ALIASES.get(canonical_venue_name(city), city)
            break

    venue = normalize_austin_venue_part(parts[0])
    if canonical_venue_name(venue) in {"awc", "austin walkin cane"} and len(parts) > 1:
        venue = normalize_austin_venue_part(parts[1])
    if not venue:
        return None
    known = AUSTIN_KNOWN_VENUE_LOOKUP.get(canonical_venue_name(venue))
    if known:
        return known["venue"], city or known.get("city", ""), known.get("zip_code", "")
    if not state and not city:
        return None
    return venue, city, ""


def make_austin_event(
    artist: dict[str, str],
    event_date: str,
    start_time: str,
    end_time: str,
    venue: str,
    city: str,
    zip_code: str,
    source_url: str,
    description: str,
    title_prefix: str = "",
) -> ScrapedArtistEvent:
    artist_name = clean(artist.get("canonical_name"))
    artist_id = clean(artist.get("artist_id")) or make_id("artist", artist_name)
    artist_type = clean(artist.get("artist_type")) or "solo"
    title = clean(title_prefix) or (f"{artist_name} @ {venue}" if venue != "Private Event" else f"{artist_name} private event")
    return ScrapedArtistEvent(
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
        source=artist_site_source(clean(artist.get("website"))),
        source_record_id=short_hash(source_url, event_date, start_time, venue, description, length=12),
        source_url=source_url,
        description=description,
    )


def parse_austin_official_events(html_text: str, source_url: str, artist: dict[str, str]) -> list[ScrapedArtistEvent]:
    events: list[ScrapedArtistEvent] = []
    for item in extract_json_ld_events(html_text):
        event_date, start_time = parse_schema_event_datetime(item.get("startDate"))
        _end_date, end_time = parse_schema_event_datetime(item.get("endDate"))
        if not event_date:
            continue
        parsed_location = parse_austin_walkin_cane_location(clean(item.get("name")))
        if not parsed_location:
            continue
        venue, city, zip_code = parsed_location
        events.append(
            make_austin_event(
                artist,
                event_date,
                start_time,
                end_time,
                venue,
                city,
                zip_code,
                clean(item.get("url")) or source_url,
                clean(item.get("name")),
            )
        )
    return events


def parse_long_date_line(value: str, default_year: int | None = None) -> tuple[str, str] | None:
    text = clean(value)
    text = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", text, flags=re.I)
    patterns = [
        ("%A, %B %d, %Y", r"^[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+20\d{2}"),
        ("%B %d, %Y", r"^[A-Za-z]+\s+\d{1,2},\s+20\d{2}"),
    ]
    for fmt, regex in patterns:
        match = re.search(regex, text)
        if match:
            event_date = datetime.strptime(match.group(0), fmt).date().isoformat()
            tail = clean(text[match.end() :].strip(" ,"))
            return event_date, tail
    if default_year:
        short_match = re.search(r"^(\d{1,2})/(\d{1,2})", text)
        if short_match:
            month, day = map(int, short_match.groups())
            return date(default_year, month, day).isoformat(), clean(text[short_match.end() :])
    return None


def parse_ampm_time(value: str) -> str:
    match = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*([AP]M)\b", clean(value), re.I)
    if not match:
        return ""
    hour, minute, suffix = match.groups()
    return f"{int(hour)}:{minute or '00'}{suffix.upper()}"


def parse_austin_squarespace_events(html_text: str, source_url: str, artist: dict[str, str], default_venue: str = "") -> list[ScrapedArtistEvent]:
    parser = VisibleTextParser()
    parser.feed(html_text)
    lines = parser.lines()
    events: list[ScrapedArtistEvent] = []
    seen_dates: set[str] = set()
    for index, line in enumerate(lines):
        lowered = norm(line)
        if "austin walkin cane" not in lowered or lowered.startswith("damn fine blues"):
            continue
        parsed_date = parse_long_date_line(lines[index + 1]) if index + 1 < len(lines) else None
        if not parsed_date:
            continue
        event_date, _tail = parsed_date
        if event_date in seen_dates:
            continue
        seen_dates.add(event_date)
        start_time = parse_ampm_time(lines[index + 2]) if index + 2 < len(lines) else ""
        end_time = parse_ampm_time(lines[index + 3]) if index + 3 < len(lines) else ""
        venue = default_venue or (clean(lines[index + 4]) if index + 4 < len(lines) else "")
        known = AUSTIN_KNOWN_VENUE_LOOKUP.get(canonical_venue_name(venue))
        city = known.get("city", "") if known else ""
        zip_code = known.get("zip_code", "") if known else ""
        if not venue:
            continue
        events.append(make_austin_event(artist, event_date, start_time, end_time, known.get("venue", venue) if known else venue, city, zip_code, source_url, line))
    return events


def parse_austin_fedchurch_events(html_text: str, source_url: str, artist: dict[str, str]) -> list[ScrapedArtistEvent]:
    parser = VisibleTextParser()
    parser.feed(html_text)
    lines = parser.lines()
    events: list[ScrapedArtistEvent] = []
    for index, line in enumerate(lines):
        if "austin walkin cane" not in norm(line):
            continue
        parsed_date = parse_long_date_line(lines[index + 1]) if index + 1 < len(lines) else None
        if not parsed_date:
            continue
        event_date, tail = parsed_date
        known = austin_known_venue("federated church family life center")
        events.append(
            make_austin_event(
                artist,
                event_date,
                parse_ampm_time(tail),
                "",
                known["venue"],
                known["city"],
                known["zip_code"],
                source_url,
                clean(" | ".join(lines[index : min(len(lines), index + 4)])),
                "Austin Walkin' Cane @ Federated Church Family Life Center",
            )
        )
    return events


def parse_austin_kent_blues_events(html_text: str, source_url: str, artist: dict[str, str]) -> list[ScrapedArtistEvent]:
    parser = VisibleTextParser()
    parser.feed(html_text)
    text = "\n".join(parser.lines())
    if "Austin Walkin" not in text:
        return []
    match = re.search(r"([A-Za-z]+\s+\d{1,2},\s+20\d{2})\s+-\s+Downtown,\s+Kent\s+OH", text)
    if not match:
        return []
    event_date = datetime.strptime(match.group(1), "%B %d, %Y").date().isoformat()
    known = austin_known_venue("kent blues fest")
    return [
        make_austin_event(
            artist,
            event_date,
            "",
            "",
            known["venue"],
            known["city"],
            known["zip_code"],
            source_url,
            "Austin Walkin' Cane at Kent Blues Fest, Downtown Kent OH",
            "Austin Walkin' Cane @ Kent Blues Fest",
        )
    ]


def parse_austin_music_box_schedule(html_text: str, source_url: str, artist: dict[str, str]) -> list[ScrapedArtistEvent]:
    parser = VisibleTextParser()
    parser.feed(html_text)
    events: list[ScrapedArtistEvent] = []
    known = austin_known_venue("music box supper club")
    for line in parser.lines():
        if "austin walkin" not in norm(line):
            continue
        match = re.search(r"(\d{1,2})/(\d{1,2})(\d{1,2}:\d{2}\s*[ap]m).*Austin Walkin", line, re.I)
        if not match:
            continue
        month, day, time_text = match.groups()
        year = date.today().year + (1 if date.today().month == 12 and int(month) == 1 else 0)
        event_date = date(year, int(month), int(day)).isoformat()
        events.append(
            make_austin_event(
                artist,
                event_date,
                parse_ampm_time(time_text),
                "",
                known["venue"],
                known["city"],
                known["zip_code"],
                source_url,
                line,
                "Blues Brunch with Austin Walkin' Cane",
            )
        )
    return events


def parse_austin_walkin_cane_calendar(artist: dict[str, str], logger: logging.Logger) -> list[ScrapedArtistEvent]:
    events: list[ScrapedArtistEvent] = []
    min_date = date(date.today().year, 1, 1)
    for page_url in AUSTIN_WALKIN_CANE_CALENDAR_PAGES:
        try:
            page_html = fetch_url(page_url)
        except Exception as exc:
            logger.info("Could not fetch Austin Walkin' Cane calendar page %s: %s", page_url, exc)
            continue
        page_events = parse_austin_official_events(page_html, page_url, artist)
        events.extend(event for event in page_events if parse_iso(event.event_date) and parse_iso(event.event_date) >= min_date)

    for page_url in AUSTIN_WALKIN_CANE_EXTRA_PAGES:
        try:
            page_html = fetch_url(page_url)
        except Exception as exc:
            logger.info("Could not fetch Austin Walkin' Cane supplemental page %s: %s", page_url, exc)
            continue
        if "forestcitybrewery.com" in page_url:
            events.extend(parse_austin_squarespace_events(page_html, page_url, artist))
        elif "visiblevoicebooks.com" in page_url:
            events.extend(parse_austin_squarespace_events(page_html, page_url, artist, default_venue="Visible Voice Books"))
        elif "fedchurch.org" in page_url:
            events.extend(parse_austin_fedchurch_events(page_html, page_url, artist))
        elif "kentbluesfest.com" in page_url:
            events.extend(parse_austin_kent_blues_events(page_html, page_url, artist))
        elif "musicboxcle.com" in page_url:
            events.extend(parse_austin_music_box_schedule(page_html, page_url, artist))

    deduped: dict[str, ScrapedArtistEvent] = {}
    for event in events:
        deduped[event.event_id] = event
    return sorted(deduped.values(), key=lambda event: (event.event_date, event.start_time, event.venue_name))


LITTLE_STEVE_O_FEED_URL = "https://www.littlesteveo.com/feeds/posts/default/-/Events?alt=json&max-results=500"

LITTLE_STEVE_O_RECOVERED_FUTURE_EVENTS = [
    {
        "event_date": "2026-06-05",
        "start_time": "7PM",
        "end_time": "10PM",
        "venue_name": "Beau's Bar & Bistro",
        "city": "Copley",
        "zip_code": "44321",
        "source_url": "https://beausbarandbistro.com/events",
        "description": "Recovered from Beau's Bar & Bistro public event listing: Steve'O, June 5, 2026, 7:00 pm - 10:00 pm.",
    },
    {
        "event_date": "2026-07-10",
        "start_time": "7PM",
        "end_time": "10PM",
        "venue_name": "Beau's Bar & Bistro",
        "city": "Copley",
        "zip_code": "44321",
        "source_url": "https://beausbarandbistro.com/events",
        "description": "Recovered from Beau's Bar & Bistro public event listing: Steve'O, July 10, 2026, 7:00 pm - 10:00 pm.",
    },
]

LITTLE_STEVE_O_CITY_ALIASES = {
    "downtown": "Akron",
    "downtown akron": "Akron",
    "hts": "Cleveland Heights",
    "portage lakes": "Akron",
}

LITTLE_STEVE_O_KNOWN_VENUES = {
    "8th day brewing": {"venue": "8th Day Brewing Company", "city": "Chagrin Falls"},
    "beau grille": {"venue": "Beau's Grille", "city": "Fairlawn", "zip_code": "44333"},
    "beaus grille": {"venue": "Beau's Grille", "city": "Fairlawn", "zip_code": "44333"},
    "blu tique hotel": {"venue": "Blu-Tique Hotel", "city": "Akron", "zip_code": "44308"},
    "blue monkey brewing": {"venue": "Blue Monkey Brewing Company", "city": "North Royalton", "zip_code": "44133"},
    "brighten brewing": {"venue": "Brighten Brewing Company", "city": "Copley", "zip_code": "44321"},
    "brewster": {"venue": "Brewsters Cafe Bistro Pub", "city": "Twinsburg", "zip_code": "44087"},
    "crafted artisan meadery": {"venue": "Crafted Artisan Meadery", "city": "Mogadore", "zip_code": "44260"},
    "dragonfly winery": {"venue": "Dragonfly Winery", "city": "Canal Fulton", "zip_code": "44614"},
    "gervasi": {"venue": "Gervasi Vineyard", "city": "Canton", "zip_code": "44721"},
    "glenwillow grille": {"venue": "Glenwillow Grille", "city": "Solon", "zip_code": "44139"},
    "house of blues": {"venue": "House of Blues Cleveland", "city": "Cleveland"},
    "la la": {"venue": "La La's in the Lakes", "city": "Akron", "zip_code": "44319"},
    "la las": {"venue": "La La's in the Lakes", "city": "Akron", "zip_code": "44319"},
    "lanning": {"venue": "Dean Martin's Lanning's Restaurant", "city": "Bath", "zip_code": "44333"},
    "medina brewing company": {"venue": "Medina Brewing Company", "city": "Medina", "zip_code": "44256"},
    "pint pie works": {"venue": "The Pint & Pie Works", "city": "Bath"},
    "red hawk grille": {"venue": "Redhawk Grille", "city": "Concord"},
    "redhawk grille": {"venue": "Redhawk Grille", "city": "Concord"},
    "ridge rail": {"venue": "Ridge & Rail", "city": "Wadsworth", "zip_code": "44281"},
    "rose villa": {"venue": "Rose Villa", "city": "Akron"},
    "sarah vineyard": {"venue": "Sarah's Vineyard", "city": "Cuyahoga Falls", "zip_code": "44223"},
    "sharon james cellars": {"venue": "Sharon James Cellars", "city": "Newbury", "zip_code": "44065"},
    "stillhouse gervasi": {"venue": "Gervasi Vineyard", "city": "Canton", "zip_code": "44721"},
    "the basement": {"venue": "The Basement Sports Bar & Grill", "city": "Cuyahoga Falls", "zip_code": "44221"},
    "triv": {"venue": "Trivs", "city": "Strongsville", "zip_code": "44136"},
    "west main st winery": {"venue": "West Main St Winery & Brewery", "city": "Ravenna", "zip_code": "44266"},
    "wolfcreek tavern": {"venue": "Wolf Creek Tavern", "city": "Norton", "zip_code": "44203"},
}

LITTLE_STEVE_O_KNOWN_VENUE_LOOKUP = {canonical_venue_name(key): value for key, value in LITTLE_STEVE_O_KNOWN_VENUES.items()}


def strip_parentheticals(value: str) -> str:
    return clean(re.sub(r"\([^)]*\)", " ", value))


def parse_little_steve_o_time(detail: str) -> tuple[str, str, str]:
    range_match = re.search(
        r"\b(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)\b",
        detail,
        re.I,
    )
    if range_match:
        start, end, suffix = range_match.groups()
        cleaned = clean((detail[: range_match.start()] + detail[range_match.end() :]).strip(" ,-"))
        return normalize_time_value(start, suffix), normalize_time_value(end, suffix), cleaned
    single_match = re.search(r"\b(\d{1,2}(?::\d{2})?)\s*(am|pm)\b", detail, re.I)
    if single_match:
        start, suffix = single_match.groups()
        cleaned = clean((detail[: single_match.start()] + detail[single_match.end() :]).strip(" ,-"))
        return normalize_time_value(start, suffix), "", cleaned
    bare_range_match = re.search(r"\b(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\b\s*$", detail)
    if bare_range_match:
        start, end = bare_range_match.groups()
        cleaned = clean(detail[: bare_range_match.start()].strip(" ,-"))
        return normalize_time_value(start, "PM"), normalize_time_value(end, "PM"), cleaned
    return "", "", detail


def normalize_little_steve_o_venue(value: str) -> str:
    text = clean(value).replace("/", " ")
    text = re.sub(r"\bw\s*/\s*.+$", " ", clean(value), flags=re.I).replace("/", " ")
    text = strip_parentheticals(text)
    text = re.sub(r"\b(?:solo|solo debut|debut|doubletree|hilton)\b", " ", text, flags=re.I)
    return clean(text.strip(" ,-"))


def parse_little_steve_o_location(detail: str) -> tuple[str, str, str]:
    if re.search(r"\bprivate\b", detail, re.I):
        city_match = re.search(r"\bin\s+(.+)$", detail, re.I)
        city = clean(re.sub(r"\bw/\s*.+$", "", city_match.group(1), flags=re.I)) if city_match else ""
        city = strip_parentheticals(city)
        city = LITTLE_STEVE_O_CITY_ALIASES.get(canonical_venue_name(city), city)
        return "Private Event", city, ""

    parts = re.split(r"\bin\b", detail, maxsplit=1, flags=re.I)
    venue_raw = parts[0]
    city = ""
    if len(parts) > 1:
        city = clean(re.sub(r"\bw/\s*.+$", "", parts[1], flags=re.I))
        city = strip_parentheticals(city)
        city = LITTLE_STEVE_O_CITY_ALIASES.get(canonical_venue_name(city), city)
    venue = normalize_little_steve_o_venue(venue_raw)
    if not venue:
        return "", city, ""
    known = LITTLE_STEVE_O_KNOWN_VENUE_LOOKUP.get(canonical_venue_name(venue))
    if known:
        return known["venue"], known.get("city", "") or city, known.get("zip_code", "")
    return re.sub(r"'S\b", "'s", venue.title()), city, ""


def little_steve_o_entry_year(entry: dict[str, object]) -> int:
    published = clean(((entry.get("published") or {}) if isinstance(entry.get("published"), dict) else {}).get("$t"))
    match = re.match(r"^(20\d{2})", published)
    return int(match.group(1)) if match else date.today().year


def parse_little_steve_o_post_text(text: str, entry_year: int, artist: dict[str, str], source_url: str) -> list[ScrapedArtistEvent]:
    normalized = clean(text)
    starts = [match.start() for match in re.finditer(r"\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+\d{1,2}/\d{1,2}\b", normalized, re.I)]
    fragments = [normalized[starts[index] : starts[index + 1] if index + 1 < len(starts) else len(normalized)] for index in range(len(starts))]
    events: list[ScrapedArtistEvent] = []
    for fragment in fragments:
        match = re.match(r"^(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+(\d{1,2})/(\d{1,2})\s+(.+)$", fragment, re.I)
        if not match:
            continue
        month, day, detail = match.groups()
        try:
            event_date = date(entry_year, int(month), int(day)).isoformat()
        except ValueError:
            continue
        start_time, end_time, location_detail = parse_little_steve_o_time(detail)
        venue, city, zip_code = parse_little_steve_o_location(location_detail)
        if not venue:
            continue
        artist_name = clean(artist.get("canonical_name"))
        title = f"{artist_name} @ {venue}" if venue != "Private Event" else f"{artist_name} private event"
        events.append(
            ScrapedArtistEvent(
                artist_id=clean(artist.get("artist_id")) or make_id("artist", artist_name),
                artist_name=artist_name,
                artist_type=clean(artist.get("artist_type")) or "solo",
                event_date=event_date,
                start_time=start_time,
                end_time=end_time,
                title=title,
                venue_name=venue,
                city=city,
                state="OH",
                zip_code=zip_code,
                source=artist_site_source(clean(artist.get("website"))),
                source_record_id=short_hash(source_url, event_date, start_time, venue, fragment, length=12),
                source_url=source_url,
                description=fragment,
            )
        )
    return events


def parse_little_steve_o_feed(feed_text: str, artist: dict[str, str], min_year: int | None = None) -> list[ScrapedArtistEvent]:
    payload = json.loads(feed_text)
    entries = payload.get("feed", {}).get("entry", [])
    events: list[ScrapedArtistEvent] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        entry_year = little_steve_o_entry_year(entry)
        if min_year and entry_year < min_year:
            continue
        content_html = clean((entry.get("content") or {}).get("$t") if isinstance(entry.get("content"), dict) else "")
        text = strip_html(content_html)
        links = entry.get("link", [])
        source_url = clean(next((link.get("href") for link in links if isinstance(link, dict) and link.get("rel") == "alternate"), ""))
        events.extend(parse_little_steve_o_post_text(text, entry_year, artist, source_url or clean(artist.get("website"))))
    return events


def little_steve_o_recovered_events(artist: dict[str, str]) -> list[ScrapedArtistEvent]:
    artist_name = clean(artist.get("canonical_name"))
    artist_id = clean(artist.get("artist_id")) or make_id("artist", artist_name)
    artist_type = clean(artist.get("artist_type")) or "solo"
    return [
        ScrapedArtistEvent(
            artist_id=artist_id,
            artist_name=artist_name,
            artist_type=artist_type,
            event_date=item["event_date"],
            start_time=item["start_time"],
            end_time=item["end_time"],
            title=f"{artist_name} @ {item['venue_name']}",
            venue_name=item["venue_name"],
            city=item["city"],
            state="OH",
            zip_code=item["zip_code"],
            source=artist_site_source(clean(artist.get("website"))),
            source_record_id=short_hash(item["source_url"], item["event_date"], item["venue_name"], length=12),
            source_url=item["source_url"],
            description=item["description"],
        )
        for item in LITTLE_STEVE_O_RECOVERED_FUTURE_EVENTS
    ]


def parse_little_steve_o_calendar(artist: dict[str, str], logger: logging.Logger) -> list[ScrapedArtistEvent]:
    try:
        feed_text = fetch_url(LITTLE_STEVE_O_FEED_URL)
    except Exception as exc:
        logger.warning("Could not fetch Little Steve-O events feed %s: %s", LITTLE_STEVE_O_FEED_URL, exc)
        return []
    min_year = date.today().year
    events = parse_little_steve_o_feed(feed_text, artist, min_year=min_year)
    events.extend(little_steve_o_recovered_events(artist))
    deduped: dict[str, ScrapedArtistEvent] = {}
    for event in events:
        event_day = parse_iso(event.event_date)
        if event_day and event_day.year >= min_year:
            deduped[event.event_id] = event
    return sorted(deduped.values(), key=lambda event: (event.event_date, event.start_time, event.venue_name))


def parse_jerry_popiel_calendar(artist: dict[str, str], logger: logging.Logger) -> list[ScrapedArtistEvent]:
    website = clean(artist.get("website"))
    try:
        html = fetch_url(website)
    except Exception as exc:
        logger.warning("Could not fetch Jerry Popiel calendar %s: %s", website, exc)
        return []
    parser = VisibleTextParser()
    parser.feed(html)
    return parse_jerry_popiel_schedule_lines(parser.lines(), artist)


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
        elif "jimgillmusic.com" in website.lower():
            scraped = parse_jim_gill_calendar(artist, logger)
            checked_artist_ids.add(artist_id)
            checked_sources.add(artist_site_source(website))
        elif "jerrypopiel.com" in website.lower():
            scraped = parse_jerry_popiel_calendar(artist, logger)
            checked_artist_ids.add(artist_id)
            checked_sources.add(artist_site_source(website))
        elif "robrockscle.com" in website.lower():
            scraped = parse_rob_rocks_calendar(artist, logger)
            checked_artist_ids.add(artist_id)
            checked_sources.add(artist_site_source(website))
        elif "walkincane.com" in website.lower():
            scraped = parse_austin_walkin_cane_calendar(artist, logger)
            checked_artist_ids.add(artist_id)
            checked_sources.add(artist_site_source(website))
        elif "littlesteveo.com" in website.lower():
            scraped = parse_little_steve_o_calendar(artist, logger)
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
        if scraped:
            checked_artist_ids.add(artist_id)
            checked_sources.add(artist_site_source(website))
        else:
            checked_artist_ids.discard(artist_id)
            checked_sources.discard(artist_site_source(website))
        events.extend(scraped)
    return ArtistSiteScrape(events=events, checked_artist_ids=checked_artist_ids, checked_sources=checked_sources)


def row_by_key(rows: Iterable[dict[str, str]], key: str) -> dict[str, dict[str, str]]:
    return {clean(row.get(key)): row for row in rows if clean(row.get(key))}


def venue_address_fingerprint(row: dict[str, str] | ScrapedArtistEvent) -> str:
    if isinstance(row, ScrapedArtistEvent):
        street = extract_street_address(row.description)
        zips = venue_zip_tokens(row.zip_code, row.description)
        city_tokens = venue_city_tokens(row.city, row.description)
    else:
        combined = row_text(row, "place_name", "Place Name", "address", "Address", "city", "City", "zip", "Zip", "notes")
        street = extract_street_address(combined)
        zips = venue_zip_tokens(combined)
        city_tokens = venue_city_tokens(row.get("city"), row.get("City"), combined)
    if not street:
        return ""
    place = next(iter(sorted(zips or city_tokens)), "")
    return f"{street}|{place}"


def likely_same_venue(row: dict[str, str], event: ScrapedArtistEvent) -> bool:
    row_name = clean(row.get("place_name") or row.get("Place Name"))
    row_city_values = [row.get("city"), row.get("City"), row.get("address"), row.get("Address"), row.get("zip"), row.get("Zip")]
    row_canonical = canonical_venue_name(row_name)
    event_canonical = canonical_venue_name(event.venue_name)
    if not row_canonical or not event_canonical:
        return False
    name_match = row_canonical == event_canonical or row_canonical in event_canonical or event_canonical in row_canonical
    if not name_match:
        return False
    city_overlap = bool(venue_city_tokens(event.city) & venue_city_tokens(*row_city_values))
    zip_overlap = bool(venue_zip_tokens(event.zip_code, event.description) & venue_zip_tokens(*row_city_values, row_name))
    return city_overlap or zip_overlap


def venue_row_identity(row: dict[str, str]) -> tuple[str, str]:
    name = canonical_venue_name(row.get("place_name") or row.get("Place Name"))
    combined = row_text(row, "place_name", "Place Name", "address", "Address", "city", "City", "zip", "Zip")
    zips = sorted(venue_zip_tokens(combined))
    cities = sorted(venue_city_tokens(row.get("city"), row.get("City"), row.get("address"), row.get("Address")))
    place = zips[0] if zips else (cities[0] if cities else "")
    return name, place


def venue_row_score(row: dict[str, str]) -> int:
    source = clean(row.get("source")).lower()
    score = 0
    if source and source not in SCRAPER_VENUE_SOURCES:
        score += 100
    if clean(row.get("source_place_id")):
        score += 40
    if extract_street_address(row_text(row, "place_name", "address", "notes")):
        score += 20
    if clean(row.get("longitude")) and clean(row.get("latitude")):
        score += 20
    for key in ["email_contact", "phone_number", "contact_name", "website"]:
        if clean(row.get(key)):
            score += 5
    return score


def is_scraper_venue(row: dict[str, str]) -> bool:
    return clean(row.get("source")).lower() in SCRAPER_VENUE_SOURCES


def is_non_venue_name(value: object) -> bool:
    return norm(value) in NON_VENUE_NAMES


def should_materialize_venue(event: ScrapedArtistEvent) -> bool:
    return bool(clean(event.venue_name)) and not is_non_venue_name(event.venue_name)


def scraper_row_is_non_venue(row: dict[str, str]) -> bool:
    return is_scraper_venue(row) and is_non_venue_name(row.get("place_name"))


def row_name_similarity(left: dict[str, str], right: dict[str, str]) -> float:
    left_name = canonical_venue_name(left.get("place_name") or left.get("Place Name"))
    right_name = canonical_venue_name(right.get("place_name") or right.get("Place Name"))
    if not left_name or not right_name:
        return 0
    if left_name == right_name:
        return 1
    if left_name in right_name or right_name in left_name:
        return 0.92
    return difflib.SequenceMatcher(None, left_name, right_name).ratio()


def rows_have_place_overlap(left: dict[str, str], right: dict[str, str]) -> bool:
    left_text = row_text(left, "address", "Address", "city", "City", "zip", "Zip")
    right_text = row_text(right, "address", "Address", "city", "City", "zip", "Zip")
    return bool(venue_zip_tokens(left_text) & venue_zip_tokens(right_text)) or bool(
        venue_city_tokens(left.get("city"), left.get("City"), left_text) & venue_city_tokens(right.get("city"), right.get("City"), right_text)
    )


def find_master_venue_alias(row: dict[str, str], masters_by_id: dict[str, dict[str, str]]) -> str:
    city_alias_id = KNOWN_VENUE_CITY_ALIASES.get(
        (canonical_venue_name(row.get("place_name")), norm(row.get("city") or row.get("City")))
    )
    if city_alias_id and city_alias_id in masters_by_id:
        return city_alias_id

    alias_id = KNOWN_VENUE_ALIASES.get(canonical_venue_name(row.get("place_name")))
    if alias_id and alias_id in masters_by_id:
        return alias_id

    row_address = venue_address_fingerprint(row)
    if row_address:
        for master in masters_by_id.values():
            if venue_address_fingerprint(master) == row_address:
                return clean(master.get("venue_id"))

    best_id = ""
    best_score = 0.0
    for master in masters_by_id.values():
        similarity = row_name_similarity(row, master)
        if similarity < 0.72:
            continue
        place_overlap = rows_have_place_overlap(row, master)
        row_place_tokens = venue_city_tokens(row.get("city"), row.get("City"), row.get("address"), row.get("Address"), row.get("zip"), row.get("Zip"))
        master_place_tokens = venue_city_tokens(
            master.get("city"),
            master.get("City"),
            master.get("address"),
            master.get("Address"),
            master.get("zip"),
            master.get("Zip"),
        )
        if not place_overlap and row_place_tokens and master_place_tokens:
            continue
        if not place_overlap and similarity < 0.98:
            continue
        score = similarity + (0.25 if place_overlap else 0)
        if score > best_score:
            best_score = score
            best_id = clean(master.get("venue_id"))
    return best_id


def enrich_known_new_venue(row: dict[str, str]) -> None:
    row_key = canonical_venue_name(row.get("place_name"))
    details = KNOWN_NEW_VENUE_DETAILS.get(row_key)
    if not details:
        for key, value in KNOWN_NEW_VENUE_DETAILS.items():
            if canonical_venue_name(key) == row_key:
                details = value
                break
    if not details:
        return
    for key, value in details.items():
        row[key] = value
    row["state"] = row.get("state") or "OH"
    row["active_live_music"] = row.get("active_live_music") or "yes"
    row["crm_status"] = row.get("crm_status") or "Needs Review"
    note = "Known new venue; address filled from public venue listing."
    existing_notes = clean(row.get("notes"))
    row["notes"] = existing_notes if note in existing_notes else clean(" | ".join(part for part in [existing_notes, note] if clean(part)))


def dedupe_venues_by_identity(venues_by_id: dict[str, dict[str, str]]) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    groups: dict[tuple[str, str], list[dict[str, str]]] = {}
    for row in venues_by_id.values():
        identity = venue_row_identity(row)
        if len(identity[0]) < 3 or not identity[1]:
            continue
        groups.setdefault(identity, []).append(row)

    aliases: dict[str, str] = {}
    for rows in groups.values():
        if len(rows) < 2:
            continue
        primary = max(rows, key=venue_row_score)
        primary_id = clean(primary.get("venue_id"))
        for row in rows:
            venue_id = clean(row.get("venue_id"))
            if venue_id and venue_id != primary_id:
                aliases[venue_id] = primary_id

    masters_by_id = {
        venue_id: row
        for venue_id, row in venues_by_id.items()
        if clean(row.get("source")).lower() not in SCRAPER_VENUE_SOURCES
    }
    for venue_id, row in list(venues_by_id.items()):
        if not is_scraper_venue(row):
            continue
        if scraper_row_is_non_venue(row):
            aliases[venue_id] = ""
            continue
        master_id = find_master_venue_alias(row, masters_by_id)
        if master_id:
            aliases[venue_id] = master_id

    for alias_id in aliases:
        venues_by_id.pop(alias_id, None)
    for row in venues_by_id.values():
        if is_scraper_venue(row):
            enrich_known_new_venue(row)
    return venues_by_id, aliases


def match_venue_id(venues: list[dict[str, str]], event: ScrapedArtistEvent) -> str:
    if not should_materialize_venue(event):
        return ""
    city_alias_id = KNOWN_VENUE_CITY_ALIASES.get((canonical_venue_name(event.venue_name), norm(event.city)))
    if city_alias_id and any(clean(row.get("venue_id") or row.get("Place ID")) == city_alias_id for row in venues):
        return city_alias_id
    alias_id = KNOWN_VENUE_ALIASES.get(canonical_venue_name(event.venue_name))
    if alias_id and any(clean(row.get("venue_id") or row.get("Place ID")) == alias_id for row in venues):
        return alias_id
    by_name: dict[str, list[dict[str, str]]] = {}
    for row in venues:
        by_name.setdefault(norm(row.get("place_name") or row.get("Place Name")), []).append(row)
    candidates = [
        norm(event.venue_name),
        norm(f"{event.venue_name} {event.city}"),
        norm(f"The {event.venue_name}"),
    ]
    for candidate in candidates:
        for row in by_name.get(candidate, []):
            row_city = norm(row.get("city") or row.get("City"))
            if not row_city or not norm(event.city) or row_city == norm(event.city):
                return clean(row.get("venue_id") or row.get("Place ID"))
    event_address = venue_address_fingerprint(event)
    if event_address:
        for row in venues:
            if venue_address_fingerprint(row) == event_address:
                return clean(row.get("venue_id") or row.get("Place ID"))
    for row in venues:
        name = norm(row.get("place_name") or row.get("Place Name"))
        city = norm(row.get("city") or row.get("City"))
        if name and (name in norm(event.venue_name) or norm(event.venue_name) in name) and (not city or city == norm(event.city)):
            return clean(row.get("venue_id") or row.get("Place ID"))
    for row in venues:
        if likely_same_venue(row, event):
            return clean(row.get("venue_id") or row.get("Place ID"))
    return ""


def add_missing_venue(venues_by_id: dict[str, dict[str, str]], event: ScrapedArtistEvent) -> str:
    if not should_materialize_venue(event):
        return ""
    venue_id = make_id("venue", event.venue_name, event.city, event.state)
    if venue_id not in venues_by_id:
        venues_by_id[venue_id] = {
            "venue_id": venue_id,
            "place_name": event.venue_name,
            "address": extract_display_street_address(event.description),
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


def get_or_create_missing_venue(venues_by_id: dict[str, dict[str, str]], event: ScrapedArtistEvent) -> tuple[str, bool]:
    venue_id = make_id("venue", event.venue_name, event.city, event.state)
    existed = venue_id in venues_by_id
    created_id = add_missing_venue(venues_by_id, event)
    if created_id and created_id in venues_by_id:
        enrich_known_new_venue(venues_by_id[created_id])
    return created_id, bool(created_id and not existed)


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
    venues_by_id, venue_aliases = dedupe_venues_by_identity(venues_by_id)
    artists_by_id = row_by_key(artists, "artist_id")
    events_by_id = row_by_key(events, "event_id")
    for row in events_by_id.values():
        venue_id = clean(row.get("venue_id"))
        if venue_id in venue_aliases:
            row["venue_id"] = venue_aliases[venue_id]
    event_artists_by_id = row_by_key(event_artists, "event_artist_id")
    history_by_key: dict[str, dict[str, str]] = {}
    for row in history:
        venue_id = venue_aliases.get(clean(row.get("venue_id")), clean(row.get("venue_id")))
        artist_id = clean(row.get("artist_id"))
        if not venue_id or not artist_id:
            continue
        history_by_key[f"{venue_id}|{artist_id}"] = {
            **row,
            "venue_id": venue_id,
            "venue_name": clean(venues_by_id.get(venue_id, {}).get("place_name")) or clean(row.get("venue_name")),
        }
    reviews_by_id = row_by_key(reviews, "review_id")

    scraped = scrape.events
    scraped_by_event_id = {event.event_id: event for event in scraped}
    added = 0
    updated = 0
    canceled = 0
    rescheduled = 0
    new_venue_alerts: dict[str, dict[str, object]] = {}

    for item in scraped:
        venue_id = match_venue_id(list(venues_by_id.values()), item)
        if not venue_id and should_materialize_venue(item):
            venue_id, created_venue = get_or_create_missing_venue(venues_by_id, item)
            upsert_review(reviews_by_id, item, "Artist-site event venue needs master venue confirmation.")
            if created_venue:
                venue = venues_by_id.get(venue_id, {})
                new_venue_alerts[venue_id] = {
                    "venue_id": venue_id,
                    "venue_name": clean(venue.get("place_name")) or item.venue_name,
                    "city": clean(venue.get("city")) or item.city,
                    "state": clean(venue.get("state")) or item.state,
                    "address": clean(venue.get("address")),
                    "artist_names": set(),
                    "event_dates": set(),
                    "source_url": item.source_url,
                }

        if venue_id in new_venue_alerts:
            new_venue_alerts[venue_id]["artist_names"].add(item.artist_name)  # type: ignore[union-attr]
            new_venue_alerts[venue_id]["event_dates"].add(item.event_date)  # type: ignore[union-attr]

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

        if venue_id:
            hkey = f"{venue_id}|{item.artist_id}"
            hrow = history_by_key.setdefault(
                hkey,
                {
                    "venue_id": venue_id,
                    "venue_name": clean(venues_by_id.get(venue_id, {}).get("place_name")) or item.venue_name,
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

    for review_id, review in list(reviews_by_id.items()):
        if clean(review.get("review_type")) != "venue_match":
            continue
        event = events_by_id.get(clean(review.get("related_id")))
        if not event:
            continue
        venue = venues_by_id.get(clean(event.get("venue_id")))
        if not venue:
            continue
        venue_source = clean(venue.get("source")).lower()
        if venue_source not in {"artist_site_sync", "furious_george_website"}:
            del reviews_by_id[review_id]

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
            "new_venue_count": len(new_venue_alerts),
            "new_venues": [
                {
                    **alert,
                    "artist_names": sorted(alert["artist_names"]),  # type: ignore[index]
                    "event_dates": sorted(alert["event_dates"]),  # type: ignore[index]
                }
                for alert in sorted(new_venue_alerts.values(), key=lambda item: clean(item.get("venue_name")).lower())
            ],
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


def apple_string(value: object) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def send_message_via_service(body: str, recipient: str, service_type: str) -> str:
    service_test = "SMS" if service_type == "SMS" else "iMessage"
    script = f"""
        set alertBody to {apple_string(body)}
        set targetNumber to {apple_string(recipient)}

        tell application "Messages"
            set selectedService to missing value
            repeat with svc in services
                try
                    if service type of svc is {service_test} then
                        set selectedService to svc
                        exit repeat
                    end if
                end try
            end repeat
            if selectedService is missing value then error "No {service_type} service is available."
            send alertBody to buddy targetNumber of selectedService
        end tell
        return "{service_type}"
    """
    result = subprocess.run(["osascript", "-e", script], check=True, capture_output=True, text=True, timeout=30)
    return clean(result.stdout)


def send_text_message(body: str, recipients: list[str], logger: logging.Logger) -> list[str]:
    sent: list[str] = []
    for recipient in recipients:
        errors: list[str] = []
        for service_type in SERVICE_PRIORITY:
            try:
                service = send_message_via_service(body, recipient, service_type)
                sent.append(f"{recipient}:{service}")
                break
            except Exception as exc:
                errors.append(f"{service_type} {exc}")
        else:
            logger.warning("Could not send new venue text to %s: %s", recipient, "; ".join(errors))
    return sent


def format_alert_date(value: object) -> str:
    parsed = parse_iso(value)
    if not parsed:
        return clean(value)
    return parsed.strftime("%a %b %-d") if sys.platform == "darwin" else parsed.strftime("%a %b %d")


def build_new_venue_text(new_venues: list[dict[str, object]], app_url: str = DEFAULT_APP_URL) -> str:
    if not new_venues:
        return ""
    intro = f"New venue lead{'s' if len(new_venues) != 1 else ''} found in the gig tracker:"
    lines = [intro]
    for venue in new_venues[:8]:
        name = clean(venue.get("venue_name")) or "Unknown venue"
        place = clean(", ".join(part for part in [clean(venue.get("city")), clean(venue.get("state"))] if part))
        artists = ", ".join(clean(name) for name in venue.get("artist_names", []) if clean(name)) or "artist TBD"
        dates = ", ".join(format_alert_date(value) for value in venue.get("event_dates", []) if clean(value)) or "date TBD"
        address = clean(venue.get("address"))
        location = f" ({place})" if place else ""
        address_text = f" - {address}" if address else ""
        lines.append(f"- {name}{location}{address_text}: {artists} on {dates}")
    if len(new_venues) > 8:
        lines.append(f"...and {len(new_venues) - 8} more.")
    lines.append(app_url)
    return "\n".join(lines)


def get_text_recipients(args: argparse.Namespace) -> list[str]:
    raw: list[str] = []
    if args.text_recipient:
        raw.extend(args.text_recipient)
    env_value = os.environ.get("JDDM_NEW_VENUE_TEXT_RECIPIENTS")
    if env_value:
        raw.extend(re.split(r"[,\n;|]+", env_value))
    if not raw:
        raw = DEFAULT_TEXT_RECIPIENTS[:]
    return list(dict.fromkeys(normalize_phone(value) for value in raw if normalize_phone(value)))


def maybe_send_new_venue_alert(summary: dict[str, object], args: argparse.Namespace, logger: logging.Logger) -> None:
    new_venues = summary.get("new_venues")
    if args.no_new_venue_text or not isinstance(new_venues, list) or not new_venues:
        return
    body = build_new_venue_text(new_venues, app_url=args.app_url)
    recipients = get_text_recipients(args)
    if not recipients or not body:
        return
    sent = send_text_message(body, recipients, logger)
    if sent:
        logger.info("Sent new venue text alert to %s", ", ".join(sent))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync artist website calendars into the master gig tracker.")
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--import-google-sheet", action="store_true", help="Replace live tracker tabs with repaired CSVs via logged-in Chrome.")
    parser.add_argument("--dry-run", action="store_true", help="Build output files but do not import into Google Sheets.")
    parser.add_argument("--no-new-venue-text", action="store_true", help="Do not text when new venues are created.")
    parser.add_argument("--text-recipient", action="append", default=[], help="Phone number to text when new venues are found. Defaults to Carter and Dee Dee.")
    parser.add_argument("--app-url", default=DEFAULT_APP_URL)
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
        maybe_send_new_venue_alert(summary, args, logger)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
