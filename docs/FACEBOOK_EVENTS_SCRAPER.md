# Facebook Events Scraper

Scrapes public Facebook Events for musicians, bands, venues, and pages from a CSV/XLSX input list. It shares the same SQLite `events` table used by the Google and general Facebook scrapers, and also writes a richer `facebook_events` table.

## Setup

```bash
python3 -m pip install -r requirements-scraper.txt
python3 -m playwright install chromium
```

Log in once and save cookies:

```bash
npm run music:facebook-events-login
```

## Input

CSV or XLSX with one entity per row. Recommended headers:

```csv
name,facebook_url,type
Rob Rocks,https://www.facebook.com/robrockscle,musician
Baci Winery,https://www.facebook.com/baciwinery,venue
Maria Petti,https://www.facebook.com/mariapettimusic,musician
```

If `facebook_url` is blank, the scraper searches Facebook for the page/profile first.

## Run

```bash
npm run music:facebook-events -- --input data/artists.csv --limit 50 --mode all
```

Future events only:

```bash
npm run music:facebook-events -- --input data/artists.csv --mode future_only
```

Visible debugging:

```bash
npm run music:facebook-events -- --input data/artists.csv --no-headless --slow-mo 80
```

Outputs are written to:

- SQLite: `data/scraped/neo_live_music.sqlite3`
- CSV/JSON: `data/scraped/live_music/facebook_events/`

## Notes

- Public or account-visible Events only.
- Low-volume personal use is the intended mode.
- The scraper does not bypass private groups/pages, restricted events, login walls, CAPTCHAs, or Facebook access controls.
