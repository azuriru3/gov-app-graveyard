# Gov App Graveyard

![Refresh workflow](https://github.com/azuriru3/gov-app-graveyard/actions/workflows/refresh.yml/badge.svg)

Malaysia's official [GAMMA app registry](https://data.gov.my/data-catalogue/government_apps) lists 500+ government mobile apps. This dashboard tracks how many of them are actually still maintained.

**[View the live dashboard](https://azuriru3.github.io/gov-app-graveyard/)**

## What this shows

- What fraction of official apps haven't been updated in 1, 3+ years
- A "Hall of Shame" of critical (health/disaster/food-safety) apps that are effectively abandoned
- For iOS apps, an independent cross-check of the registry's self-reported update date against Apple's own App Store record

## How it works

A GitHub Actions workflow refreshes the data weekly: it downloads the official CSV, classifies every app's staleness, cross-checks iOS apps against the iTunes Search API, and redeploys the static dashboard. See [the design spec](docs/superpowers/specs/2026-07-05-gov-app-graveyard-design.md) for full methodology.

Think an app here is mischaracterized? [Open a correction](../../issues/new?template=correction.md). This is independent analysis of public data, not an official statement.

## Development

```bash
npm test          # run the unit tests
npm run generate  # fetch fresh data and regenerate data.json
npm run dev       # serve the dashboard locally at http://localhost:8080
```
