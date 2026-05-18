#!/usr/bin/env python3
"""
Northeast Ohio same-day live music scraper.

This scraper uses Google Search with a past-24-hours filter, visits the most
relevant result pages, extracts event-like details, stores deduped rows in
SQLite, exports a fresh CSV spreadsheet, and can text a short summary from the
local Mac Messages account.

Notes:
- This intentionally does not solve CAPTCHAs or bypass access controls.
- Keep query volume low. Google can throttle automated searches.
- Proxy support: pass --proxy-server http://user:pass@host:port if your
  environment requires an outbound proxy.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import math
import os
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote_plus, urlparse

try:
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except Exception:  # pragma: no cover - handled at runtime with a clear message.
    PlaywrightTimeoutError = None
    sync_playwright = None


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "scraped" / "neo_live_music.sqlite3"
DEFAULT_EXPORT_DIR = REPO_ROOT / "data" / "scraped" / "live_music"
DEFAULT_USER_DATA_DIR = Path.home() / "Library" / "Application Support" / "Just Dee Dee Music Map" / "neo-live-music-browser"
LOG_PATH = Path.home() / "Library" / "Logs" / "neo-live-music-scraper.log"
MESSAGES_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"

CARTER_PHONE = "+14403054062"
CLEVELAND = (41.4993, -81.6944)
MAX_RADIUS_MILES = 80.0

MUSIC_TERMS = re.compile(
    r"\b(live music|gig|gigs|concert|show|shows|performance|performing|"
    r"band|musician|singer|songwriter|acoustic|open mic|jazz|rock|country|"
    r"folk|blues|tribute|dj|lineup)\b",
    re.I,
)

NEGATIVE_TERMS = re.compile(
    r"\b(movie|film|theater auditions|broadway|orchestra season tickets|"
    r"job posting|jobs|sports|webinar|class|lesson|church service)\b",
    re.I,
)

TODAY_TERMS = re.compile(r"\b(today|tonight|this evening|live tonight|happening now)\b", re.I)

LOCATION_POINTS: dict[str, tuple[float, float]] = {
    "cleveland": (41.4993, -81.6944),
    "akron": (41.0814, -81.5190),
    "parma": (41.4048, -81.7229),
    "elyria": (41.3684, -82.1076),
    "lorain": (41.4528, -82.1824),
    "lakewood": (41.4819, -81.7982),
    "mentor": (41.6662, -81.3396),
    "willoughby": (41.6398, -81.4065),
    "painesville": (41.7245, -81.2457),
    "chardon": (41.5792, -81.2081),
    "medina": (41.1384, -81.8637),
    "brunswick": (41.2381, -81.8418),
    "strongsville": (41.3145, -81.8357),
    "solon": (41.3898, -81.4412),
    "kent": (41.1537, -81.3579),
    "ravenna": (41.1576, -81.2420),
    "canton": (40.7989, -81.3784),
    "massillon": (40.7967, -81.5215),
    "wooster": (40.8051, -81.9351),
    "youngstown": (41.0998, -80.6495),
    "warren": (41.2376, -80.8184),
    "sandusky": (41.4489, -82.7079),
    "norwalk": (41.2426, -82.6157),
    "ashtabula": (41.8651, -80.7898),
}

COUNTY_TERMS = {
    "cuyahoga county",
    "lake county",
    "geauga county",
    "lorain county",
    "medina county",
    "summit county",
    "portage county",
    "stark county",
    "wayne county",
    "trumbull county",
    "mahoning county",
    "erie county",
    "ashtabula county",
}

VENUE_HINTS = [
    "Beachland Ballroom",
    "Grog Shop",
    "House of Blues Cleveland",
    "Music Box Supper Club",
    "Happy Dog Cleveland",
    "Bop Stop Cleveland",
    "Jilly's Music Room Akron",
    "The Kent Stage",
    "The Winchester Lakewood",
]

DIRECT_SOURCES = [
    {
        "name": "Grog Shop",
        "url": "https://grogshop.gs/",
        "venue": "Grog Shop",
        "city": "Cleveland Heights",
        "address": "2785 Euclid Heights Blvd, Cleveland Heights, OH 44106",
    },
    {
        "name": "Jolene's",
        "url": "https://www.jolenescleveland.com/live-music",
        "venue": "Jolene's",
        "city": "Cleveland",
        "address": "2038 E 4th St, Cleveland, OH 44115",
    },
    {
        "name": "Brothers Lounge",
        "url": "https://brotherslounge.com/",
        "venue": "The Brothers Lounge",
        "city": "Cleveland",
        "address": "11609 Detroit Ave, Cleveland, OH 44102",
    },
]


@dataclass
class SearchResult:
    source: str
    query_used: str
    title: str
    url: str
    raw_snippet: str = ""
    result_date: str = ""
    visible_location: str = ""


@dataclass
class EventRecord:
    source: str
    query_used: str
    title: str
    url: str
    event_date: str = ""
    event_time: str = ""
    venue: str = ""
    address: str = ""
    city: str = ""
    bands: str = ""
    ticket_info: str = ""
    description: str = ""
    image_urls: str = ""
    scraped_at: str = ""
    raw_snippet: str = ""
    location_match: str = ""
    distance_miles: float | None = None
    relevance_score: int = 0


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def haversine_miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    radius = 3958.8
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    x = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def find_location(text: str) -> tuple[str, float | None]:
    haystack = normalize_key(text)
    for county in COUNTY_TERMS:
        if county in haystack:
            return county.title(), 0.0
    best: tuple[str, float] | None = None
    for city, point in LOCATION_POINTS.items():
        if re.search(rf"\b{re.escape(city)}\b", haystack):
            distance = haversine_miles(CLEVELAND, point)
            if best is None or distance < best[1]:
                best = (city.title(), distance)
    return best if best else ("", None)


def is_neohio(text: str) -> tuple[bool, str, float | None]:
    location, distance = find_location(text)
    if not location:
        return False, "", None
    return distance is None or distance <= MAX_RADIUS_MILES, location, distance


def parse_event_datetime(text: str) -> tuple[str, str]:
    text = clean(text)
    today = date.today()

    time_match = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text, re.I)
    event_time = ""
    if time_match:
        event_time = f"{time_match.group(1)}:{time_match.group(2) or '00'} {time_match.group(3).upper()}"

    if TODAY_TERMS.search(text):
        return today.isoformat(), event_time

    month_match = re.search(
        r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\b",
        text,
        re.I,
    )
    if month_match:
        month_name, day_text, year_text = month_match.groups()
        month = datetime.strptime(month_name[:3].title(), "%b").month
        year = int(year_text or today.year)
        parsed = date(year, month, int(day_text))
        if parsed < today - timedelta(days=2) and not year_text:
            parsed = date(today.year + 1, month, int(day_text))
        return parsed.isoformat(), event_time

    slash_match = re.search(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", text)
    if slash_match:
        month, day, year = slash_match.groups()
        year_num = int(year) if year else today.year
        if year and year_num < 100:
            year_num += 2000
        return date(year_num, int(month), int(day)).isoformat(), event_time

    return "", event_time


def is_same_day_candidate(record: EventRecord) -> bool:
    body = " ".join([record.title, record.description, record.raw_snippet])
    if TODAY_TERMS.search(body):
        return True
    if not record.event_date:
        return False
    event_day = date.fromisoformat(record.event_date)
    return event_day == date.today()


def relevance_score(text: str) -> int:
    text = clean(text)
    score = 0
    if MUSIC_TERMS.search(text):
        score += 5
    if TODAY_TERMS.search(text):
        score += 4
    if re.search(r"\bcleveland|akron|lake county|parma|elyria|lorain|mentor|youngstown\b", text, re.I):
        score += 3
    if re.search(r"\b(ticket|tickets|doors|venue|calendar|event|events)\b", text, re.I):
        score += 2
    if NEGATIVE_TERMS.search(text):
        score -= 5
    return score


def build_queries(keywords: list[str]) -> list[str]:
    base_places = 'Cleveland OR Akron OR "Lake County" OR Parma OR Elyria OR Lorain OR Mentor OR Youngstown'
    queries = [
        f'"live music" {base_places} gig OR concert OR show OR performance today',
        f'"Cleveland gigs today" live music concert show',
        f'"Akron live music today" gig concert show',
        f'"Northeast Ohio" "live music" today',
        f'"Lake County" Ohio "live music" tonight',
        f'"Lorain County" "live music" tonight',
    ]
    queries.extend(f'"{venue}" live music today OR tonight' for venue in VENUE_HINTS)
    queries.extend(f'"{keyword}" Cleveland Akron live music today gig show' for keyword in keywords)
    return list(dict.fromkeys(queries))


def fetch_google_news_rss(query: str, logger: logging.Logger) -> list[SearchResult]:
    """Fallback when Google SERP presents a challenge.

    It is still Google-owned data, has a past-day query operator, and does not
    require solving a CAPTCHA. It is narrower than full web search, so regular
    Playwright SERP remains the primary path.
    """
    url = (
        "https://news.google.com/rss/search?q="
        + quote_plus(f"{query} when:1d")
        + "&hl=en-US&gl=US&ceid=US:en"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            xml_text = response.read().decode("utf-8", errors="replace")
    except Exception as exc:
        logger.warning("Google News RSS fallback failed for %s: %s", query, exc)
        return []

    parsed: list[SearchResult] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        logger.warning("Google News RSS parse failed for %s: %s", query, exc)
        return []

    for item in root.findall("./channel/item")[:20]:
        title = clean(item.findtext("title"))
        link = clean(item.findtext("link"))
        description = re.sub(r"<[^>]+>", " ", item.findtext("description") or "")
        description = clean(description)
        location, _ = find_location(" ".join([title, description]))
        event_date, _ = parse_event_datetime(" ".join([title, description]))
        if title and link:
            parsed.append(
                SearchResult(
                    source="google_news_rss",
                    query_used=query,
                    title=title,
                    url=link,
                    raw_snippet=description[:1200],
                    result_date=event_date,
                    visible_location=location,
                )
            )
    return parsed


def today_markers() -> dict[str, str]:
    today = date.today()
    return {
        "iso": today.isoformat(),
        "day": str(today.day),
        "abbr": today.strftime("%a, %b ") + str(today.day),
        "long": today.strftime("%A, %B ") + str(today.day),
        "month_year": today.strftime("%B %Y"),
    }


def event_url(source_url: str, title: str, event_date: str) -> str:
    key = hashlib.sha256(f"{source_url}|{title}|{event_date}".encode("utf-8")).hexdigest()[:12]
    return f"{source_url}#event-{key}"


def make_direct_event(source: dict[str, str], title: str, event_time: str, description: str) -> EventRecord:
    title = clean(title)
    description = clean(description)
    city = source["city"]
    _, distance = find_location(city)
    return EventRecord(
        source=f"direct:{source['name']}",
        query_used="direct venue calendar fallback",
        title=title,
        url=event_url(source["url"], title, date.today().isoformat()),
        event_date=date.today().isoformat(),
        event_time=event_time,
        venue=source["venue"],
        address=source["address"],
        city=city,
        bands=title,
        ticket_info="",
        description=description[:1200],
        image_urls="",
        scraped_at=datetime.now().isoformat(timespec="seconds"),
        raw_snippet=description[:1200],
        location_match=city,
        distance_miles=round(distance, 1) if distance is not None else None,
        relevance_score=max(8, relevance_score(" ".join([title, description, city, "live music"]))),
    )


def parse_grog_events(text: str, source: dict[str, str]) -> list[EventRecord]:
    markers = today_markers()
    pattern = re.compile(
        rf"(?P<title>[A-Z0-9][A-Z0-9 '&/.,:+()\\-]+?)\n"
        rf"(?:(?P<support>w/ [^\n]+)\n)?"
        rf"{re.escape(source['venue'])}\n"
        rf"SUN, MAY {markers['day']}\n"
        rf"(?P<time>[^\n]*(?:Show|Doors)[^\n]*)",
        re.I,
    )
    events = []
    for match in pattern.finditer(text):
        title = clean(match.group("title"))
        support = clean(match.group("support"))
        time_text = clean(match.group("time"))
        _, event_time = parse_event_datetime(time_text)
        events.append(make_direct_event(source, title, event_time, " ".join(x for x in [support, time_text] if x)))
    return events


def parse_jolenes_events(text: str, source: dict[str, str]) -> list[EventRecord]:
    markers = today_markers()
    all_lines = [clean(line) for line in text.splitlines() if clean(line)]
    try:
        start = all_lines.index(markers["day"]) + 1
    except ValueError:
        return []
    lines = []
    for line in all_lines[start:]:
        if re.fullmatch(r"\d{1,2}", line) or line.lower().startswith("want to play"):
            break
        lines.append(line)
    events = []
    index = 0
    while index < len(lines) - 1:
        if re.match(r"^\d{1,2}:\d{2}\s*(?:AM|PM)$", lines[index], re.I):
            event_time = lines[index].upper()
            title = lines[index + 1]
            if not re.match(r"^\d{1,2}:\d{2}\s*(?:AM|PM)$", title, re.I):
                events.append(make_direct_event(source, title, event_time, f"{title} at {source['venue']} {event_time}"))
            index += 2
        else:
            index += 1
    return events


def parse_brothers_events(text: str, source: dict[str, str]) -> list[EventRecord]:
    markers = today_markers()
    # Squarespace calendar text has day-number blocks. Capture today's block
    # and look for time/title pairs inside it.
    all_lines = [clean(line) for line in text.splitlines() if clean(line)]
    try:
        start = all_lines.index(markers["day"]) + 1
    except ValueError:
        return []
    lines = []
    for line in all_lines[start:]:
        if re.fullmatch(r"\d{1,2}", line):
            break
        lines.append(line)
    events = []
    for index, line in enumerate(lines):
        if re.search(r"\d{1,2}:\d{2}\s*(?:AM|PM)", line, re.I) and index > 0:
            title = lines[index - 1]
            if not re.search(r"https?://|doors|tickets?", title, re.I):
                _, event_time = parse_event_datetime(line)
                events.append(make_direct_event(source, title, event_time, f"{title} at {source['venue']} {line}"))
    return events


def init_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            query_used TEXT,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            event_date TEXT,
            event_time TEXT,
            venue TEXT,
            address TEXT,
            city TEXT,
            bands TEXT,
            ticket_info TEXT,
            description TEXT,
            image_urls TEXT,
            scraped_at TEXT NOT NULL,
            raw_snippet TEXT,
            location_match TEXT,
            distance_miles REAL,
            relevance_score INTEGER DEFAULT 0,
            title_date_key TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_url ON events(url)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_title_date ON events(title_date_key)")
    return conn


def upsert_event(conn: sqlite3.Connection, event: EventRecord) -> None:
    row = asdict(event)
    row["title_date_key"] = hashlib.sha256(
        f"{normalize_key(event.title)}|{event.event_date or 'undated'}".encode("utf-8")
    ).hexdigest()
    conn.execute(
        """
        INSERT INTO events (
            source, query_used, title, url, event_date, event_time, venue, address,
            city, bands, ticket_info, description, image_urls, scraped_at,
            raw_snippet, location_match, distance_miles, relevance_score, title_date_key
        ) VALUES (
            :source, :query_used, :title, :url, :event_date, :event_time, :venue, :address,
            :city, :bands, :ticket_info, :description, :image_urls, :scraped_at,
            :raw_snippet, :location_match, :distance_miles, :relevance_score, :title_date_key
        )
        ON CONFLICT(url) DO UPDATE SET
            event_date=excluded.event_date,
            event_time=excluded.event_time,
            venue=excluded.venue,
            address=excluded.address,
            city=excluded.city,
            bands=excluded.bands,
            ticket_info=excluded.ticket_info,
            description=excluded.description,
            image_urls=excluded.image_urls,
            scraped_at=excluded.scraped_at,
            raw_snippet=excluded.raw_snippet,
            location_match=excluded.location_match,
            distance_miles=excluded.distance_miles,
            relevance_score=excluded.relevance_score,
            updated_at=CURRENT_TIMESTAMP
        """,
        row,
    )
    conn.commit()


def export_csv(events: list[EventRecord], export_dir: Path) -> Path:
    export_dir.mkdir(parents=True, exist_ok=True)
    path = export_dir / f"neo_live_music_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    fields = list(asdict(events[0]).keys()) if events else [field.name for field in EventRecord.__dataclass_fields__.values()]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for event in events:
            writer.writerow(asdict(event))
    latest = export_dir / "neo_live_music_latest.csv"
    latest.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    return path


class GoogleLiveMusicScraper:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.logger = logging.getLogger("neo_live_music")

    def sleep(self, low: float = 0.8, high: float = 2.4) -> None:
        time.sleep(random.uniform(low, high))

    def google_url(self, query: str) -> str:
        return f"https://www.google.com/search?q={quote_plus(query)}&num={self.args.num_results}&tbs=qdr:d&hl=en"

    def run(self) -> list[EventRecord]:
        if sync_playwright is None:
            raise RuntimeError(
                "Python Playwright is not installed. Run: python3 -m pip install playwright && python3 -m playwright install chromium"
            )

        results: list[SearchResult] = []
        events: list[EventRecord] = []
        seen_urls: set[str] = set()

        with sync_playwright() as p:
            launch_options: dict[str, Any] = {
                "headless": self.args.headless,
            }
            if self.args.proxy_server:
                launch_options["proxy"] = {"server": self.args.proxy_server}
            if self.args.browser_channel:
                launch_options["channel"] = self.args.browser_channel

            context_options: dict[str, Any] = {
                "viewport": {"width": random.randint(1280, 1480), "height": random.randint(820, 980)},
                "locale": "en-US",
                "timezone_id": "America/New_York",
                "user_agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36"
                ),
            }

            browser = None
            if self.args.user_data_dir:
                Path(self.args.user_data_dir).expanduser().mkdir(parents=True, exist_ok=True)
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(Path(self.args.user_data_dir).expanduser()),
                    **launch_options,
                    **context_options,
                )
            else:
                browser = p.chromium.launch(**launch_options)
                context = browser.new_context(**context_options)
            page = context.new_page()

            if self.args.interactive_setup:
                page.goto("https://www.google.com/search?q=live+music+Cleveland+today&tbs=qdr:d", wait_until="domcontentloaded", timeout=30000)
                print("Chrome setup is open. If Google asks, solve the check manually, then press Enter here.")
                input()
                context.close()
                return []

            for query in build_queries(self.args.keywords)[: self.args.max_queries]:
                try:
                    self.logger.info("Google query: %s", query)
                    page.goto(self.google_url(query), wait_until="domcontentloaded", timeout=30000)
                    self.sleep(1.5, 3.5)
                    if self.is_blocked(page):
                        self.logger.warning("Google blocked or challenged this SERP; using Google News RSS fallback.")
                        if self.args.rss_fallback:
                            results.extend(fetch_google_news_rss(query, self.logger))
                        continue
                    query_results = self.extract_google_results(page, query)
                    self.logger.info("Found %d raw Google results", len(query_results))
                    results.extend(query_results)
                except Exception as exc:
                    self.logger.exception("Query failed: %s (%s)", query, exc)
                    if self.args.rss_fallback:
                        results.extend(fetch_google_news_rss(query, self.logger))
                self.sleep(2.0, 5.0)

            ranked = sorted(results, key=lambda result: relevance_score(" ".join([result.title, result.raw_snippet])), reverse=True)
            for result in ranked:
                if len(events) >= self.args.max_events:
                    break
                if result.url in seen_urls:
                    continue
                seen_urls.add(result.url)
                if not self.is_relevant_search_result(result):
                    continue
                try:
                    event = self.scrape_result_page(page, result)
                    if event and self.accept_event(event):
                        events.append(event)
                except Exception as exc:
                    self.logger.warning("Page scrape failed for %s: %s", result.url, exc)
                self.sleep(1.5, 4.5)

            direct_events = self.scrape_direct_sources(page)
            for event in direct_events:
                if len(events) >= self.args.max_events:
                    break
                if event.url not in seen_urls and self.accept_event(event):
                    seen_urls.add(event.url)
                    events.append(event)

            context.close()
            if browser is not None:
                browser.close()

        return events

    def is_blocked(self, page: Any) -> bool:
        text = clean(page.evaluate("document.body ? document.body.innerText : ''")).lower()
        return "unusual traffic" in text or "our systems have detected" in text or "captcha" in text

    def extract_google_results(self, page: Any, query: str) -> list[SearchResult]:
        items = page.evaluate(
            """
            () => Array.from(document.querySelectorAll('a'))
                .map(a => {
                    const href = a.href || '';
                    const title = (a.querySelector('h3')?.innerText || '').trim();
                    const container = a.closest('div');
                    const snippet = (container?.innerText || '').trim();
                    return { href, title, snippet };
                })
                .filter(item => item.title && item.href.startsWith('http') && !item.href.includes('/search?'))
                .slice(0, 40)
            """
        )
        parsed: list[SearchResult] = []
        for item in items:
            url = clean(item.get("href"))
            if "google.com" in urlparse(url).netloc:
                continue
            snippet = clean(item.get("snippet"))
            location, _ = find_location(" ".join([item.get("title", ""), snippet]))
            result_date, _ = parse_event_datetime(snippet)
            parsed.append(
                SearchResult(
                    source="google",
                    query_used=query,
                    title=clean(item.get("title")),
                    url=url,
                    raw_snippet=snippet[:1200],
                    result_date=result_date,
                    visible_location=location,
                )
            )
        return parsed

    def is_relevant_search_result(self, result: SearchResult) -> bool:
        text = " ".join([result.title, result.raw_snippet])
        if relevance_score(text) < self.args.min_score:
            return False
        in_area, _, _ = is_neohio(text)
        return in_area

    def scrape_result_page(self, page: Any, result: SearchResult) -> EventRecord | None:
        self.logger.info("Scraping page: %s", result.url)
        page.goto(result.url, wait_until="domcontentloaded", timeout=35000)
        self.sleep(1.0, 2.4)

        title = clean(page.title()) or result.title
        body_text = clean(page.evaluate("document.body ? document.body.innerText : ''"))[:12000]
        meta = self.extract_meta(page)
        jsonld = self.extract_jsonld(page)
        merged_text = " ".join([title, result.raw_snippet, meta.get("description", ""), body_text[:5000]])

        event_date, event_time = self.pick_date_time(merged_text, jsonld)
        location_match, distance = find_location(merged_text)
        venue = self.pick_venue(title, body_text, jsonld)
        bands = self.pick_bands(title, body_text, jsonld)
        address, city = self.pick_address(merged_text, jsonld)
        images = self.pick_images(page, meta, jsonld)
        ticket_info = self.pick_ticket_info(body_text, jsonld)
        description = clean(meta.get("description") or body_text[:500])

        return EventRecord(
            source=result.source,
            query_used=result.query_used,
            title=title or result.title,
            url=result.url,
            event_date=event_date or result.result_date,
            event_time=event_time,
            venue=venue,
            address=address,
            city=city or location_match,
            bands=bands,
            ticket_info=ticket_info,
            description=description[:1200],
            image_urls=" | ".join(images[:5]),
            scraped_at=datetime.now().isoformat(timespec="seconds"),
            raw_snippet=result.raw_snippet,
            location_match=location_match,
            distance_miles=round(distance, 1) if distance is not None else None,
            relevance_score=relevance_score(merged_text),
        )

    def scrape_direct_sources(self, page: Any) -> list[EventRecord]:
        events: list[EventRecord] = []
        parsers = {
            "Grog Shop": parse_grog_events,
            "Jolene's": parse_jolenes_events,
            "Brothers Lounge": parse_brothers_events,
        }
        for source in DIRECT_SOURCES:
            try:
                self.logger.info("Direct source: %s", source["name"])
                page.goto(source["url"], wait_until="domcontentloaded", timeout=35000)
                self.sleep(2.0, 4.0)
                text = page.evaluate("document.body ? document.body.innerText : ''") or ""
                parser = parsers.get(source["name"])
                if parser:
                    source_events = parser(text, source)
                    self.logger.info("Direct source %s yielded %d events", source["name"], len(source_events))
                    events.extend(source_events)
            except Exception as exc:
                self.logger.warning("Direct source failed for %s: %s", source["name"], exc)
        return events

    def extract_meta(self, page: Any) -> dict[str, str]:
        return page.evaluate(
            """
            () => {
                const get = selector => document.querySelector(selector)?.content || '';
                return {
                    description: get('meta[name="description"]') || get('meta[property="og:description"]'),
                    image: get('meta[property="og:image"]'),
                    title: get('meta[property="og:title"]')
                };
            }
            """
        )

    def extract_jsonld(self, page: Any) -> list[dict[str, Any]]:
        raw = page.evaluate(
            """
            () => Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                .map(script => script.textContent || '')
            """
        )
        records: list[dict[str, Any]] = []
        for item in raw:
            try:
                parsed = json.loads(item)
                if isinstance(parsed, list):
                    records.extend(x for x in parsed if isinstance(x, dict))
                elif isinstance(parsed, dict):
                    graph = parsed.get("@graph")
                    if isinstance(graph, list):
                        records.extend(x for x in graph if isinstance(x, dict))
                    records.append(parsed)
            except Exception:
                continue
        return records

    def pick_date_time(self, text: str, jsonld: list[dict[str, Any]]) -> tuple[str, str]:
        for record in jsonld:
            if clean(record.get("@type")).lower() == "event" or "startDate" in record:
                start = clean(record.get("startDate"))
                if start:
                    parsed = start.replace("Z", "+00:00")
                    try:
                        dt = datetime.fromisoformat(parsed)
                        return dt.date().isoformat(), dt.strftime("%-I:%M %p")
                    except Exception:
                        event_date, event_time = parse_event_datetime(start)
                        if event_date:
                            return event_date, event_time
        return parse_event_datetime(text)

    def pick_venue(self, title: str, body_text: str, jsonld: list[dict[str, Any]]) -> str:
        for record in jsonld:
            location = record.get("location")
            if isinstance(location, dict):
                name = clean(location.get("name"))
                if name:
                    return name
        at_match = re.search(r"\b(?:at|@)\s+([A-Z][A-Za-z0-9 '&.-]{2,60})", title)
        if at_match:
            return clean(at_match.group(1))
        line_match = re.search(r"\bVenue[:\s]+([^\n|]{3,80})", body_text, re.I)
        return clean(line_match.group(1)) if line_match else ""

    def pick_bands(self, title: str, body_text: str, jsonld: list[dict[str, Any]]) -> str:
        performers: list[str] = []
        for record in jsonld:
            performer = record.get("performer")
            if isinstance(performer, dict):
                performers.append(clean(performer.get("name")))
            elif isinstance(performer, list):
                performers.extend(clean(item.get("name")) for item in performer if isinstance(item, dict))
        performers = [item for item in performers if item]
        if performers:
            return ", ".join(dict.fromkeys(performers))
        live_match = re.search(r"(.{3,80})\s+(?:live at|at|@)\s+", title, re.I)
        return clean(live_match.group(1)) if live_match else ""

    def pick_address(self, text: str, jsonld: list[dict[str, Any]]) -> tuple[str, str]:
        for record in jsonld:
            location = record.get("location")
            if isinstance(location, dict) and isinstance(location.get("address"), dict):
                address = location["address"]
                street = clean(address.get("streetAddress"))
                city = clean(address.get("addressLocality"))
                region = clean(address.get("addressRegion"))
                postal = clean(address.get("postalCode"))
                return clean(", ".join(x for x in [street, city, region, postal] if x)), city
        address_match = re.search(r"\b\d{2,6}\s+[A-Z][A-Za-z0-9 .'-]+\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Drive|Dr|Ln|Lane)\b[^,\n]*", text)
        location, _ = find_location(text)
        return clean(address_match.group(0)) if address_match else "", location

    def pick_images(self, page: Any, meta: dict[str, str], jsonld: list[dict[str, Any]]) -> list[str]:
        images = [clean(meta.get("image"))]
        for record in jsonld:
            image = record.get("image")
            if isinstance(image, str):
                images.append(clean(image))
            elif isinstance(image, list):
                images.extend(clean(item) for item in image if isinstance(item, str))
        try:
            images.extend(
                page.evaluate(
                    "() => Array.from(document.images).map(img => img.currentSrc || img.src).filter(Boolean).slice(0, 8)"
                )
            )
        except Exception:
            pass
        return list(dict.fromkeys([image for image in images if image.startswith("http")]))

    def pick_ticket_info(self, body_text: str, jsonld: list[dict[str, Any]]) -> str:
        for record in jsonld:
            offers = record.get("offers")
            if isinstance(offers, dict):
                price = clean(offers.get("price"))
                url = clean(offers.get("url"))
                if price or url:
                    return clean(" ".join([f"${price}" if price else "", url]))
        match = re.search(r"\b(?:tickets?|cover|admission)[:\s]+(.{0,120})", body_text, re.I)
        return clean(match.group(0)) if match else ""

    def accept_event(self, event: EventRecord) -> bool:
        text = " ".join([event.title, event.description, event.raw_snippet, event.venue, event.address, event.city])
        if NEGATIVE_TERMS.search(text):
            return False
        in_area, location, distance = is_neohio(text)
        if not in_area:
            return False
        if location and not event.location_match:
            event.location_match = location
            event.distance_miles = round(distance, 1) if distance is not None else event.distance_miles
        if not event.source.startswith("direct:") and not MUSIC_TERMS.search(text):
            return False
        if not is_same_day_candidate(event):
            return False
        return True


def send_text_via_messages(phone: str, body: str) -> None:
    helper = REPO_ROOT / "scripts" / "send-local-message.mjs"
    node_bin = find_node_binary()
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".txt") as handle:
        handle.write(body)
        message_path = handle.name
    try:
        subprocess.run(
            [node_bin, str(helper), "--phone", phone, "--message-file", message_path],
            check=True,
            timeout=120,
        )
    finally:
        try:
            os.unlink(message_path)
        except OSError:
            pass


def find_node_binary() -> str:
    configured = os.environ.get("JDDM_NODE_BIN")
    if configured and Path(configured).exists():
        return configured
    path_node = shutil.which("node")
    if path_node:
        return path_node
    candidates = [
        Path.home() / ".nvm" / "versions" / "node" / "v20.20.2" / "bin" / "node",
        Path("/opt/homebrew/bin/node"),
        Path("/usr/local/bin/node"),
    ]
    candidates.extend(sorted((Path.home() / ".nvm" / "versions" / "node").glob("*/bin/node"), reverse=True))
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    raise RuntimeError("Node.js was not found. Set JDDM_NODE_BIN to the node executable path.")


def build_text_summary(events: list[EventRecord], csv_path: Path) -> str:
    if not events:
        return f"NEO live music scan: no same-day Cleveland-area gigs found yet.\nSpreadsheet: {csv_path}"
    lines = [f"NEO live music scan found {len(events)} same-day leads."]
    for event in events[:5]:
        when = " ".join(x for x in [event.event_date, event.event_time] if x)
        place = event.venue or event.city or event.location_match
        lines.append(f"- {event.title[:70]} | {when or 'today'} | {place}".strip())
    lines.append(f"Spreadsheet: {csv_path}")
    return "\n".join(lines)[:1800]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape same-day Northeast Ohio live music events from Google results.")
    parser.add_argument("keywords", nargs="*", help="Optional musician names, venues, or extra keywords.")
    parser.add_argument("--headless", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--num-results", type=int, default=10)
    parser.add_argument("--max-queries", type=int, default=12)
    parser.add_argument("--max-events", type=int, default=30)
    parser.add_argument("--min-score", type=int, default=5)
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORT_DIR)
    parser.add_argument("--text", action="store_true", help="Text Carter with a summary after scraping.")
    parser.add_argument("--phone", default=CARTER_PHONE)
    parser.add_argument("--proxy-server", default="", help="Optional Playwright proxy, e.g. http://host:port")
    parser.add_argument("--user-data-dir", type=Path, default=DEFAULT_USER_DATA_DIR, help="Persistent Chrome profile for Google cookies/challenges.")
    parser.add_argument("--browser-channel", default="", help="Optional Playwright browser channel, e.g. chrome.")
    parser.add_argument("--interactive-setup", action="store_true", help="Open Google headful so you can manually clear a Google challenge once.")
    parser.add_argument("--rss-fallback", action=argparse.BooleanOptionalAction, default=True, help="Use Google News RSS if Google SERP blocks automation.")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args(argv)


def configure_logging(level: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    if sys.stdout.isatty():
        handlers.append(logging.FileHandler(LOG_PATH, encoding="utf-8"))
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=handlers,
        force=True,
    )


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    configure_logging(args.log_level)
    logger = logging.getLogger("neo_live_music")

    conn = init_db(args.db_path)
    scraper = GoogleLiveMusicScraper(args)
    events = scraper.run()

    for event in events:
        upsert_event(conn, event)
    csv_path = export_csv(events, args.export_dir)

    logger.info("Saved %d events to %s and %s", len(events), args.db_path, csv_path)
    print(json.dumps([asdict(event) for event in events], indent=2, ensure_ascii=False))

    if args.text:
        summary = build_text_summary(events, csv_path)
        send_text_via_messages(args.phone, summary)
        logger.info("Texted summary to %s", args.phone)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
