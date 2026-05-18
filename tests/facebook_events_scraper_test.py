import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "facebook_events_scraper.py"
SPEC = importlib.util.spec_from_file_location("facebook_events_scraper", SCRIPT_PATH)
facebook_events = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = facebook_events
SPEC.loader.exec_module(facebook_events)


class FacebookEventsScraperTest(unittest.TestCase):
    def test_load_spreadsheet_header_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "artists.csv"
            path.write_text(
                "name,facebook_url,type\n"
                "Rob Rocks,https://www.facebook.com/robrockscle,musician\n",
                encoding="utf-8",
            )

            entities = facebook_events.load_spreadsheet(path)

        self.assertEqual(len(entities), 1)
        self.assertEqual(entities[0].source_name, "Rob Rocks")
        self.assertEqual(entities[0].facebook_url, "https://www.facebook.com/robrockscle")
        self.assertEqual(entities[0].entity_type, "musician")

    def test_load_spreadsheet_one_name_per_row_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "names.csv"
            path.write_text("Furious George\nMaria Petti\n", encoding="utf-8")

            entities = facebook_events.load_spreadsheet(path)

        self.assertEqual([entity.source_name for entity in entities], ["Furious George", "Maria Petti"])

    def test_events_url_for_page_handles_profile_and_groups(self):
        self.assertEqual(
            facebook_events.events_url_for_page("https://www.facebook.com/profile.php?id=123"),
            "https://www.facebook.com/profile.php?id=123&sk=events",
        )
        self.assertEqual(
            facebook_events.events_url_for_page("https://www.facebook.com/groups/clevelandgigs"),
            "https://www.facebook.com/groups/clevelandgigs/events",
        )
        self.assertEqual(
            facebook_events.events_url_for_page("https://www.facebook.com/robrockscle"),
            "https://www.facebook.com/robrockscle/events",
        )

    def test_build_event_from_page_data_extracts_structured_fields(self):
        raw = {
            "title": "Rob Rocks at Grog Shop | Facebook",
            "metaDescription": "Rob Rocks live in Cleveland Heights.",
            "bodyText": (
                "Rob Rocks at Grog Shop\n"
                "Saturday, June 20, 2026 at 9:00 PM\n"
                "Grog Shop\n"
                "2785 Euclid Heights Blvd\n"
                "12 interested 5 going\n"
                "Tickets: $10"
            ),
            "pageLinks": [{"href": "https://www.facebook.com/robrockscle", "text": "Rob Rocks", "aria": ""}],
            "ticketLinks": [{"href": "https://tickets.example/rob", "text": "Tickets", "aria": ""}],
            "imageUrls": ["https://example.com/cover.jpg"],
            "jsonld": [],
        }

        event = facebook_events.build_event_from_page_data(
            raw,
            "https://www.facebook.com/events/123456789",
            "Rob Rocks",
            "https://www.facebook.com/robrockscle",
        )

        self.assertEqual(event.event_id, "123456789")
        self.assertEqual(event.event_title, "Rob Rocks at Grog Shop")
        self.assertEqual(event.start_datetime, "2026-06-20T21:00:00")
        self.assertEqual(event.organizer_name, "Rob Rocks")
        self.assertEqual(event.interested_count, 12)
        self.assertEqual(event.going_count, 5)
        self.assertEqual(event.ticket_url, "https://tickets.example/rob")
        self.assertIn("cover.jpg", event.image_urls)

    def test_facebook_event_table_dedupes_by_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "events.sqlite3"
            conn = sqlite3.connect(db_path)
            facebook_events.init_facebook_events_table(conn)
            event = facebook_events.FacebookEvent(
                event_url="https://www.facebook.com/events/1",
                event_id="1",
                event_title="Maria Petti at Baci Winery",
                organizer_name="Maria Petti",
                page_name="Maria Petti",
                start_datetime="2026-06-20T19:00:00",
                end_datetime="",
                venue="Baci Winery",
                location="Madison",
                address="",
                description="",
                interested_count=0,
                going_count=0,
                ticket_url="",
                price_info="",
                image_urls="",
                event_type="in-person",
                scraped_at="2026-05-18T12:00:00",
                source_name="Maria Petti",
                source_url="https://www.facebook.com/mariapettimusic",
                raw_text="",
            )

            facebook_events.upsert_facebook_event(conn, event)
            event.event_url = "https://www.facebook.com/events/2"
            event.event_id = "2"
            event.going_count = 4
            facebook_events.upsert_facebook_event(conn, event)
            rows = conn.execute("SELECT event_url, going_count FROM facebook_events").fetchall()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "https://www.facebook.com/events/2")
        self.assertEqual(rows[0][1], 4)

    def test_save_events_writes_shared_events_table_and_detail_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "events.sqlite3"
            event = facebook_events.FacebookEvent(
                event_url="https://www.facebook.com/events/9",
                event_id="9",
                event_title="Jim Gill at Music Box Supper Club",
                organizer_name="Jim Gill",
                page_name="Jim Gill",
                start_datetime="2026-07-04T20:00:00",
                end_datetime="",
                venue="Music Box Supper Club",
                location="Cleveland",
                address="",
                description="Public Facebook event",
                interested_count=10,
                going_count=3,
                ticket_url="",
                price_info="$10",
                image_urls="",
                event_type="in-person",
                scraped_at="2026-05-18T12:00:00",
                source_name="Jim Gill",
                source_url="https://www.facebook.com/jimgillmusic",
                raw_text="Jim Gill at Music Box Supper Club",
            )

            facebook_events.save_events(db_path, [event])
            conn = sqlite3.connect(db_path)
            shared_count = conn.execute("SELECT COUNT(*) FROM events WHERE source='facebook_events'").fetchone()[0]
            detail_count = conn.execute("SELECT COUNT(*) FROM facebook_events").fetchone()[0]

        self.assertEqual(shared_count, 1)
        self.assertEqual(detail_count, 1)


if __name__ == "__main__":
    unittest.main()
