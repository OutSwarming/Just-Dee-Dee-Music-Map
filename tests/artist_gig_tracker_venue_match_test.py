import importlib.util
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


if __name__ == "__main__":
    unittest.main()
