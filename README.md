# Google Maps Accommodation Scraper MVP

Human-in-the-loop MVP scraper for collecting accommodation places from Google Maps without requiring a Google login.

## What it does

- Opens Google Maps search for a query (for example `hotels in Sardinia`)
- Scrolls the left result panel and collects place URLs
- Visits each place page and extracts:
  - name
  - category
  - rating
  - review count
  - phone
  - website
  - address
  - lat/lng (parsed from URL)
  - top review snippets (best effort)
- Writes `JSON` and `CSV`
- Saves checkpoints so runs can resume

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm run dev -- --query "hotels in Sardinia" --max-places 150 --out-dir data/sardinia
```

Common flags:

- `--query` search query (default: `hotels in Sardinia`)
- `--max-places` max place pages to scrape (default: `250`)
- `--scroll-steps` max scroll cycles in result feed (default: `60`)
- `--out-dir` output directory (default: `data`)
- `--headless true|false` run browser headless (default: `false`)
- `--delay-ms` delay between detail page scrapes (default: `1200`)
- `--review-limit` max top review snippets to capture per place (default: `3`)
- `--resume true` continue from existing checkpoint

Resume example:

```bash
npm run dev -- --query "hotels in Sardinia" --out-dir data/sardinia --resume true
```

## Output files

- `checkpoint.json` incremental run state
- `results.json` final structured output
- `results.csv` spreadsheet-friendly output
- `profile/` persistent Chromium profile

## Manual intervention behavior

If a challenge page is detected (`captcha`, `verify you are human`, `unusual traffic`), the script pauses and asks you to solve it in the browser, then press Enter in terminal to continue.

## Notes

- Selectors on Google Maps can change, so extraction is best-effort and may require selector updates.
- This MVP is intentionally simple and optimized for quick iteration.
