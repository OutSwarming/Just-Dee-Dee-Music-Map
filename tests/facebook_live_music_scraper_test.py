import importlib.util
import sys
import unittest
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "neo_live_music_facebook_scraper.py"
SPEC = importlib.util.spec_from_file_location("facebook_scraper", SCRIPT_PATH)
facebook_scraper = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = facebook_scraper
SPEC.loader.exec_module(facebook_scraper)


class FacebookLiveMusicScraperTest(unittest.TestCase):
    def test_relative_post_datetime_parses_hours(self):
        parsed = facebook_scraper.parse_facebook_post_datetime("2 h", now=datetime(2026, 5, 18, 14, 30))

        self.assertEqual(parsed, "2026-05-18T12:30:00")

    def test_extract_event_details_boosts_gig_and_local_venue(self):
        details = facebook_scraper.extract_event_details(
            "Tonight! Furious George live at Beachland Ballroom 8pm Cleveland"
        )

        self.assertEqual(details["event_date"], "2026-05-18")
        self.assertEqual(details["event_time"], "8:00 PM")
        self.assertEqual(details["city"], "Cleveland")
        self.assertGreaterEqual(details["relevance_score"], 9)

    def test_post_to_event_keeps_facebook_group_as_query(self):
        post = facebook_scraper.FacebookPostRecord(
            source="facebook",
            group_name="Live Music CLE",
            group_url="https://www.facebook.com/groups/example",
            post_id="123",
            post_url="https://www.facebook.com/groups/example/posts/123",
            post_text="Tomorrow Rob Rocks live at Grog Shop 7pm",
            post_datetime="2026-05-18T10:00:00",
            author="Poster",
            reactions_count=3,
            comments_count=1,
            event_date="2026-05-19",
            event_time="7:00 PM",
            venue="Grog Shop",
            city="Cleveland Heights",
            bands="Rob Rocks",
            linked_events="",
            image_urls="",
            video_urls="",
            scraped_at="2026-05-18T10:00:00",
            raw_snippet="Tomorrow Rob Rocks live at Grog Shop 7pm",
            location_match="Cleveland Heights",
            distance_miles=6.3,
            relevance_score=12,
        )

        event = facebook_scraper.facebook_post_to_event(post)

        self.assertEqual(event.source, "facebook")
        self.assertEqual(event.query_used, "Live Music CLE")
        self.assertEqual(event.title, "Rob Rocks @ Grog Shop")
        self.assertEqual(event.url, "https://www.facebook.com/groups/example/posts/123")


if __name__ == "__main__":
    unittest.main()
