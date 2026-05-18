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

    def test_directional_words_do_not_alias_distinct_venues(self):
        venues_by_id = {
            "venue-west-pavilion-f58a9c9a": {
                "venue_id": "venue-west-pavilion-f58a9c9a",
                "place_name": "West Pavilion",
                "city": "Lakeside",
                "source": "artist_site_sync",
            },
            "west-and-main-bar-and-grill-warren-oh-44481": {
                "venue_id": "west-and-main-bar-and-grill-warren-oh-44481",
                "place_name": "West & Main Bar & Grill",
                "city": "Warren",
                "zip": "44481",
                "source": "master_sheet_sheet1",
            },
        }

        deduped, aliases = artist_gig_tracker.dedupe_venues_by_identity(venues_by_id)

        self.assertNotIn("venue-west-pavilion-f58a9c9a", aliases)
        self.assertIn("venue-west-pavilion-f58a9c9a", deduped)

    def test_known_alias_matches_event_without_creating_duplicate(self):
        venues = [
            {
                "venue_id": "crocker-park-177-market-st-westlake-oh-44145",
                "place_name": "Crocker Park 177 Market St. Westlake, OH 44145",
                "city": "Westlake",
                "source": "master_sheet_sheet1",
            }
        ]
        event = self.make_event(
            venue_name="Crocker Park - Music in The Park",
            city="Westlake",
            title="Victor Samalot @ Crocker Park - Music in The Park",
        )

        self.assertEqual(
            artist_gig_tracker.match_venue_id(venues, event),
            "crocker-park-177-market-st-westlake-oh-44145",
        )

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

    def test_brent_kirby_known_new_venue_gets_bop_stop_details(self):
        row = {
            "venue_id": "venue-the-bop-stop-2f6fbf90",
            "place_name": "The Bop Stop",
            "address": "",
            "city": "Cleveland",
            "zip": "44113",
            "source": "artist_site_sync",
            "notes": "",
        }

        artist_gig_tracker.enrich_known_new_venue(row)

        self.assertEqual(row["place_name"], "BOP STOP at The Music Settlement")
        self.assertEqual(row["address"], "2920 Detroit Ave")
        self.assertEqual(row["website"], "https://www.themusicsettlement.org/bop-stop/")

    def test_city_specific_alias_prevents_leos_cuyahoga_duplicate(self):
        venues = [
            {
                "venue_id": "leo-s-italian-social-burntwood-holdings-2251-front-st-cuyahoga-falls-oh-44221",
                "place_name": "Leo's Italian Social (Burntwood Holdings) 2251 Front St",
                "city": "OH 44221",
                "zip": "",
            }
        ]
        event = self.make_event(
            venue_name="Leo's Italian Social",
            city="Cuyahoga Falls",
            zip_code="44221",
            title="Brent Kirby @ Leo's Italian Social",
        )

        self.assertEqual(
            artist_gig_tracker.match_venue_id(venues, event),
            "leo-s-italian-social-burntwood-holdings-2251-front-st-cuyahoga-falls-oh-44221",
        )

    def test_city_specific_alias_prevents_peninsula_wine_cellar_duplicate(self):
        venues = [
            {
                "venue_id": "peninsula-coffee-house-and-market-peninsula-oh-44264",
                "place_name": "Peninsula Coffee House and Market",
                "address": "1653 Main St",
                "city": "Peninsula",
                "zip": "44264",
            }
        ]
        event = self.make_event(
            venue_name="Peninsula Wine Cellar",
            city="Peninsula",
            title="Brent Kirby @ Peninsula Wine Cellar",
        )

        self.assertEqual(
            artist_gig_tracker.match_venue_id(venues, event),
            "peninsula-coffee-house-and-market-peninsula-oh-44264",
        )

    def test_known_alias_prevents_madison_backfill_duplicate_venues(self):
        venues = [
            {
                "venue_id": "750ml-wine-akron-oh",
                "place_name": "750ml Wine",
                "address": "2287 W Market St",
                "city": "Akron",
                "zip": "44313",
            },
            {
                "venue_id": "hundley-cellars-geneva-oh-44041",
                "place_name": "Hundley Cellars",
                "address": "6451 OH-307",
                "city": "Geneva",
                "zip": "44041",
            },
        ]

        self.assertEqual(
            artist_gig_tracker.match_venue_id(venues, self.make_event(venue_name="750 ML Wine", city="Akron")),
            "750ml-wine-akron-oh",
        )
        self.assertEqual(
            artist_gig_tracker.match_venue_id(venues, self.make_event(venue_name="Hundley Wine Cellars", city="Geneva")),
            "hundley-cellars-geneva-oh-44041",
        )

    def test_mother_road_notes_do_not_parse_as_street_address(self):
        self.assertEqual(
            artist_gig_tracker.extract_display_street_address(
                "Bristol Public Library, Bristolville, OH | 100 years of Americana with their live music tribute to The Mother Road"
            ),
            "",
        )

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

    def test_jerry_popiel_schedule_line_parser_handles_times_and_known_venues(self):
        events = artist_gig_tracker.parse_jerry_popiel_schedule_lines([
            "June 23, 2026 Blossom Music Center VIP Club before PAUL SIMON",
            "June 23, 2026 Food Truck Tuesday, Public Square, Cleveland, OH",
            "July 11, 2026 West Pavilion, Lakeside, OH from 2-4 PM (gate fee required)",
        ], {
            "artist_id": "artist-jerry-popiel",
            "canonical_name": "Jerry Popiel",
            "artist_type": "solo",
            "website": "https://www.jerrypopiel.com/",
        })

        self.assertEqual(len(events), 3)
        self.assertEqual(events[0].venue_name, "Blossom Music Center VIP Club")
        self.assertEqual(events[0].city, "Cuyahoga Falls")
        self.assertEqual(events[1].venue_name, "Public Square")
        self.assertEqual(events[1].city, "Cleveland")
        self.assertEqual(events[2].start_time, "2PM")
        self.assertEqual(events[2].end_time, "4PM")

    def test_jerry_popiel_private_only_line_does_not_become_venue(self):
        events = artist_gig_tracker.parse_jerry_popiel_schedule_lines([
            "May 29, 2026 Private event, Wadsworth, OH",
            "January 10, 2026 Corporate event, Copper Top, Medina, OH",
        ], {
            "artist_id": "artist-jerry-popiel",
            "canonical_name": "Jerry Popiel",
            "artist_type": "solo",
            "website": "https://www.jerrypopiel.com/",
        })

        self.assertEqual(events[0].venue_name, "Private Event")
        self.assertEqual(events[0].city, "Wadsworth")
        self.assertFalse(artist_gig_tracker.should_materialize_venue(events[0]))
        self.assertEqual(events[1].venue_name, "Copper Top")
        self.assertEqual(events[1].city, "Medina")

    def test_bandzoogle_card_parser_extracts_victor_event_details(self):
        cards = artist_gig_tracker.parse_bandzoogle_event_cards("""
            <div class="event-detail" data-event-id="6562628" data-occurrence-id="761908855">
              <h2 class="event-info event-title heading-tertiary">
                <a href="https://victorsamalot.com/event/6562628/761908855/victor-samalot-duo-at-aloft-hotel">
                  Victor Samalot Duo At Aloft Hotel
                </a>
              </h2>
              <p class="event-info event-datetime">
                <span class="date-long"><span class="event-when with-end with-time">
                  <time class="from"><span class="date">Friday, May 15</span> @ <span class="time">8:00PM</span></time>
                  — <time class="to"><span class="time">10:00PM</span></time>
                </span></span>
              </p>
              <p class="event-info event-location">
                <a href="https://www.facebook.com/aloftclevelandairport/">
                  Aloft Hotel Cleveland Airport, 5550 Great Northern Blvd, North Olmsted, OH 44070
                </a>
              </p>
            </div><div class="event-clear"></div>
        """, 2026, "https://www.victorsamalot.com/show-schedule")

        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["event_date"], "2026-05-15")
        self.assertEqual(cards[0]["start_time"], "8:00PM")
        self.assertEqual(cards[0]["end_time"], "10:00PM")
        self.assertEqual(cards[0]["venue"], "Aloft Hotel Cleveland Airport")
        self.assertEqual(cards[0]["address"], "5550 Great Northern Blvd")
        self.assertEqual(cards[0]["city"], "North Olmsted")
        self.assertEqual(cards[0]["zip_code"], "44070")

    def test_bandzoogle_table_location_parser_accepts_ohio_and_city_zip(self):
        self.assertEqual(
            artist_gig_tracker.parse_bandzoogle_location("GAR Hall, Peninsula, Ohio"),
            ("GAR Hall", "", "Peninsula", ""),
        )
        self.assertEqual(
            artist_gig_tracker.parse_bandzoogle_location("Regency Wine Sellers, Fairlawn 44333"),
            ("Regency Wine Sellers", "", "Fairlawn", "44333"),
        )

    def test_squarespace_tourdates_parser_extracts_bandsintown_events(self):
        original_fetch = artist_gig_tracker.fetch_url
        page_html = """
            <script>Static.SQUARESPACE_CONTEXT = {"website":{"identifier":"madison-cummins"}}</script>
            <div class="sqs-block tourdates-block"
              data-block-json="&#123;&quot;artistId&quot;:&quot;Madison Cummins&quot;,&quot;timeframe&quot;:&quot;upcoming&quot;&#125;"
              data-block-type="59"></div>
        """
        api_json = """
            [
              {
                "id": "107956379",
                "title": "Madison Cummins at Rocky River Wine Bar's Sunday Brunch",
                "starts_at": "2026-06-14T10:00:00",
                "ends_at": "2026-06-14T13:00:00",
                "url": "https://www.bandsintown.com/e/107956379",
                "description": "Brunch show",
                "venue": {
                  "name": "Madison Cummins at Rocky River Wine Bar's Sunday Brunch",
                  "street_address": "1313 Linda St",
                  "city": "Rocky River",
                  "region": "OH",
                  "country": "United States",
                  "postal_code": "44116"
                }
              },
              {
                "id": "out-of-state",
                "title": "Madison Cummins at Somewhere",
                "starts_at": "2026-06-15T19:00:00",
                "venue": {"name": "Somewhere", "city": "Detroit", "region": "MI", "country": "United States"}
              }
            ]
        """

        def fake_fetch(url):
            return api_json if "rest.bandsintown.com" in url else page_html

        artist_gig_tracker.fetch_url = fake_fetch
        try:
            events = artist_gig_tracker.parse_squarespace_tourdates_calendar({
                "artist_id": "artist-madison-cummins",
                "canonical_name": "Madison Cummins",
                "artist_type": "solo",
                "website": "https://www.madisoncummins.com/showdates",
            }, logging.getLogger("test"))
        finally:
            artist_gig_tracker.fetch_url = original_fetch

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_date, "2026-06-14")
        self.assertEqual(events[0].start_time, "10:00AM")
        self.assertEqual(events[0].end_time, "1:00PM")
        self.assertEqual(events[0].venue_name, "Rocky River Wine Bar")

    def test_rob_rocks_parser_handles_multi_time_and_pib_alias(self):
        events = artist_gig_tracker.parse_rob_rocks_schedule_lines([
            "2026",
            "6/15 The Keys - PIB 2-4pm, 6-9pm",
        ], {
            "artist_id": "artist-rob-rocks",
            "canonical_name": "Rob Rocks",
            "artist_type": "solo",
            "website": "https://robrockscle.com/home",
        })

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_date, "2026-06-15")
        self.assertEqual(events[0].venue_name, "The Keys Put-In-Bay")
        self.assertEqual(events[0].city, "Put-In-Bay")
        self.assertEqual(events[0].start_time, "2PM & 6PM")
        self.assertEqual(events[0].end_time, "4PM & 9PM")

    def test_rob_rocks_parser_keeps_private_event_out_of_venues(self):
        events = artist_gig_tracker.parse_rob_rocks_schedule_lines([
            "2026",
            "6/13 Private Event",
        ], {
            "artist_id": "artist-rob-rocks",
            "canonical_name": "Rob Rocks",
            "artist_type": "solo",
            "website": "https://robrockscle.com/home",
        })

        self.assertEqual(events[0].venue_name, "Private Event")
        self.assertFalse(artist_gig_tracker.should_materialize_venue(events[0]))

    def test_rob_rocks_bait_house_sandusky_uses_brewery_name(self):
        events = artist_gig_tracker.parse_rob_rocks_schedule_lines([
            "2026",
            "5/22 Bait House - Sandusky 6pm",
        ], {
            "artist_id": "artist-rob-rocks",
            "canonical_name": "Rob Rocks",
            "artist_type": "solo",
            "website": "https://robrockscle.com/home",
        })

        self.assertEqual(events[0].venue_name, "Bait House Brewery")
        self.assertEqual(events[0].city, "Sandusky")
        self.assertEqual(events[0].start_time, "6PM")

    def test_rob_rocks_no_dash_known_venue_still_gets_city(self):
        events = artist_gig_tracker.parse_rob_rocks_schedule_lines([
            "2026",
            "5/29 Mad River Harley Davidson 3:30pm",
        ], {
            "artist_id": "artist-rob-rocks",
            "canonical_name": "Rob Rocks",
            "artist_type": "solo",
            "website": "https://robrockscle.com/home",
        })

        self.assertEqual(events[0].venue_name, "Mad River Harley-Davidson")
        self.assertEqual(events[0].city, "Sandusky")

    def test_scraper_venue_alias_does_not_match_on_generic_name_words_only(self):
        scraper_row = {
            "venue_id": "venue-edgewater-yacht-club-e65e4cf2",
            "place_name": "Edgewater Yacht Club",
            "city": "Cleveland",
            "zip": "44102",
            "source": "artist_site_sync",
        }
        master_row = {
            "venue_id": "dusty-s-yacht-club-akron-oh-44319",
            "place_name": "Dusty's Yacht Club",
            "address": "4764 Dustys Rd",
            "city": "Akron",
            "zip": "44319",
            "source": "master_sheet_sheet1",
        }

        self.assertEqual(artist_gig_tracker.find_master_venue_alias(scraper_row, {master_row["venue_id"]: master_row}), "")

    def test_austin_official_json_parser_filters_noise_and_parses_ohio_gigs(self):
        events = artist_gig_tracker.parse_austin_official_events("""
            <script type="application/ld+json">
            [
              {
                "@context": "http://schema.org",
                "@type": "Event",
                "name": "Music Box w/ Johnny Rawls • CLE, OH • 7:30pm",
                "url": "https://walkincane.com/event/music-box/",
                "startDate": "2026-02-27T19:30:00+00:00",
                "endDate": "2026-02-27T22:00:00+00:00"
              },
              {
                "@context": "http://schema.org",
                "@type": "Event",
                "name": "Every Tuesday • WRUW • 91.1 fm • Ivy’s Red Sweater • noon-2pm",
                "url": "https://walkincane.com/event/wruw/",
                "startDate": "2026-03-03T12:00:00+00:00",
                "endDate": "2026-03-03T14:00:00+00:00"
              },
              {
                "@context": "http://schema.org",
                "@type": "Event",
                "name": "Johnny Rawls • Monroe, MI • TBA",
                "url": "https://walkincane.com/event/monroe/",
                "startDate": "2026-02-17T00:00:00+00:00"
              }
            ]
            </script>
        """, "https://walkincane.com/events/list/", {
            "artist_id": "artist-austin",
            "canonical_name": "Austin Walkin' Cane",
            "artist_type": "solo",
            "website": "https://walkincane.com/",
        })

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].venue_name, "Music Box Supper Club")
        self.assertEqual(events[0].city, "Cleveland")
        self.assertEqual(events[0].start_time, "7:30PM")

    def test_austin_squarespace_parser_finds_future_forest_city_gig(self):
        events = artist_gig_tracker.parse_austin_squarespace_events("""
            <h1>Austin Walkin' Cane</h1>
            <p>Friday, May 22, 2026</p>
            <p>5:00 PM</p>
            <p>7:00 PM</p>
            <p>Forest City Brewery</p>
        """, "https://www.forestcitybrewery.com/events", {
            "artist_id": "artist-austin",
            "canonical_name": "Austin Walkin' Cane",
            "artist_type": "solo",
            "website": "https://walkincane.com/",
        })

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_date, "2026-05-22")
        self.assertEqual(events[0].venue_name, "Forest City Brewery")
        self.assertEqual(events[0].city, "Cleveland")

    def test_austin_kent_parser_adds_festival_date(self):
        events = artist_gig_tracker.parse_austin_kent_blues_events("""
            <p>July 18, 2026 - Downtown, Kent OH</p>
            <h1>Austin Walkin’ Cane</h1>
        """, "https://www.kentbluesfest.com/artist/austin-walkin-cane", {
            "artist_id": "artist-austin",
            "canonical_name": "Austin Walkin' Cane",
            "artist_type": "solo",
            "website": "https://walkincane.com/",
        })

        self.assertEqual(events[0].venue_name, "Kent Blues Fest")
        self.assertEqual(events[0].event_date, "2026-07-18")

    def test_exact_name_match_requires_city_when_city_is_known(self):
        venues = [
            {
                "venue_id": "venue-rush-inn-avon",
                "place_name": "Rush Inn",
                "city": "Avon",
                "state": "OH",
            }
        ]
        event = self.make_event(
            venue_name="Rush Inn",
            city="Lakewood",
            title="Austin Walkin' Cane @ Rush Inn",
            artist_name="Austin Walkin' Cane",
        )

        self.assertEqual(artist_gig_tracker.match_venue_id(venues, event), "")

    def test_likely_same_venue_does_not_use_venue_name_as_city_overlap(self):
        row = {
            "venue_id": "venue-rush-inn-avon",
            "place_name": "Rush Inn",
            "city": "Avon",
            "state": "OH",
        }
        event = self.make_event(
            venue_name="Rush Inn",
            city="Lakewood",
            title="Austin Walkin' Cane @ Rush Inn",
            artist_name="Austin Walkin' Cane",
            description="Rush Inn • Lakewood, OH • 8-11pm",
        )

        self.assertFalse(artist_gig_tracker.likely_same_venue(row, event))

    def test_scraper_alias_does_not_merge_same_name_different_city_without_address(self):
        scraper_row = {
            "venue_id": "venue-ridge-rail-sharon-center",
            "place_name": "Ridge & Rail",
            "city": "Sharon Center",
            "source": "artist_site_sync",
        }
        master_row = {
            "venue_id": "ridge-and-rail-wadsworth-oh-44281",
            "place_name": "Ridge & Rail",
            "address": "6784 Ridge Rd",
            "city": "Wadsworth",
            "zip": "44281",
            "source": "master_sheet_sheet1",
        }

        self.assertEqual(artist_gig_tracker.find_master_venue_alias(scraper_row, {master_row["venue_id"]: master_row}), "")

    def test_little_steve_o_weekly_post_parser_extracts_multiple_gigs(self):
        events = artist_gig_tracker.parse_little_steve_o_post_text(
            "FRI 5/15 GLENWILLOW GRILLE in Solon w/WES 7:30-10:30 pm "
            "SAT 5/16 BEAU'S GRILLE (DoubleTree) in Fairlawn 7-10 pm "
            "SUN 5/17 STILLHOUSE/GERVASI in Canton 7-10 pm",
            2026,
            {
                "artist_id": "artist-little-steve-o",
                "canonical_name": "Little Steve-O",
                "artist_type": "solo",
                "website": "https://www.littlesteveo.com/",
            },
            "https://www.littlesteveo.com/2026/05/little-steve-o-this-week.html",
        )

        self.assertEqual(len(events), 3)
        self.assertEqual(events[0].event_date, "2026-05-15")
        self.assertEqual(events[0].venue_name, "Glenwillow Grille")
        self.assertEqual(events[0].city, "Solon")
        self.assertEqual(events[0].start_time, "7:30PM")
        self.assertEqual(events[0].end_time, "10:30PM")
        self.assertEqual(events[1].venue_name, "Beau's Grille")
        self.assertEqual(events[2].venue_name, "Gervasi Vineyard")

    def test_little_steve_o_private_event_does_not_become_venue(self):
        events = artist_gig_tracker.parse_little_steve_o_post_text(
            "FRI 5/8 PRIVATE EVENT in Mantua 7 pm",
            2026,
            {
                "artist_id": "artist-little-steve-o",
                "canonical_name": "Little Steve-O",
                "artist_type": "solo",
                "website": "https://www.littlesteveo.com/",
            },
            "https://www.littlesteveo.com/2026/05/little-steve-o-this-week.html",
        )

        self.assertEqual(events[0].venue_name, "Private Event")
        self.assertEqual(events[0].city, "Mantua")
        self.assertFalse(artist_gig_tracker.should_materialize_venue(events[0]))

    def test_little_steve_o_recovered_future_events_include_beaus_bar(self):
        events = artist_gig_tracker.little_steve_o_recovered_events({
            "artist_id": "artist-little-steve-o",
            "canonical_name": "Little Steve-O",
            "artist_type": "solo",
            "website": "https://www.littlesteveo.com/",
        })

        self.assertEqual(events[0].venue_name, "Beau's Bar & Bistro")
        self.assertEqual(events[0].event_date, "2026-06-05")
        self.assertEqual(events[1].event_date, "2026-07-10")


if __name__ == "__main__":
    unittest.main()
