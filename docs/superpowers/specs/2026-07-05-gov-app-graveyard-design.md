# Gov App Graveyard — Design

## Purpose

Malaysia's official GAMMA registry (`government_apps.csv` on data.gov.my) lists 553+
official government mobile apps. A quick analysis during brainstorming found that
while only 52 are formally marked "shutdown," 367 (67%) of the rest haven't been
updated in over a year, and 240 (43%) haven't been updated in 3+ years, including
apps in safety-relevant categories (e.g. a disaster-response app untouched since 2016).

This project ships a small, shareable, always-fresh dashboard that makes this
finding visible: which official apps are actually alive, which are de facto
abandoned, and which of the abandoned ones matter (health, safety, disaster,
citizen services). The goal is to spark public discussion about government app
maintenance, backed by verifiable public data rather than anecdote.

This is the first of two planned projects. A second project, an actual Android
app replacement for whichever neglected-but-needed category this dashboard
surfaces as worst, is intended as a follow-up. That second project is out of
scope for this spec.

## Non-goals

- No live "is my kid's school closed today" tracking (no official API exists for
  this; explored and rejected during brainstorming).
- No Google Play scraping for Android ratings (no official API; ToS-fragile;
  rejected in favor of iOS-only ratings via the official iTunes Search API).
- No full NLP/automated agency classification — a curated list of well-known
  apps plus an "Unclassified" bucket is used instead.
- No backend, database, or user accounts. Fully static.

## Architecture

A GitHub Actions workflow runs weekly on a cron schedule. It downloads the
official CSV, computes per-app staleness, cross-checks iOS apps against the
public iTunes Search API, and writes the result to `data.json`. A static
HTML/CSS/JS page (no framework) fetches `data.json` client-side and renders the
dashboard. The same workflow deploys the static files to GitHub Pages. There is
no backend and no database — `data.json`, committed to the repo, is the only
persisted state. If a weekly run fails, the site keeps serving the last
successfully-generated `data.json` rather than going blank or partial.

## Data sources

- **`https://storage.data.gov.my/publicadmin/government_apps.csv`** — official
  Malaysian government app registry (GAMMA). One row per app per OS platform.
  Columns used: `app_id`, `app_name`, `app_os_platform`, `released`,
  `last_updated`, `shutdown`, `purpose`.
- **`https://itunes.apple.com/search?term=<app_name>&country=my`** — official,
  public, unauthenticated Apple endpoint. Used only for apps that shipped on
  iOS, to fetch `currentVersionReleaseDate`, `averageUserRating`, and
  `userRatingCount` as an independent cross-check against the CSV's
  self-reported `last_updated`. No Apple device or account needed — it's a
  plain HTTP endpoint called from the CI script.

## Components

- **`scripts/fetch-and-analyze.js`** — the whole pipeline:
  1. Downloads the CSV fresh.
  2. Groups rows by `app_id` into one record per app (the CSV has a row per OS
     platform), keeping the latest `last_updated` and any `shutdown` date
     across platforms, and recording which platforms it shipped on.
  3. For apps that shipped on iOS, queries the iTunes Search API by name (with
     a manual override map in the script for apps where fuzzy name-matching
     picks the wrong result or the app isn't found), with a small delay
     between requests and retry-on-failure so one bad lookup doesn't block the
     run.
  4. Computes a `status` per app: `shutdown` / `active-fresh` (<1yr) /
     `active-stale` (1-3yr) / `active-abandoned` (3yr+) — preferring the
     iTunes date when available, falling back to the CSV's own `last_updated`
     otherwise.
  5. Tags each app with an agency from a curated list (~30-40 well-known
     apps, e.g. MyJPJ→JPJ, myHealth→MOH, myCuaca→MetMalaysia); anything not in
     the list is tagged `Unclassified`.
  6. Flags Hall-of-Shame candidates: `active-abandoned` AND tagged as a
     safety/health/disaster/citizen-critical-service category. (Not every
     stale app qualifies — a simple utility app that's simply "done" doesn't
     belong here.)
  7. Writes `data.json`: summary stats, the full per-app array, the
     Hall-of-Shame subset, and a `generatedAt` timestamp.
- **`data.json`** — the single generated artifact the frontend reads. Also
  serves as the "last known good" state if a future run fails.
- **`index.html` / `app.js` / `style.css`** — the dashboard: headline stats
  (e.g. "553 apps, 43% untouched 3+ years"), a sortable/filterable table of all
  apps, a Hall-of-Shame section (app, category, years since update, iOS rating
  if available), an age-distribution chart (Chart.js), and a "How we calculate
  this" methodology/disclaimer section (data source, staleness thresholds,
  Hall-of-Shame criteria, and a note that this is independent analysis of
  public data, not an official statement).
- **`.github/workflows/refresh.yml`** — runs `fetch-and-analyze.js` weekly,
  runs the `data.json` schema/sanity check, and only if that passes commits
  `data.json` (if changed) and deploys the static files to GitHub Pages. If the
  fetch or validation fails, the workflow fails loudly (for maintainer
  notification) without touching the committed `data.json` or redeploying.
- **`.github/ISSUE_TEMPLATE/correction.md`** — lets anyone (including the
  agency itself) contest an entry ("this app is actually maintained — here's
  evidence"), with fields for app name and supporting evidence/link.
- **`README.md`** — screenshot/GIF of the live dashboard, one-line hook, link
  to the live GitHub Pages site, workflow-status and last-refreshed-date
  badges, the methodology/disclaimer section, and data source credits.
- **`tests/`** — unit tests for the pure logic: CSV row dedup by `app_id`,
  staleness classification thresholds, and the Hall-of-Shame filter rule.

## Data flow

1. Weekly cron triggers the GitHub Actions workflow.
2. `fetch-and-analyze.js` downloads the CSV.
3. Rows are deduped/grouped into one record per app.
4. iOS apps are cross-checked against the iTunes Search API.
5. Each app gets a computed `status`.
6. Apps are tagged with a curated agency or `Unclassified`.
7. Hall-of-Shame candidates are flagged.
8. `data.json` is written.
9. The `data.json` schema/sanity check runs; only on success does the workflow
   commit `data.json` (if changed) and deploy the static site to GitHub Pages.
10. The browser loads the Pages site and fetches `data.json` client-side —
    no server, no build step for the frontend itself.

## Error handling

- CSV fetch fails → abort the run, keep last week's `data.json`, no
  commit/deploy; the workflow run fails loudly in GitHub Actions.
- An individual iTunes lookup fails or is ambiguous → that app falls back to
  CSV-only staleness (no rating shown); the run continues for all other apps.
- Generated `data.json` fails the sanity check (empty, missing required
  fields) → abort before commit/deploy; last-known-good `data.json` keeps
  serving.

## Testing

- Unit tests for CSV row-dedup-by-`app_id` logic.
- Unit tests for the staleness classification thresholds (`shutdown` /
  `active-fresh` / `active-stale` / `active-abandoned`).
- Unit tests for the Hall-of-Shame filter rule.
- A schema/sanity check on generated `data.json` (non-empty, required fields
  present) that gates the commit+deploy step.
- No browser/UI test suite — the frontend renders trusted local JSON with no
  interactive logic complex enough to warrant it.
