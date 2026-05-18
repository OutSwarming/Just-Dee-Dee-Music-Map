import importlib.util
import logging
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "sync-artist-gig-tracker.py"
SPEC = importlib.util.spec_from_file_location("artist_gig_tracker", SCRIPT_PATH)
artist_gig_tracker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = artist_gig_tracker
SPEC.loader.exec_module(artist_gig_tracker)


class ArtistGigTrackerVenueMatchTest(unittest.TestCase):
    def make_event(self, **overrides):
        data = {
            "artist_id": "artist-furious-george",
            "artist_name": "Furious George Hartwig",
            "artist_type": "solo",
            "event_date": "2026-07-17",
            "start_time": "6:30PM",
            "end_time": "",
            "title": "Furious George Hartwig @ Olesia's Taverne of Richfield",
            "venue_name": "Olesia's Taverne of Richfield",
            "city": "Richfield",
            "state": "OH",
            "zip_code": "44286",
            "source": "artist_site:furiousgeorgehartwig.com",
            "source_record_id": "source-1",
            "source_url": "https://furiousgeorgehartwig.com/home",
            "description": "Olesia's Taverne of Richfield, Richfield, OH 44286",
        }
        data.update(overrides)
        return artist_gig_tracker.ScrapedArtistEvent(**data)

    def test_embedded_street_address_matches_existing_venue(self):
        venues = [
            {
                "venue_id": "venue-existing",
                "place_name": "Olesias Tavern",
                "address": "3960 Broadview Rd",
                "city": "Richfield",
                "zip": "44286",
                "state": "OH",
            }
        ]
        event = self.make_event(description="Olesia's Taverne of Richfield, 3960 Broadview Rd, Richfield, OH 44286")

        self.assertEqual(artist_gig_tracker.match_venue_id(venues, event), "venue-existing")

    def test_olesias_variant_reuses_malformed_master_row(self):
        venues = [
            {
                "venue_id": "venue-generated",
                "place_name": "Olesia's Taverne of Richfield",
                "address": "",
                "city": "Richfield",
                "zip": "44286",
                "state": "OH",
                "source": "furious_george_website",
            },
            {
                "venue_id": "olesias-tavern-3960-broadview-rd-richfield-oh-44286",
                "place_name": "Olesias Tavern 3960 Broadview Rd",
                "address": "Richfield",
                "city": "OH 44286",
                "zip": "",
                "state": "OH",
                "longitude": "-81.655126",
                "latitude": "41.240206",
                "source": "master_sheet_sheet1",
                "source_place_id": "olesias-tavern-3960-broadview-rd-richfield-oh-44286",
            },
        ]
        venues_by_id = {row["venue_id"]: row for row in venues}
        deduped, aliases = artist_gig_tracker.dedupe_venues_by_identity(venues_by_id)
        event = self.make_event()

        self.assertEqual(aliases["venue-generated"], "olesias-tavern-3960-broadview-rd-richfield-oh-44286")
        self.assertNotIn("venue-generated", deduped)
        self.assertEqual(artist_gig_tracker.match_venue_id(list(deduped.values()), event), "olesias-tavern-3960-broadview-rd-richfield-oh-44286")

    def test_generated_name_variant_reuses_master_venue(self):
        venues_by_id = {
            "venue-blue-turtle-b9438a78": {
                "venue_id": "venue-blue-turtle-b9438a78",
                "place_name": "Blue Turtle",
                "address": "",
                "city": "North Olmsted",
                "zip": "44070",
                "source": "furious_george_website",
            },
            "blue-turtle-tavern-north-olmsted-oh-44070": {
                "venue_id": "blue-turtle-tavern-north-olmsted-oh-44070",
                "place_name": "Blue Turtle Tavern",
                "address": "29352 Lorain Rd",
                "city": "North Olmsted",
                "zip": "44070",
                "source": "master_sheet_sheet1",
                "source_place_id": "blue-turtle-tavern-north-olmsted-oh-44070",
            },
        }

        deduped, aliases = artist_gig_tracker.dedupe_venues_by_identity(venues_by_id)

        self.assertEqual(aliases["venue-blue-turtle-b9438a78"], "blue-turtle-tavern-north-olmsted-oh-44070")
        self.assertNotIn("venue-blue-turtle-b9438a78", deduped)

    def test_non_venue_placeholders_do_not_become_venues(self):
        event = self.make_event(
            title="JDDM 2026 Scheduled Private Event",
            venue_name="Private Event",
            city="",
            zip_code="",
            source="artist_site:justdeedeemusic.com",
        )

        self.assertFalse(artist_gig_tracker.should_materialize_venue(event))
        self.assertEqual(artist_gig_tracker.add_missing_venue({}, event), "")

    def test_known_new_venue_gets_address_details(self):
        row = {
            "venue_id": "venue-the-jolly-scholar-b28de73d",
            "place_name": "The Jolly Scholar",
            "address": "",
            "city": "Cleveland",
            "zip": "44106",
            "source": "artist_site_sync",
            "notes": "",
        }

        artist_gig_tracker.enrich_known_new_venue(row)

        self.assertEqual(row["address"], "11111 Euclid Ave")
        self.assertEqual(row["website"], "https://thejollyscholar.com/")

    def test_new_venue_text_includes_artist_and_date(self):
        body = artist_gig_tracker.build_new_venue_text([
            {
                "venue_name": "Solid Gold Lounge",
                "city": "Brook Park",
                "state": "OH",
                "address": "15005 Snow Rd",
                "artist_names": ["Furious George Hartwig"],
                "event_dates": ["2026-05-14"],
            }
        ], app_url="https://example.test/app/")

        self.assertIn("Solid Gold Lounge", body)
        self.assertIn("Furious George Hartwig", body)
        self.assertIn("May", body)
        self.assertIn("https://example.test/app/", body)

    def test_jim_gill_calendar_detail_parser_extracts_public_venue(self):
        venue, address, city, zip_code, start_time = artist_gig_tracker.parse_jim_gill_calendar_detail({
            "text": "Mastropietro Winery 14558 Ellsworth Road, Berlin Center OH 44401. Fine wines and a patio! 6pm.",
            "first_link": "Mastropietro Winery",
            "first_href": "https://mastropietrowinery.com/",
        })

        self.assertEqual(venue, "Mastropietro Winery")
        self.assertEqual(address, "14558 Ellsworth Road")
        self.assertEqual(city, "Berlin Center")
        self.assertEqual(zip_code, "44401")
        self.assertEqual(start_time, "6pm")

    def test_jim_gill_calendar_detail_parser_handles_private_event_address(self):
        venue, address, city, zip_code, start_time = artist_gig_tracker.parse_jim_gill_calendar_detail({
            "text": "Piercefest 2026! 835 S. Munroe Rd., Tallmadge, OH 44278. Annual open mic. 6pm.",
            "first_link": "",
            "first_href": "",
        })

        self.assertEqual(venue, "Piercefest 2026!")
        self.assertEqual(address, "835 S. Munroe Rd.")
        self.assertEqual(city, "Tallmadge")
        self.assertEqual(zip_code, "44278")
        self.assertEqual(start_time, "6pm")

    def test_jim_gill_date_parser_rolls_into_next_year(self):
        event_date, year, month = artist_gig_tracker.parse_jim_gill_date("Friday, January 1", 2026, 12)

        self.assertEqual(event_date, "2027-01-01")
        self.assertEqual(year, 2027)
        self.assertEqual(month, 1)

    def test_jim_gill_recovered_past_events_are_included(self):
        original_fetch = artist_gig_tracker.fetch_url
        fixture_html = (
            "<div class='gspb_text'>Saturday, May 23</div>"
            "<div class='gspb_text'>Mastropietro Winery 14558 Ellsworth Road, Berlin Center OH 44401. 6pm.</div>"
        )
        artist_gig_tracker.fetch_url = lambda _url: fixture_html
        try:
            events = artist_gig_tracker.parse_jim_gill_calendar({
                "artist_id": "artist-jim-gill-584b9708",
                "canonical_name": "Jim Gill",
                "artist_type": "solo",
                "website": "https://www.jimgillmusic.com/",
            }, logging.getLogger("test"))
        finally:
            artist_gig_tracker.fetch_url = original_fetch
        titles = {event.title for event in events}

        self.assertIn("Jim Gill @ Filia Cellars Winery", titles)
        self.assertIn("Jim Gill @ Rocky Point Winery", titles)


if __name__ == "__main__":
    unittest.main()
