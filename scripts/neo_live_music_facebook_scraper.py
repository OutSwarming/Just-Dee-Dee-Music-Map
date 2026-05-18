#!/usr/bin/env python3
"""
Facebook public group/page scraper for Northeast Ohio live music leads.

This is the second source feeding the same SQLite event table used by
neo_live_music_google_scraper.py. It intentionally uses a normal browser session:
log in once with --login, save cookies, then scrape public pages/groups that the
logged-in user is allowed to view. It does not solve CAPTCHAs, bypass private
group permissions, or use paid APIs.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import random
import re
import sqlite3
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urlparse

try:
    from playwright.sync_api import Locator
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except Exception:  # pragma: no cover - runtime dependency check gives the user the fix.
    Locator = Any
    PlaywrightTimeoutError = None
    sync_playwright = None

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from neo_live_music_google_scraper import (  # noqa: E402
    CLEVELAND,
    DEFAULT_DB_PATH,
    DEFAULT_EXPORT_DIR,
    EventRecord,
    MUSIC_TERMS,
    NEGATIVE_TERMS,
    TODAY_TERMS,
    clean,
    find_location,
    haversine_miles,
    init_db,
    is_neohio,
    normalize_key,
    parse_event_datetime,
    relevance_score,
    upsert_event,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STORAGE_STATE = (
    Path.home()
    / "Library"
    / "Application Support"
    / "Just Dee Dee Music Map"
    / "facebook-storage-state.json"
)
DEFAULT_SCREENSHOT_DIR = REPO_ROOT / "data" / "scraped" / "facebook_screenshots"
LOG_PATH = Path.home() / "Library" / "Logs" / "neo-live-music-facebook-scraper.log"

GIG_BOOST_TERMS = re.compile(
    r"\b(tonight|tomorrow|this weekend|playing at|live at|performing at|"
    r"gig|gigs|show|concert|set time|doors|music starts|acoustic|duo|trio|"
    r"full band|open mic|songwriter|lineup|tickets?)\b",
    re.I,
)

LOCAL_VENUE_POINTS: dict[str, tuple[str, tuple[float, float]]] = {
    "beachland ballroom": ("Cleveland", (41.5486, -81.5896)),
    "beachland tavern": ("Cleveland", (41.5486, -81.5896)),
    "grog shop": ("Cleveland Heights", (41.5095, -81.5779)),
    "happy dog": ("Cleveland", (41.4844, -81.7306)),
    "music box supper club": ("Cleveland", (41.4965, -81.7045)),
    "house of blues": ("Cleveland", (41.4996, -81.6905)),
    "bop stop": ("Cleveland", (41.4862, -81.7104)),
    "jilly s music room": ("Akron", (41.0843, -81.5155)),
    "kent stage": ("Kent", (41.1536, -81.3584)),
    "winchester": ("Lakewood", (41.4845, -81.7995)),
    "brothers lounge": ("Cleveland", (41.4845, -81.7684)),
    "jolene s": ("Cleveland", (41.4987, -81.6902)),
}

DEFAULT_TARGETS: list[dict[str, str]] = [
    {"name": "Live Music CLE", "url": "", "kind": "group", "search_query": "Live Music CLE"},
    {"name": "Cleveland Gigs", "url": "", "kind": "group", "search_query": "Cleveland Gigs"},
    {"name": "Current Cleveland Musicians", "url": "", "kind": "group", "search_query": "Current Cleveland Musicians"},
    {"name": "The Cleveland Music Scene", "url": "", "kind": "group", "search_query": "The Cleveland Music Scene"},
    {"name": "Northern Ohio live entertainment", "url": "", "kind": "group", "search_query": "Northern Ohio live entertainment"},
    {"name": "Northeast Ohio Live Music", "url": "", "kind": "search", "search_query": "Northeast Ohio live music gigs"},
    {"name": "Cleveland Live Music Events", "url": "", "kind": "search", "search_query": "Cleveland live music events"},
]


@dataclass
class FacebookTarget:
    name: str
    url: str = ""
    kind: str = "group"
    search_query: str = ""


@dataclass
class FacebookPostRecord:
    source: str
    group_name: str
    group_url: str
    post_id: str
    post_url: str
    post_text: str
    post_datetime: str
    author: str
    reactions_count: int
    comments_count: int
    event_date: str
    event_time: str
    venue: str
    city: str
    bands: str
    linked_events: str
    image_urls: str
    video_urls: str
    scraped_at: str
    raw_snippet: str
    location_match: str
    distance_miles: float | None
    relevance_score: int


def stable_hash(*parts: object, length: int = 16) -> str:
    return hashlib.sha256("|".join(clean(part) for part in parts).encode("utf-8")).hexdigest()[:length]


def parse_count(value: object) -> int:
    text = clean(value).replace(",", "")
    match = re.search(r"(\d+(?:\.\d+)?)\s*([KkMm]?)", text)
    if not match:
        return 0
    number = float(match.group(1))
    suffix = match.group(2).lower()
    if suffix == "k":
        number *= 1000
    elif suffix == "m":
        number *= 1_000_000
    return int(number)


def parse_facebook_post_datetime(value: object, now: datetime | None = None) -> str:
    now = now or datetime.now()
    text = clean(value)
    if not text:
        return ""
    lower = text.lower()
    if "just now" in lower:
        return now.isoformat(timespec="seconds")
    match = re.search(r"\b(\d+)\s*(?:m|min|mins|minute|minutes)\b", lower)
    if match:
        return (now - timedelta(minutes=int(match.group(1)))).isoformat(timespec="seconds")
    match = re.search(r"\b(\d+)\s*(?:h|hr|hrs|hour|hours)\b", lower)
    if match:
        return (now - timedelta(hours=int(match.group(1)))).isoformat(timespec="seconds")
    match = re.search(r"\b(\d+)\s*(?:d|day|days)\b", lower)
    if match:
        return (now - timedelta(days=int(match.group(1)))).isoformat(timespec="seconds")
    if "yesterday" in lower:
        parsed = now - timedelta(days=1)
        time_match = re.search(r"(\d{1,2})(?::(\d{2}))?\s*([ap]m)", lower)
        if time_match:
            hour = int(time_match.group(1)) % 12
            if time_match.group(3) == "pm":
                hour += 12
            parsed = parsed.replace(hour=hour, minute=int(time_match.group(2) or 0), second=0, microsecond=0)
        return parsed.isoformat(timespec="seconds")
    match = re.search(
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?",
        text,
        re.I,
    )
    if match:
        month = datetime.strptime(match.group(1)[:3].title(), "%b").month
        year = int(match.group(3) or now.year)
        parsed = datetime(year, month, int(match.group(2)))
        return parsed.isoformat(timespec="seconds")
    return text


def parse_facebook_event_datetime(text: str) -> tuple[str, str]:
    event_date, event_time = parse_event_datetime(text)
    if event_date or event_time:
        return event_date, event_time
    today = date.today()
    if re.search(r"\btomorrow\b", text, re.I):
        _, event_time = parse_event_datetime("today " + text)
        return (today + timedelta(days=1)).isoformat(), event_time
    weekdays = {
        "monday": 0,
        "tuesday": 1,
        "wednesday": 2,
        "thursday": 3,
        "friday": 4,
        "saturday": 5,
        "sunday": 6,
    }
    for name, weekday in weekdays.items():
        if re.search(rf"\bthis\s+{name}\b|\b{name}\b", text, re.I):
            days_ahead = (weekday - today.weekday()) % 7
            if days_ahead == 0 and not TODAY_TERMS.search(text):
                days_ahead = 7
            _, event_time = parse_event_datetime("today " + text)
            return (today + timedelta(days=days_ahead)).isoformat(), event_time
    return "", ""


def find_local_venue(text: str) -> tuple[str, str, float | None]:
    haystack = normalize_key(text)
    for venue_key, (city, point) in LOCAL_VENUE_POINTS.items():
        if venue_key in haystack:
            return venue_key.title(), city, haversine_miles(CLEVELAND, point)
    return "", "", None


def extract_venue_and_bands(text: str) -> tuple[str, str]:
    patterns = [
        r"\b(?:playing|performing|live|gig|show)\s+(?:at|@)\s+([A-Z][A-Za-z0-9 '&.,-]{2,80})",
        r"\b(?:at|@)\s+([A-Z][A-Za-z0-9 '&.,-]{2,80})",
    ]
    venue = ""
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            venue = re.split(r"\s+(?:tonight|tomorrow|this|with|w/|from|at)\b|[.!?]\s", clean(match.group(1)), maxsplit=1, flags=re.I)[0]
            break
    bands = ""
    match = re.search(r"([A-Z][A-Za-z0-9 '&.,-]{2,80})\s+(?:live at|at|@)\s+", text)
    if match:
        bands = clean(match.group(1))
    return venue, bands


def extract_event_details(text: str) -> dict[str, object]:
    event_date, event_time = parse_facebook_event_datetime(text)
    venue, bands = extract_venue_and_bands(text)
    local_venue, venue_city, venue_distance = find_local_venue(" ".join([venue, text]))
    if local_venue and not venue:
        venue = local_venue
    location_match, distance = find_location(text)
    city = venue_city or location_match
    if venue_distance is not None:
        distance = venue_distance
        location_match = venue_city or location_match
    score = relevance_score(text)
    if GIG_BOOST_TERMS.search(text):
        score += 4
    return {
        "event_date": event_date,
        "event_time": event_time,
        "venue": venue,
        "city": city,
        "bands": bands,
        "location_match": location_match,
        "distance_miles": round(distance, 1) if distance is not None else None,
        "relevance_score": score,
    }


def post_id_from_url(url: str, fallback_text: str) -> str:
    patterns = [
        r"/posts/([^/?#]+)",
        r"/permalink/([^/?#]+)",
        r"story_fbid=([^&#]+)",
        r"multi_permalinks=([^&#]+)",
        r"/videos/([^/?#]+)",
        r"/events/([^/?#]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return clean(match.group(1))
    return stable_hash(url, fallback_text)


def click_see_more(container: Locator, logger: logging.Logger) -> None:
    try:
        buttons = container.locator("div[role='button'], span[role='button'], span").filter(has_text=re.compile(r"^See more$", re.I))
        for index in range(min(buttons.count(), 8)):
            try:
                buttons.nth(index).click(timeout=800)
                time.sleep(random.uniform(0.15, 0.45))
            except Exception:
                continue
    except Exception as exc:
        logger.debug("See More scan failed: %s", exc)


def extract_post_details(post_element: Locator, group_name: str = "", group_url: str = "") -> dict[str, object]:
    raw = post_element.evaluate(
        """
        (el) => {
            const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
            const links = Array.from(el.querySelectorAll('a')).map(a => ({
                href: a.href || '',
                text: clean(a.innerText || a.textContent || ''),
                aria: clean(a.getAttribute('aria-label') || '')
            })).filter(item => item.href);
            const postLink = links.find(item =>
                /\\/groups\\/[^/]+\\/posts\\//.test(item.href) ||
                /\\/(posts|permalink|videos|events)\\//.test(item.href) ||
                /story_fbid=|multi_permalinks=/.test(item.href)
            );
            const eventLinks = links
                .map(item => item.href)
                .filter(href => /facebook\\.com\\/events\\//.test(href));
            const authorLink = el.querySelector('h2 a, h3 a, strong a, a[role="link"]');
            const imageUrls = Array.from(el.querySelectorAll('img'))
                .map(img => img.currentSrc || img.src || '')
                .filter(src => /^https?:/.test(src));
            const videoUrls = Array.from(el.querySelectorAll('video, a[href*="/videos/"]'))
                .map(node => node.currentSrc || node.src || node.href || '')
                .filter(src => /^https?:/.test(src));
            const text = clean(el.innerText || el.textContent || '');
            const timeCandidate = links.map(item => item.aria || item.text).find(text =>
                /Just now|\\b\\d+\\s*(m|min|h|hr|d|day)s?\\b|Yesterday|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(text)
            ) || '';
            const reactions = (text.match(/(\\d+(?:\\.\\d+)?\\s*[KkMm]?)\\s*(?:reactions?|likes?)/i) || [,''])[1];
            const comments = (text.match(/(\\d+(?:\\.\\d+)?\\s*[KkMm]?)\\s*comments?/i) || [,''])[1];
            return {
                text,
                postUrl: postLink ? postLink.href : '',
                author: clean(authorLink ? (authorLink.innerText || authorLink.textContent) : ''),
                timeText: timeCandidate,
                reactionsText: reactions || '',
                commentsText: comments || '',
                eventLinks: Array.from(new Set(eventLinks)),
                imageUrls: Array.from(new Set(imageUrls)),
                videoUrls: Array.from(new Set(videoUrls))
            };
        }
        """
    )
    text = clean(raw.get("text"))
    post_url = clean(raw.get("postUrl")) or f"{group_url}#post-{stable_hash(group_name, text)}"
    event_details = extract_event_details(text)
    return {
        "source": "facebook",
        "group_name": group_name,
        "group_url": group_url,
        "post_id": post_id_from_url(post_url, text),
        "post_url": post_url,
        "post_text": text,
        "post_datetime": parse_facebook_post_datetime(raw.get("timeText")),
        "author": clean(raw.get("author")),
        "reactions_count": parse_count(raw.get("reactionsText")),
        "comments_count": parse_count(raw.get("commentsText")),
        "linked_events": " | ".join(raw.get("eventLinks") or []),
        "image_urls": " | ".join(raw.get("imageUrls") or []),
        "video_urls": " | ".join(raw.get("videoUrls") or []),
        "scraped_at": datetime.now().isoformat(timespec="seconds"),
        "raw_snippet": text[:1200],
        **event_details,
    }


def facebook_post_to_event(post: FacebookPostRecord) -> EventRecord:
    title = clean(post.bands) or clean(post.venue) or clean(post.post_text[:90]) or f"Facebook post {post.post_id}"
    if post.venue and post.bands:
        title = f"{post.bands} @ {post.venue}"
    return EventRecord(
        source="facebook",
        query_used=post.group_name,
        title=title,
        url=post.post_url,
        event_date=post.event_date,
        event_time=post.event_time,
        venue=post.venue,
        address="",
        city=post.city,
        bands=post.bands,
        ticket_info="",
        description=f"{post.group_name} | {post.author} | {post.post_text}"[:1200],
        image_urls=post.image_urls,
        scraped_at=post.scraped_at,
        raw_snippet=post.raw_snippet,
        location_match=post.location_match,
        distance_miles=post.distance_miles,
        relevance_score=post.relevance_score,
    )


def init_facebook_posts_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS facebook_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            group_name TEXT,
            group_url TEXT,
            post_id TEXT NOT NULL,
            post_url TEXT NOT NULL,
            post_text TEXT,
            post_datetime TEXT,
            author TEXT,
            reactions_count INTEGER DEFAULT 0,
            comments_count INTEGER DEFAULT 0,
            event_date TEXT,
            event_time TEXT,
            venue TEXT,
            city TEXT,
            bands TEXT,
            linked_events TEXT,
            image_urls TEXT,
            video_urls TEXT,
            scraped_at TEXT NOT NULL,
            raw_snippet TEXT,
            location_match TEXT,
            distance_miles REAL,
            relevance_score INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_posts_url ON facebook_posts(post_url)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_facebook_posts_group_date ON facebook_posts(group_name, post_datetime)")
    conn.commit()


def upsert_facebook_post(conn: sqlite3.Connection, post: FacebookPostRecord) -> None:
    row = asdict(post)
    conn.execute(
        """
        INSERT INTO facebook_posts (
            source, group_name, group_url, post_id, post_url, post_text,
            post_datetime, author, reactions_count, comments_count, event_date,
            event_time, venue, city, bands, linked_events, image_urls, video_urls,
            scraped_at, raw_snippet, location_match, distance_miles, relevance_score
        ) VALUES (
            :source, :group_name, :group_url, :post_id, :post_url, :post_text,
            :post_datetime, :author, :reactions_count, :comments_count, :event_date,
            :event_time, :venue, :city, :bands, :linked_events, :image_urls, :video_urls,
            :scraped_at, :raw_snippet, :location_match, :distance_miles, :relevance_score
        )
        ON CONFLICT(post_url) DO UPDATE SET
            post_text=excluded.post_text,
            post_datetime=excluded.post_datetime,
            author=excluded.author,
            reactions_count=excluded.reactions_count,
            comments_count=excluded.comments_count,
            event_date=excluded.event_date,
            event_time=excluded.event_time,
            venue=excluded.venue,
            city=excluded.city,
            bands=excluded.bands,
            linked_events=excluded.linked_events,
            image_urls=excluded.image_urls,
            video_urls=excluded.video_urls,
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


def upsert_event_with_title_date_fallback(conn: sqlite3.Connection, event: EventRecord) -> None:
    try:
        upsert_event(conn, event)
        return
    except sqlite3.IntegrityError:
        title_date_key = hashlib.sha256(
            f"{normalize_key(event.title)}|{event.event_date or 'undated'}".encode("utf-8")
        ).hexdigest()
        conn.execute(
            """
            UPDATE events SET
                source=:source,
                query_used=:query_used,
                url=:url,
                event_time=:event_time,
                venue=:venue,
                address=:address,
                city=:city,
                bands=:bands,
                ticket_info=:ticket_info,
                description=:description,
                image_urls=:image_urls,
                scraped_at=:scraped_at,
                raw_snippet=:raw_snippet,
                location_match=:location_match,
                distance_miles=:distance_miles,
                relevance_score=:relevance_score,
                updated_at=CURRENT_TIMESTAMP
            WHERE title_date_key=:title_date_key
            """,
            {**asdict(event), "title_date_key": title_date_key},
        )
        conn.commit()


class FacebookLiveMusicScraper:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.logger = logging.getLogger("neo_live_music.facebook")
        self.page: Any | None = None

    def sleep(self, low: float = 0.8, high: float = 2.4) -> None:
        time.sleep(random.uniform(low, high))

    def resolve_target_url(self, target: FacebookTarget) -> str:
        if target.url:
            return target.url
        query = target.search_query or target.name
        search_url = f"https://www.facebook.com/search/groups/?q={quote_plus(query)}"
        if target.kind == "page":
            search_url = f"https://www.facebook.com/search/pages/?q={quote_plus(query)}"
        if target.kind == "search":
            search_url = f"https://www.facebook.com/search/posts/?q={quote_plus(query)}"
        page = self.page
        if page is None:
            return search_url
        self.logger.info("Resolving Facebook target %s via search", target.name)
        page.goto(search_url, wait_until="domcontentloaded", timeout=45000)
        self.sleep(2.0, 4.0)
        links = page.evaluate(
            """
            (name) => Array.from(document.querySelectorAll('a'))
                .map(a => ({href: a.href || '', text: (a.innerText || '').replace(/\\s+/g, ' ').trim()}))
                .filter(item => item.href.includes('facebook.com') && item.text.toLowerCase().includes(name.toLowerCase()))
                .slice(0, 12)
            """,
            target.name,
        )
        for item in links:
            href = clean(item.get("href")).split("?")[0]
            if href and not re.search(r"/search/|/login|/share/", href):
                return href
        return search_url

    def is_login_wall(self) -> bool:
        if self.page is None:
            return False
        text = clean(self.page.evaluate("document.body ? document.body.innerText : ''")).lower()
        return "log into facebook" in text or "you must log in" in text or "create new account" in text

    def run(self) -> tuple[list[FacebookPostRecord], list[EventRecord]]:
        if sync_playwright is None:
            raise RuntimeError(
                "Python Playwright is not installed. Run: python3 -m pip install playwright && python3 -m playwright install chromium"
            )
        targets = load_targets(self.args)
        posts: list[FacebookPostRecord] = []
        events: list[EventRecord] = []

        with sync_playwright() as playwright:
            launch_options: dict[str, Any] = {"headless": self.args.headless}
            if self.args.browser_channel:
                launch_options["channel"] = self.args.browser_channel
            if self.args.proxy_server:
                launch_options["proxy"] = {"server": self.args.proxy_server}
            browser = playwright.chromium.launch(**launch_options)
            context_options: dict[str, Any] = {
                "viewport": {"width": random.randint(1280, 1480), "height": random.randint(820, 980)},
                "locale": "en-US",
                "timezone_id": "America/New_York",
                "user_agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                ),
            }
            storage_state = Path(self.args.storage_state).expanduser()
            if storage_state.exists():
                context_options["storage_state"] = str(storage_state)
            context = browser.new_context(**context_options)
            self.page = context.new_page()

            for target in targets:
                target_url = self.resolve_target_url(target)
                target_posts = self.scrape_group(target_url, self.args.max_posts_per_target, target.name)
                posts.extend(target_posts)
                events.extend(facebook_post_to_event(post) for post in target_posts)
                self.sleep(2.5, 6.0)

            context.close()
            browser.close()
        return posts, events

    def scrape_group(self, url: str, max_posts: int, group_name: str = "") -> list[FacebookPostRecord]:
        page = self.page
        if page is None:
            raise RuntimeError("Browser page is not initialized.")
        self.logger.info("Scraping Facebook target: %s (%s)", group_name or url, url)
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        self.sleep(3.0, 6.0)
        if self.is_login_wall():
            raise RuntimeError("Facebook login is required. Run this once: npm run music:facebook-login")

        collected: list[FacebookPostRecord] = []
        seen: set[str] = set()
        for scroll_index in range(self.args.max_scrolls):
            click_see_more(page.locator("body"), self.logger)
            articles = page.locator("[role='article']")
            count = articles.count()
            self.logger.debug("%s visible article candidates after scroll %d", count, scroll_index + 1)
            for index in range(count):
                if len(collected) >= max_posts:
                    return collected
                article = articles.nth(index)
                try:
                    click_see_more(article, self.logger)
                    raw = extract_post_details(article, group_name=group_name, group_url=url)
                    post = FacebookPostRecord(**raw)
                    dedupe_key = post.post_url or stable_hash(post.group_name, post.post_text)
                    if dedupe_key in seen:
                        continue
                    seen.add(dedupe_key)
                    if self.accept_post(post):
                        collected.append(post)
                    elif self.args.screenshot_problem_posts and post.relevance_score >= self.args.min_score - 1:
                        self.screenshot_post(article, post)
                except Exception as exc:
                    self.logger.debug("Could not parse Facebook post candidate: %s", exc)
                    if self.args.screenshot_problem_posts:
                        self.screenshot_post(article, None)
            page.mouse.wheel(0, random.randint(1100, 1900))
            self.sleep(1.5, 4.0)
        return collected

    def screenshot_post(self, post_element: Locator, post: FacebookPostRecord | None) -> None:
        try:
            self.args.screenshot_dir.mkdir(parents=True, exist_ok=True)
            name = post.post_id if post else stable_hash(time.time())
            post_element.screenshot(path=str(self.args.screenshot_dir / f"facebook_post_{name}.png"))
        except Exception as exc:
            self.logger.debug("Problem-post screenshot failed: %s", exc)

    def accept_post(self, post: FacebookPostRecord) -> bool:
        text = " ".join([post.post_text, post.venue, post.city, post.bands, post.group_name])
        if NEGATIVE_TERMS.search(text):
            return False
        if post.relevance_score < self.args.min_score:
            return False
        post_time = parse_known_datetime(post.post_datetime)
        if post_time and datetime.now() - post_time > timedelta(hours=self.args.lookback_hours):
            if not re.search(r"\b(today|tonight|tomorrow)\b", text, re.I):
                return False
        in_area, location, distance = is_neohio(text)
        if not in_area:
            local_venue, city, venue_distance = find_local_venue(text)
            if local_venue:
                post.location_match = city
                post.distance_miles = round(venue_distance, 1) if venue_distance is not None else None
                return True
            return bool(self.args.keep_local_group_without_location and GIG_BOOST_TERMS.search(text))
        if location and not post.location_match:
            post.location_match = location
            post.distance_miles = round(distance, 1) if distance is not None else post.distance_miles
        return True


def parse_known_datetime(value: str) -> datetime | None:
    text = clean(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def load_targets(args: argparse.Namespace) -> list[FacebookTarget]:
    raw_targets: list[dict[str, str]] = []
    if args.targets_config and Path(args.targets_config).exists():
        data = json.loads(Path(args.targets_config).read_text(encoding="utf-8"))
        raw_targets.extend(data.get("targets", data if isinstance(data, list) else []))
    elif args.include_default_targets:
        raw_targets.extend(DEFAULT_TARGETS)
    for item in args.target_url:
        if "|" in item:
            name, url = item.split("|", 1)
        else:
            url = item
            parsed = urlparse(url)
            name = parsed.path.strip("/") or parsed.netloc
        raw_targets.append({"name": clean(name), "url": clean(url), "kind": "group", "search_query": ""})
    targets: list[FacebookTarget] = []
    for row in raw_targets:
        target = FacebookTarget(
            name=clean(row.get("name")) or clean(row.get("url")) or "Facebook target",
            url=clean(row.get("url")),
            kind=clean(row.get("kind")) or "group",
            search_query=clean(row.get("search_query")),
        )
        if target.url or target.search_query or target.name:
            targets.append(target)
    return targets


def write_default_config(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"targets": DEFAULT_TARGETS}, indent=2) + "\n", encoding="utf-8")


def login(args: argparse.Namespace) -> None:
    if sync_playwright is None:
        raise RuntimeError("Python Playwright is not installed. Run: python3 -m pip install playwright && python3 -m playwright install chromium")
    storage_state = Path(args.storage_state).expanduser()
    storage_state.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch_options: dict[str, Any] = {"headless": False}
        if args.browser_channel:
            launch_options["channel"] = args.browser_channel
        browser = playwright.chromium.launch(**launch_options)
        context_options: dict[str, Any] = {
            "locale": "en-US",
            "timezone_id": "America/New_York",
            "viewport": {"width": 1360, "height": 920},
        }
        if storage_state.exists():
            context_options["storage_state"] = str(storage_state)
        context = browser.new_context(**context_options)
        page = context.new_page()
        page.goto("https://www.facebook.com/login", wait_until="domcontentloaded", timeout=60000)
        print("Facebook login window is open. Log in normally, then press Enter here to save the session.")
        input()
        context.storage_state(path=str(storage_state))
        context.close()
        browser.close()
    print(f"Saved Facebook session to {storage_state}")


def export_facebook_csv(posts: list[FacebookPostRecord], events: list[EventRecord], export_dir: Path) -> dict[str, Path]:
    export_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    post_path = export_dir / f"facebook_live_music_posts_{timestamp}.csv"
    event_path = export_dir / f"facebook_live_music_events_{timestamp}.csv"
    post_latest = export_dir / "facebook_live_music_posts_latest.csv"
    event_latest = export_dir / "facebook_live_music_events_latest.csv"

    def write_rows(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    post_fields = [field.name for field in FacebookPostRecord.__dataclass_fields__.values()]
    event_fields = [field.name for field in EventRecord.__dataclass_fields__.values()]
    write_rows(post_path, [asdict(post) for post in posts], post_fields)
    write_rows(event_path, [asdict(event) for event in events], event_fields)
    post_latest.write_text(post_path.read_text(encoding="utf-8"), encoding="utf-8")
    event_latest.write_text(event_path.read_text(encoding="utf-8"), encoding="utf-8")
    return {"posts": post_path, "events": event_path, "posts_latest": post_latest, "events_latest": event_latest}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape public Facebook groups/pages for Northeast Ohio live music leads.")
    parser.add_argument("--login", action="store_true", help="Open Facebook headful, let you log in once, then save cookies.")
    parser.add_argument("--headless", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--storage-state", type=Path, default=DEFAULT_STORAGE_STATE)
    parser.add_argument("--targets-config", type=Path, default=REPO_ROOT / "config" / "facebook-live-music-targets.json")
    parser.add_argument("--write-default-config", action="store_true", help="Write a configurable target JSON file and exit.")
    parser.add_argument("--include-default-targets", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--target-url", action="append", default=[], help='Extra target as "Name|https://facebook.com/groups/..." or just URL.')
    parser.add_argument("--max-posts-per-target", type=int, default=25)
    parser.add_argument("--max-scrolls", type=int, default=8)
    parser.add_argument("--lookback-hours", type=int, default=48)
    parser.add_argument("--min-score", type=int, default=5)
    parser.add_argument("--keep-local-group-without-location", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORT_DIR)
    parser.add_argument("--proxy-server", default="", help="Optional Playwright proxy, e.g. http://host:port")
    parser.add_argument("--browser-channel", default="", help="Optional Playwright browser channel, e.g. chrome.")
    parser.add_argument("--screenshot-problem-posts", action="store_true")
    parser.add_argument("--screenshot-dir", type=Path, default=DEFAULT_SCREENSHOT_DIR)
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
    logger = logging.getLogger("neo_live_music.facebook")

    if args.write_default_config:
        write_default_config(args.targets_config)
        logger.info("Wrote default Facebook target config to %s", args.targets_config)
        return 0
    if args.login:
        login(args)
        return 0

    conn = init_db(args.db_path)
    init_facebook_posts_table(conn)
    scraper = FacebookLiveMusicScraper(args)
    posts, events = scraper.run()
    for post in posts:
        upsert_facebook_post(conn, post)
    for event in events:
        upsert_event_with_title_date_fallback(conn, event)
    paths = export_facebook_csv(posts, events, args.export_dir)
    summary = {
        "posts": len(posts),
        "events": len(events),
        "db_path": str(args.db_path),
        "exports": {key: str(value) for key, value in paths.items()},
    }
    logger.info("Saved %d Facebook posts / %d events to %s", len(posts), len(events), args.db_path)
    print(json.dumps({"summary": summary, "events": [asdict(event) for event in events]}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
