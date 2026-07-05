# MyGov App Graveyard Implementation Plan

**Goal:** Ship a static, weekly-refreshing dashboard that shows which of Malaysia's 553+ official government apps are actively maintained vs. de facto abandoned, with a "Hall of Shame" for neglected health/disaster/safety apps.

**Architecture:** A GitHub Actions workflow runs weekly, downloads the official GAMMA app registry CSV, classifies every app's staleness, cross-checks iOS apps against Apple's public iTunes Search API, writes `data.json`, and deploys a static HTML/CSS/JS page (no framework, no backend, no database) to GitHub Pages. The static page fetches `data.json` client-side at load time.

**Tech Stack:** Node.js (built-in `fetch`, `node:test`, `node:assert/strict`, ESM modules) for the data pipeline; plain HTML/CSS/JS + Chart.js (via CDN) for the frontend; GitHub Actions + GitHub Pages for hosting and scheduling.

## Global Constraints

- Data source: `https://storage.data.gov.my/publicadmin/government_apps.csv` (official Malaysia GAMMA registry).
- iOS cross-check source: `https://itunes.apple.com/search` (public, unauthenticated, `country=my`).
- Staleness thresholds: `active-fresh` if updated <365 days ago, `active-stale` if 365–1095 days ago, `active-abandoned` if ≥1095 days ago **or if no update date was ever recorded**. Any app with a `shutdown` date is `shutdown` regardless of `lastUpdated`.
- Hall of Shame = apps that are `active-abandoned` **AND** hand-tagged critical (health/disaster/food-safety). Not every stale app qualifies.
- No backend, no database — fully static site. `data.json`, committed to the repo, is the only persisted generated state.
- Refresh cadence: weekly via GitHub Actions cron. A run that fails CSV fetch or produces an invalid dataset must NOT overwrite `data.json` or trigger a redeploy — the site keeps serving the last known-good data.
- No Android/Play Store ratings in v1 (no official API exists) — Android-only apps show staleness only, no rating.
- No runtime dependencies beyond Chart.js loaded via CDN in the browser. All Node scripts use built-ins only — no `npm install` needed.
- iTunes lookups must be polite: a delay between requests plus retry-on-failure, so one bad lookup doesn't block the whole run.

---

## File Structure

```
mygov-app-graveyard/
├── package.json
├── .gitignore
├── data.json                          (generated, committed)
├── index.html
├── style.css
├── app.js
├── scripts/
│   ├── fetch-and-analyze.js           (orchestrator + CLI entrypoint)
│   ├── dev-server.js                  (zero-dep local static server)
│   └── lib/
│       ├── csv.js                     (download + parse + dedupe)
│       ├── classify.js                (staleness status)
│       ├── agencies.js                (curated agency + critical-app tags)
│       ├── hallOfShame.js             (Hall of Shame filter)
│       ├── itunes.js                  (iTunes Search API cross-check)
│       └── validate.js                (data.json schema/sanity check)
├── tests/
│   ├── csv.test.js
│   ├── classify.test.js
│   ├── agencies.test.js
│   ├── hallOfShame.test.js
│   ├── itunes.test.js
│   ├── validate.test.js
│   └── fetch-and-analyze.test.js
└── .github/
    ├── workflows/refresh.yml
    └── ISSUE_TEMPLATE/correction.md
```

---

### Task 1: Project scaffold + CSV fetch/parse/dedupe

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `scripts/lib/csv.js`
- Test: `tests/csv.test.js`

**Interfaces:**
- Produces: `CSV_URL` (string constant), `parseCsvLine(line: string): string[]`, `parseGovAppsCsv(csvText: string): RawRow[]` where `RawRow = { app_id, app_name, app_os_platform, released, last_updated, shutdown }` (all strings except `released`/`last_updated`/`shutdown` which are `string | null`), `dedupeApps(rows: RawRow[]): App[]` where `App = { appId, appName, platforms: string[], released, lastUpdated, shutdown }`, `fetchGovAppsCsv(fetchImpl?: typeof fetch): Promise<string>`.

- [ ] **Step 1: Create the project scaffold**

Create `package.json`:

```json
{
  "name": "mygov-app-graveyard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "generate": "node scripts/fetch-and-analyze.js",
    "dev": "node scripts/dev-server.js"
  }
}
```

Create `.gitignore`:

```
node_modules/
.DS_Store
```

- [ ] **Step 2: Write the failing tests**

Create `tests/csv.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvLine, parseGovAppsCsv, dedupeApps, fetchGovAppsCsv, CSV_URL } from '../scripts/lib/csv.js';

test('parseCsvLine splits the first 6 commas and lumps the rest into the 7th field', () => {
  const fields = parseCsvLine('35,myHRMIS Mobile,Android,2014-12-18,2026-02-24,,Aplikasi, with, commas');
  assert.deepEqual(fields, ['35', 'myHRMIS Mobile', 'Android', '2014-12-18', '2026-02-24', '', 'Aplikasi, with, commas']);
});

test('parseGovAppsCsv skips the header and parses rows into raw row objects', () => {
  const csv = [
    'app_id,app_name,app_os_platform,released,last_updated,shutdown,purpose',
    '35,myCuaca,Android,2015-04-21,2024-10-11,,myCuaca oleh JMM',
    '35,myCuaca,iOS,2015-04-21,2024-10-11,,myCuaca oleh JMM',
  ].join('\n');

  const rows = parseGovAppsCsv(csv);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    app_id: '35',
    app_name: 'myCuaca',
    app_os_platform: 'Android',
    released: '2015-04-21',
    last_updated: '2024-10-11',
    shutdown: null,
  });
});

test('dedupeApps merges rows for the same app_id across platforms, keeping the latest lastUpdated', () => {
  const rows = [
    { app_id: '35', app_name: 'myCuaca', app_os_platform: 'Android', released: '2015-04-21', last_updated: '2020-01-01', shutdown: null },
    { app_id: '35', app_name: 'myCuaca', app_os_platform: 'iOS', released: '2015-04-21', last_updated: '2024-10-11', shutdown: null },
  ];

  const apps = dedupeApps(rows);

  assert.equal(apps.length, 1);
  assert.deepEqual(apps[0], {
    appId: '35',
    appName: 'myCuaca',
    platforms: ['Android', 'iOS'],
    released: '2015-04-21',
    lastUpdated: '2024-10-11',
    shutdown: null,
  });
});

test('dedupeApps keeps the shutdown date once any platform row reports one', () => {
  const rows = [
    { app_id: '119', app_name: 'MARDI Tek. Kambing Pedaging', app_os_platform: 'Android', released: '2015-12-22', last_updated: '2023-08-15', shutdown: null },
    { app_id: '119', app_name: 'MARDI Tek. Kambing Pedaging', app_os_platform: 'iOS', released: '2015-12-22', last_updated: '2023-08-15', shutdown: '2023-08-15' },
  ];

  const apps = dedupeApps(rows);

  assert.equal(apps[0].shutdown, '2023-08-15');
});

test('fetchGovAppsCsv requests the official CSV_URL and returns the body text', async () => {
  let requestedUrl;
  const fakeFetch = async (url) => {
    requestedUrl = url;
    return { ok: true, text: async () => 'app_id,app_name\n1,Test' };
  };

  const text = await fetchGovAppsCsv(fakeFetch);

  assert.equal(requestedUrl, CSV_URL);
  assert.equal(text, 'app_id,app_name\n1,Test');
});

test('fetchGovAppsCsv throws when the response is not ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => fetchGovAppsCsv(fakeFetch), /HTTP 500/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/lib/csv.js'`

- [ ] **Step 4: Implement `scripts/lib/csv.js`**

```js
export const CSV_URL = 'https://storage.data.gov.my/publicadmin/government_apps.csv';

// The CSV has exactly 7 columns and the last one ("purpose") is inconsistent
// free text that sometimes contains unescaped commas. We never read
// "purpose", so we only need the first 6 fields split correctly: split on
// the first 6 commas and lump everything after that into the 7th field.
export function parseCsvLine(line) {
  const commaPositions = [];
  for (let i = 0; i < line.length && commaPositions.length < 6; i++) {
    if (line[i] === ',') commaPositions.push(i);
  }
  const fields = [];
  let start = 0;
  for (const pos of commaPositions) {
    fields.push(line.slice(start, pos));
    start = pos + 1;
  }
  fields.push(line.slice(start));
  return fields;
}

export function parseGovAppsCsv(csvText) {
  const lines = csvText
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const [, ...dataLines] = lines;

  return dataLines.map((line) => {
    const [app_id, app_name, app_os_platform, released, last_updated, shutdown] = parseCsvLine(line);
    return {
      app_id,
      app_name,
      app_os_platform,
      released: released || null,
      last_updated: last_updated || null,
      shutdown: shutdown || null,
    };
  });
}

export function dedupeApps(rows) {
  const byId = new Map();

  for (const row of rows) {
    const existing = byId.get(row.app_id);
    if (!existing) {
      byId.set(row.app_id, {
        appId: row.app_id,
        appName: row.app_name,
        platforms: [row.app_os_platform],
        released: row.released,
        lastUpdated: row.last_updated,
        shutdown: row.shutdown,
      });
      continue;
    }
    if (!existing.platforms.includes(row.app_os_platform)) {
      existing.platforms.push(row.app_os_platform);
    }
    if (row.last_updated && (!existing.lastUpdated || row.last_updated > existing.lastUpdated)) {
      existing.lastUpdated = row.last_updated;
    }
    if (row.shutdown && !existing.shutdown) {
      existing.shutdown = row.shutdown;
    }
  }

  return [...byId.values()];
}

export async function fetchGovAppsCsv(fetchImpl = fetch) {
  const res = await fetchImpl(CSV_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch government apps CSV: HTTP ${res.status}`);
  }
  return res.text();
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 tests in `tests/csv.test.js` green.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore scripts/lib/csv.js tests/csv.test.js
git commit -m "feat: add CSV fetch/parse/dedupe module"
```

---

### Task 2: Staleness classification

**Files:**
- Create: `scripts/lib/classify.js`
- Test: `tests/classify.test.js`

**Interfaces:**
- Consumes: none.
- Produces: `STATUS` object with keys `SHUTDOWN`, `FRESH`, `STALE`, `ABANDONED` (values `'shutdown'`, `'active-fresh'`, `'active-stale'`, `'active-abandoned'`), and `classifyApp(app: { shutdown: string|null, lastUpdated: string|null }, today: Date): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/classify.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyApp, STATUS } from '../scripts/lib/classify.js';

const TODAY = new Date('2026-07-05T00:00:00Z');

test('an app with a shutdown date is always shutdown, regardless of lastUpdated', () => {
  const status = classifyApp({ shutdown: '2020-01-01', lastUpdated: '2026-07-01' }, TODAY);
  assert.equal(status, STATUS.SHUTDOWN);
});

test('an app updated less than a year ago is active-fresh', () => {
  const status = classifyApp({ shutdown: null, lastUpdated: '2026-01-01' }, TODAY);
  assert.equal(status, STATUS.FRESH);
});

test('an app updated between 1 and 3 years ago is active-stale', () => {
  const status = classifyApp({ shutdown: null, lastUpdated: '2024-01-01' }, TODAY);
  assert.equal(status, STATUS.STALE);
});

test('an app updated 3+ years ago is active-abandoned', () => {
  const status = classifyApp({ shutdown: null, lastUpdated: '2015-04-21' }, TODAY);
  assert.equal(status, STATUS.ABANDONED);
});

test('an app with no recorded lastUpdated is treated as active-abandoned', () => {
  const status = classifyApp({ shutdown: null, lastUpdated: null }, TODAY);
  assert.equal(status, STATUS.ABANDONED);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/lib/classify.js'`

- [ ] **Step 3: Implement `scripts/lib/classify.js`**

```js
export const STATUS = Object.freeze({
  SHUTDOWN: 'shutdown',
  FRESH: 'active-fresh',
  STALE: 'active-stale',
  ABANDONED: 'active-abandoned',
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const FRESH_THRESHOLD_DAYS = 365;
const STALE_THRESHOLD_DAYS = 365 * 3;

export function classifyApp(app, today) {
  if (app.shutdown) {
    return STATUS.SHUTDOWN;
  }
  if (!app.lastUpdated) {
    // No recorded update date at all is treated as the worst case: we can't
    // tell whether the app is fine or simply never reports updates.
    return STATUS.ABANDONED;
  }
  const daysSinceUpdate = (today - new Date(app.lastUpdated)) / MS_PER_DAY;
  if (daysSinceUpdate < FRESH_THRESHOLD_DAYS) {
    return STATUS.FRESH;
  }
  if (daysSinceUpdate < STALE_THRESHOLD_DAYS) {
    return STATUS.STALE;
  }
  return STATUS.ABANDONED;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 5 tests in `tests/classify.test.js` green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/classify.js tests/classify.test.js
git commit -m "feat: add staleness classification"
```

---

### Task 3: Agency tagging + Hall of Shame filter

**Files:**
- Create: `scripts/lib/agencies.js`
- Create: `scripts/lib/hallOfShame.js`
- Test: `tests/agencies.test.js`
- Test: `tests/hallOfShame.test.js`

**Interfaces:**
- Consumes: `STATUS` from `scripts/lib/classify.js` (Task 2).
- Produces: `tagAgency(appName: string): string`, `isCriticalApp(appName: string): boolean`, `UNCLASSIFIED` (string constant), `isHallOfShameCandidate(app: { status: string, isCritical: boolean }): boolean`, `buildHallOfShame(apps: Array<{status, isCritical}>): Array`.

- [ ] **Step 1: Write the failing tests**

Create `tests/agencies.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagAgency, isCriticalApp, UNCLASSIFIED } from '../scripts/lib/agencies.js';

test('tagAgency returns the curated agency for a known app', () => {
  assert.equal(tagAgency('myCuaca'), 'Malaysian Meteorological Department (MetMalaysia)');
});

test('tagAgency returns Unclassified for an app not in the curated list', () => {
  assert.equal(tagAgency('Some Random App'), UNCLASSIFIED);
});

test('isCriticalApp is true for curated health/disaster apps', () => {
  assert.equal(isCriticalApp('MySejahtera'), true);
});

test('isCriticalApp is false for a non-critical curated app', () => {
  assert.equal(isCriticalApp('MyJPJ'), false);
});

test('isCriticalApp is false for an unclassified app', () => {
  assert.equal(isCriticalApp('Some Random App'), false);
});
```

Create `tests/hallOfShame.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHallOfShameCandidate, buildHallOfShame } from '../scripts/lib/hallOfShame.js';
import { STATUS } from '../scripts/lib/classify.js';

test('an abandoned, critical app is a Hall of Shame candidate', () => {
  assert.equal(isHallOfShameCandidate({ status: STATUS.ABANDONED, isCritical: true }), true);
});

test('an abandoned but non-critical app is not a candidate', () => {
  assert.equal(isHallOfShameCandidate({ status: STATUS.ABANDONED, isCritical: false }), false);
});

test('a critical app that is merely stale (not abandoned) is not a candidate', () => {
  assert.equal(isHallOfShameCandidate({ status: STATUS.STALE, isCritical: true }), false);
});

test('buildHallOfShame filters a mixed list down to only the candidates', () => {
  const apps = [
    { appName: 'A', status: STATUS.ABANDONED, isCritical: true },
    { appName: 'B', status: STATUS.ABANDONED, isCritical: false },
    { appName: 'C', status: STATUS.FRESH, isCritical: true },
  ];
  const result = buildHallOfShame(apps);
  assert.deepEqual(result.map((a) => a.appName), ['A']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/lib/agencies.js'` and `'../scripts/lib/hallOfShame.js'`

- [ ] **Step 3: Implement `scripts/lib/agencies.js`**

```js
// Curated by hand from government_apps.csv. The dataset's "purpose" field is
// inconsistent free text, so automatic agency extraction isn't reliable.
// Anything not listed here is tagged "Unclassified" rather than guessed.
export const AGENCY_MAP = Object.freeze({
  MyJPJ: 'Road Transport Department (JPJ)',
  MySejahtera: 'Ministry of Health (MOH)',
  myHealth: 'Ministry of Health (MOH)',
  myCuaca: 'Malaysian Meteorological Department (MetMalaysia)',
  myJakim: 'Department of Islamic Development Malaysia (JAKIM)',
  mySPAD: 'Land Public Transport Agency (APAD)',
  MyFoodSafe: 'Ministry of Health (MOH)',
  'myHRMIS Mobile': 'Public Service Department (JPA)',
  myKPDNKK: 'Ministry of Domestic Trade and Cost of Living (KPDN)',
  'Melaka Response': 'Melaka State Government / NADMA',
  MyRaja: 'National Disaster Management Agency (NADMA)',
  'Harga Getah': 'Malaysian Rubber Board',
  'MyGOV Malaysia': 'Malaysian Administrative Modernisation and Management Planning Unit (MAMPU)',
  'EPF i-Akaun': 'Employees Provident Fund (EPF)',
  'LHDN MyTax': 'Inland Revenue Board (LHDN)',
  PERKESO: 'Social Security Organisation (PERKESO)',
  MyPesara: 'Public Service Department (JPA)',
  'MyDigital ID': 'National Digital ID initiative',
});

export const UNCLASSIFIED = 'Unclassified';

export function tagAgency(appName, agencyMap = AGENCY_MAP) {
  return agencyMap[appName] ?? UNCLASSIFIED;
}

// Apps whose neglect carries real-world risk: health, disaster response, and
// food safety. Intentionally small and hand-picked — not every stale app
// belongs in the Hall of Shame.
export const CRITICAL_APPS = Object.freeze(
  new Set(['MySejahtera', 'myHealth', 'myCuaca', 'MyFoodSafe', 'Melaka Response', 'MyRaja'])
);

export function isCriticalApp(appName, criticalApps = CRITICAL_APPS) {
  return criticalApps.has(appName);
}
```

- [ ] **Step 4: Implement `scripts/lib/hallOfShame.js`**

```js
import { STATUS } from './classify.js';

export function isHallOfShameCandidate(app) {
  return app.status === STATUS.ABANDONED && app.isCritical === true;
}

export function buildHallOfShame(apps) {
  return apps.filter(isHallOfShameCandidate);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 9 tests across `tests/agencies.test.js` and `tests/hallOfShame.test.js` green.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/agencies.js scripts/lib/hallOfShame.js tests/agencies.test.js tests/hallOfShame.test.js
git commit -m "feat: add agency tagging and Hall of Shame filter"
```

---

### Task 4: iTunes Search API cross-check

**Files:**
- Create: `scripts/lib/itunes.js`
- Test: `tests/itunes.test.js`

**Interfaces:**
- Consumes: none.
- Produces: `MANUAL_OVERRIDES` (object constant), `lookupItunesApp(appName: string, opts?: { fetchImpl?, overrides? }): Promise<{trackName, currentVersionReleaseDate, averageUserRating, userRatingCount} | null>`, `crossCheckIosApps(apps: Array<{appId, appName}>, opts?: { fetchImpl?, overrides?, delayMs? }): Promise<Map<string, object|null>>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/itunes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupItunesApp, crossCheckIosApps } from '../scripts/lib/itunes.js';

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

test('lookupItunesApp returns the first matching result', async () => {
  const fakeFetch = async () =>
    jsonResponse({
      results: [{ trackName: 'myCuaca', currentVersionReleaseDate: '2024-10-11T00:00:00Z', averageUserRating: 3.2, userRatingCount: 150 }],
    });

  const result = await lookupItunesApp('myCuaca', { fetchImpl: fakeFetch });

  assert.deepEqual(result, {
    trackName: 'myCuaca',
    currentVersionReleaseDate: '2024-10-11T00:00:00Z',
    averageUserRating: 3.2,
    userRatingCount: 150,
  });
});

test('lookupItunesApp returns null when there are no results', async () => {
  const fakeFetch = async () => jsonResponse({ results: [] });
  const result = await lookupItunesApp('Nonexistent App', { fetchImpl: fakeFetch });
  assert.equal(result, null);
});

test('lookupItunesApp uses a manual override search term when provided', async () => {
  let requestedUrl;
  const fakeFetch = async (url) => {
    requestedUrl = url;
    return jsonResponse({ results: [] });
  };

  await lookupItunesApp('Ambiguous App', {
    fetchImpl: fakeFetch,
    overrides: { 'Ambiguous App': 'Exact Search Term' },
  });

  assert.ok(requestedUrl.includes(encodeURIComponent('Exact Search Term')));
});

test('lookupItunesApp retries on failure and succeeds on a later attempt', async () => {
  let callCount = 0;
  const fakeFetch = async () => {
    callCount++;
    if (callCount < 2) {
      return { ok: false, status: 500 };
    }
    return jsonResponse({
      results: [{ trackName: 'myHealth', currentVersionReleaseDate: null, averageUserRating: null, userRatingCount: null }],
    });
  };

  const result = await lookupItunesApp('myHealth', { fetchImpl: fakeFetch });

  assert.equal(callCount, 2);
  assert.equal(result.trackName, 'myHealth');
});

test('lookupItunesApp gives up and returns null after persistent failure', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500 });
  const result = await lookupItunesApp('Always Fails', { fetchImpl: fakeFetch });
  assert.equal(result, null);
});

test('crossCheckIosApps looks up every app and returns a Map keyed by appId', async () => {
  const fakeFetch = async (url) => {
    if (url.includes(encodeURIComponent('AppOne'))) {
      return jsonResponse({
        results: [{ trackName: 'AppOne', currentVersionReleaseDate: '2026-01-01T00:00:00Z', averageUserRating: 4.5, userRatingCount: 10 }],
      });
    }
    return jsonResponse({ results: [] });
  };

  const apps = [
    { appId: '1', appName: 'AppOne' },
    { appId: '2', appName: 'AppTwo' },
  ];

  const results = await crossCheckIosApps(apps, { fetchImpl: fakeFetch, delayMs: 0 });

  assert.equal(results.size, 2);
  assert.equal(results.get('1').trackName, 'AppOne');
  assert.equal(results.get('2'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/lib/itunes.js'`

- [ ] **Step 3: Implement `scripts/lib/itunes.js`**

```js
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const REQUEST_DELAY_MS = 200;
const MAX_RETRIES = 2;

// Fuzzy name matching against the App Store sometimes picks the wrong result
// or misses entirely. Add an exact search term here, keyed by the app_name
// from government_apps.csv, as mismatches are found during real runs.
export const MANUAL_OVERRIDES = Object.freeze({});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function lookupItunesApp(appName, { fetchImpl = fetch, overrides = MANUAL_OVERRIDES } = {}) {
  const term = overrides[appName] ?? appName;
  const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(term)}&country=my&entity=software&limit=1`;

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`iTunes lookup failed for "${appName}": HTTP ${res.status}`);
      }
      const body = await res.json();
      const result = body.results?.[0];
      if (!result) {
        return null;
      }
      return {
        trackName: result.trackName,
        currentVersionReleaseDate: result.currentVersionReleaseDate ?? null,
        averageUserRating: result.averageUserRating ?? null,
        userRatingCount: result.userRatingCount ?? null,
      };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(REQUEST_DELAY_MS * (attempt + 1));
      }
    }
  }
  console.warn(`iTunes lookup failed after ${MAX_RETRIES + 1} attempts for "${appName}": ${lastError.message}`);
  return null;
}

export async function crossCheckIosApps(apps, { fetchImpl = fetch, overrides = MANUAL_OVERRIDES, delayMs = REQUEST_DELAY_MS } = {}) {
  const results = new Map();
  for (const app of apps) {
    const result = await lookupItunesApp(app.appName, { fetchImpl, overrides });
    results.set(app.appId, result);
    await sleep(delayMs);
  }
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 tests in `tests/itunes.test.js` green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/itunes.js tests/itunes.test.js
git commit -m "feat: add iTunes Search API cross-check with retry and manual overrides"
```

---

### Task 5: data.json schema/sanity validator

**Files:**
- Create: `scripts/lib/validate.js`
- Test: `tests/validate.test.js`

**Interfaces:**
- Consumes: `STATUS` from `scripts/lib/classify.js` (Task 2).
- Produces: `validateDataset(data: unknown): { valid: boolean, errors: string[] }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/validate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset } from '../scripts/lib/validate.js';
import { STATUS } from '../scripts/lib/classify.js';

function validDataset() {
  return {
    generatedAt: '2026-07-05T00:00:00.000Z',
    summary: { totalApps: 1, shutdownCount: 0, freshCount: 1, staleCount: 0, abandonedCount: 0 },
    apps: [{ appId: '1', appName: 'Test App', status: STATUS.FRESH }],
    hallOfShame: [],
  };
}

test('a well-formed dataset is valid', () => {
  const { valid, errors } = validateDataset(validDataset());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('a missing generatedAt is invalid', () => {
  const data = validDataset();
  delete data.generatedAt;
  const { valid, errors } = validateDataset(data);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('generatedAt')));
});

test('an empty apps array is invalid', () => {
  const data = validDataset();
  data.apps = [];
  const { valid, errors } = validateDataset(data);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('apps')));
});

test('an app with an invalid status is invalid', () => {
  const data = validDataset();
  data.apps[0].status = 'not-a-real-status';
  const { valid, errors } = validateDataset(data);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('status')));
});

test('a non-array hallOfShame is invalid', () => {
  const data = validDataset();
  data.hallOfShame = null;
  const { valid, errors } = validateDataset(data);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('hallOfShame')));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/lib/validate.js'`

- [ ] **Step 3: Implement `scripts/lib/validate.js`**

```js
import { STATUS } from './classify.js';

const VALID_STATUSES = new Set(Object.values(STATUS));
const REQUIRED_SUMMARY_FIELDS = ['totalApps', 'shutdownCount', 'freshCount', 'staleCount', 'abandonedCount'];

export function validateDataset(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['dataset must be an object'] };
  }
  if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) {
    errors.push('generatedAt must be a valid ISO date string');
  }
  if (!data.summary || typeof data.summary !== 'object') {
    errors.push('summary must be an object');
  } else {
    for (const field of REQUIRED_SUMMARY_FIELDS) {
      if (typeof data.summary[field] !== 'number') {
        errors.push(`summary.${field} must be a number`);
      }
    }
  }
  if (!Array.isArray(data.apps) || data.apps.length === 0) {
    errors.push('apps must be a non-empty array');
  } else {
    data.apps.forEach((app, i) => {
      if (!app.appId || !app.appName) {
        errors.push(`apps[${i}] is missing appId or appName`);
      }
      if (!VALID_STATUSES.has(app.status)) {
        errors.push(`apps[${i}] has an invalid status: ${app.status}`);
      }
    });
  }
  if (!Array.isArray(data.hallOfShame)) {
    errors.push('hallOfShame must be an array');
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 5 tests in `tests/validate.test.js` green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/validate.js tests/validate.test.js
git commit -m "feat: add data.json schema/sanity validator"
```

---

### Task 6: Orchestrator script

**Files:**
- Create: `scripts/fetch-and-analyze.js`
- Test: `tests/fetch-and-analyze.test.js`

**Interfaces:**
- Consumes: `fetchGovAppsCsv`, `parseGovAppsCsv`, `dedupeApps`, `CSV_URL` from `scripts/lib/csv.js`; `classifyApp`, `STATUS` from `scripts/lib/classify.js`; `tagAgency`, `isCriticalApp` from `scripts/lib/agencies.js`; `buildHallOfShame` from `scripts/lib/hallOfShame.js`; `crossCheckIosApps` from `scripts/lib/itunes.js`; `validateDataset` from `scripts/lib/validate.js`.
- Produces: `generateDataset(opts?: { fetchImpl?: typeof fetch, today?: Date }): Promise<Dataset>` where `Dataset = { generatedAt: string, summary: {...}, apps: AnalyzedApp[], hallOfShame: AnalyzedApp[] }`. Also a CLI entrypoint that writes `data.json` at the repo root and exits non-zero on an invalid dataset.

- [ ] **Step 1: Write the failing tests**

Create `tests/fetch-and-analyze.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDataset } from '../scripts/fetch-and-analyze.js';
import { validateDataset } from '../scripts/lib/validate.js';
import { CSV_URL } from '../scripts/lib/csv.js';

const SAMPLE_CSV = [
  'app_id,app_name,app_os_platform,released,last_updated,shutdown,purpose',
  '1,myCuaca,Android,2015-04-21,2024-10-11,,weather app',
  '1,myCuaca,iOS,2015-04-21,2024-10-11,,weather app',
  '2,MyRaja,Android,2016-01-27,2016-01-27,,disaster app',
].join('\n');

function fakeFetch(url) {
  if (url === CSV_URL) {
    return Promise.resolve({ ok: true, text: async () => SAMPLE_CSV });
  }
  if (url.startsWith('https://itunes.apple.com/search')) {
    if (url.includes(encodeURIComponent('myCuaca'))) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          results: [{ trackName: 'myCuaca', currentVersionReleaseDate: '2024-10-11T00:00:00Z', averageUserRating: 3.1, userRatingCount: 200 }],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
  }
  throw new Error(`Unexpected fetch to ${url}`);
}

test('generateDataset produces a valid dataset from CSV + iTunes data', async () => {
  const today = new Date('2026-07-05T00:00:00Z');
  const dataset = await generateDataset({ fetchImpl: fakeFetch, today });

  const { valid, errors } = validateDataset(dataset);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(dataset.apps.length, 2);
  assert.equal(dataset.summary.totalApps, 2);
});

test('generateDataset flags a long-untouched critical app in the Hall of Shame, but not a merely-stale one', async () => {
  const today = new Date('2026-07-05T00:00:00Z');
  const dataset = await generateDataset({ fetchImpl: fakeFetch, today });

  const names = dataset.hallOfShame.map((a) => a.appName);
  assert.ok(names.includes('MyRaja'));
  assert.ok(!names.includes('myCuaca'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/fetch-and-analyze.js'`

- [ ] **Step 3: Implement `scripts/fetch-and-analyze.js`**

```js
import { writeFile } from 'node:fs/promises';
import { fetchGovAppsCsv, parseGovAppsCsv, dedupeApps } from './lib/csv.js';
import { classifyApp, STATUS } from './lib/classify.js';
import { tagAgency, isCriticalApp } from './lib/agencies.js';
import { buildHallOfShame } from './lib/hallOfShame.js';
import { crossCheckIosApps } from './lib/itunes.js';
import { validateDataset } from './lib/validate.js';

export async function generateDataset({ fetchImpl = fetch, today = new Date() } = {}) {
  const csvText = await fetchGovAppsCsv(fetchImpl);
  const rows = parseGovAppsCsv(csvText);
  const apps = dedupeApps(rows);

  const iosApps = apps.filter((app) => app.platforms.includes('iOS'));
  const itunesResults = await crossCheckIosApps(iosApps, { fetchImpl });

  const analyzedApps = apps.map((app) => {
    const itunes = itunesResults.get(app.appId) ?? null;
    const effectiveLastUpdated = itunes?.currentVersionReleaseDate
      ? itunes.currentVersionReleaseDate.slice(0, 10)
      : app.lastUpdated;
    const status = classifyApp({ shutdown: app.shutdown, lastUpdated: effectiveLastUpdated }, today);

    return {
      ...app,
      lastUpdated: effectiveLastUpdated,
      status,
      agency: tagAgency(app.appName),
      isCritical: isCriticalApp(app.appName),
      itunes,
    };
  });

  const summary = {
    totalApps: analyzedApps.length,
    shutdownCount: analyzedApps.filter((a) => a.status === STATUS.SHUTDOWN).length,
    freshCount: analyzedApps.filter((a) => a.status === STATUS.FRESH).length,
    staleCount: analyzedApps.filter((a) => a.status === STATUS.STALE).length,
    abandonedCount: analyzedApps.filter((a) => a.status === STATUS.ABANDONED).length,
  };

  return {
    generatedAt: today.toISOString(),
    summary,
    apps: analyzedApps,
    hallOfShame: buildHallOfShame(analyzedApps),
  };
}

async function main() {
  const dataset = await generateDataset();
  const { valid, errors } = validateDataset(dataset);
  if (!valid) {
    console.error('Generated dataset failed validation:', errors.join('; '));
    process.exit(1);
  }
  const outPath = new URL('../data.json', import.meta.url);
  await writeFile(outPath, JSON.stringify(dataset, null, 2));
  console.log(`Wrote data.json with ${dataset.apps.length} apps.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests across every test file green (26 tests total).

- [ ] **Step 5: Run the real pipeline against live data as a smoke test**

Run: `npm run generate`
Expected: `Wrote data.json with <N> apps.` printed, and a `data.json` file created at the repo root. This makes real network calls to `data.gov.my` and `itunes.apple.com` — it takes roughly 30-60 seconds since iOS lookups are deliberately rate-limited. If it fails, check your network connection before debugging code.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-and-analyze.js tests/fetch-and-analyze.test.js data.json
git commit -m "feat: add orchestrator script wiring the full pipeline"
```

---

### Task 7: Dashboard frontend

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `app.js`
- Create: `scripts/dev-server.js`

**Interfaces:**
- Consumes: `data.json` at the repo root (produced by Task 6), fetched client-side via `fetch('./data.json')`. Expected shape matches the `Dataset` type from Task 6.
- Produces: nothing consumed by later tasks — this is the final user-facing surface.

- [ ] **Step 1: Create `scripts/dev-server.js`**

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8080;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  try {
    const body = await readFile(join(ROOT, filePath));
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MyGov App Graveyard</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header>
    <h1>MyGov App Graveyard</h1>
    <p class="subtitle">Malaysia has 500+ official government apps. How many are actually alive?</p>
  </header>

  <main>
    <section id="summary" aria-label="Summary statistics"></section>

    <section aria-label="Age distribution chart">
      <canvas id="age-chart" height="120"></canvas>
    </section>

    <section aria-label="Hall of Shame">
      <h2>Hall of Shame</h2>
      <p class="section-intro">Critical apps — health, disaster response, food safety — that haven't been touched in 3+ years.</p>
      <div id="hall-of-shame"></div>
    </section>

    <section aria-label="Full app list">
      <h2>All tracked apps</h2>
      <table id="app-table">
        <thead>
          <tr>
            <th>App</th>
            <th>Agency</th>
            <th>Status</th>
            <th>Last updated</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>

    <section aria-label="Methodology">
      <h2>How we calculate this</h2>
      <p>
        Data comes from Malaysia's official
        <a href="https://data.gov.my/data-catalogue/government_apps">GAMMA app registry</a>,
        refreshed weekly. An app is "active-fresh" if updated within the last year,
        "active-stale" if 1-3 years, and "active-abandoned" if 3+ years — or if no
        update date was ever recorded. For apps on the App Store, we cross-check the
        registry's self-reported update date against Apple's own record via the
        public iTunes Search API, since the registry's own data isn't always
        accurate. Hall of Shame entries are abandoned apps we've hand-tagged as
        health, disaster-response, or food-safety related — not every old app is
        shamed here, only ones where staleness carries real risk.
      </p>
      <p>
        This is independent analysis of public data, not an official government
        statement. Think an app is mischaracterized here?
        <a href="https://github.com/azuriru3/mygov-app-graveyard/issues/new?template=correction.md">Open a correction</a>.
      </p>
    </section>
  </main>

  <footer>
    <p>Source on <a href="https://github.com/azuriru3/mygov-app-graveyard">GitHub</a>.</p>
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `style.css`**

```css
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #c9d1d9;
  --muted: #8b949e;
  --danger: #f85149;
  --accent: #58a6ff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}

header {
  padding: 3rem 1.5rem 2rem;
  text-align: center;
  border-bottom: 1px solid var(--border);
}

header h1 {
  margin: 0 0 0.5rem;
  font-size: 2.2rem;
}

.subtitle {
  color: var(--muted);
  margin: 0;
}

main {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

section {
  margin-bottom: 3rem;
}

.headline {
  font-size: 1.8rem;
  font-weight: 600;
  margin: 0 0 1rem;
}

.stat-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.generated-at {
  color: var(--muted);
  font-size: 0.85rem;
}

.shame-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 4px solid var(--danger);
  border-radius: 6px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}

.shame-card h3 {
  margin: 0 0 0.25rem;
}

.shame-card .agency {
  color: var(--muted);
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

th {
  color: var(--muted);
  font-weight: 600;
  font-size: 0.85rem;
  text-transform: uppercase;
}

a {
  color: var(--accent);
}

footer {
  text-align: center;
  padding: 2rem;
  color: var(--muted);
  font-size: 0.85rem;
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 4: Create `app.js`**

```js
const STATUS_LABELS = {
  shutdown: 'Shut down',
  'active-fresh': 'Actively maintained',
  'active-stale': 'Stale (1-3 years)',
  'active-abandoned': 'Abandoned (3+ years)',
};

async function loadDataset() {
  const res = await fetch('./data.json');
  if (!res.ok) throw new Error(`Failed to load data.json: ${res.status}`);
  return res.json();
}

function renderSummary(summary, generatedAt) {
  const el = document.getElementById('summary');
  const pct = (n) => Math.round((n / summary.totalApps) * 100);
  el.innerHTML = `
    <p class="headline">${summary.totalApps} official apps tracked</p>
    <ul class="stat-list">
      <li><strong>${summary.abandonedCount}</strong> (${pct(summary.abandonedCount)}%) untouched 3+ years</li>
      <li><strong>${summary.staleCount}</strong> (${pct(summary.staleCount)}%) untouched 1-3 years</li>
      <li><strong>${summary.freshCount}</strong> (${pct(summary.freshCount)}%) updated within a year</li>
      <li><strong>${summary.shutdownCount}</strong> formally shut down</li>
    </ul>
    <p class="generated-at">Last refreshed: ${new Date(generatedAt).toLocaleString('en-MY')}</p>
  `;
}

function renderHallOfShame(hallOfShame) {
  const el = document.getElementById('hall-of-shame');
  if (hallOfShame.length === 0) {
    el.innerHTML = '<p>No critical apps currently qualify. Good news, for once.</p>';
    return;
  }
  el.innerHTML = hallOfShame
    .map((app) => {
      const years = app.lastUpdated
        ? ((Date.now() - new Date(app.lastUpdated)) / (1000 * 60 * 60 * 24 * 365)).toFixed(1)
        : 'unknown';
      const rating = app.itunes?.averageUserRating
        ? `${app.itunes.averageUserRating.toFixed(1)}★ (${app.itunes.userRatingCount} ratings)`
        : 'no App Store rating on record';
      return `
        <div class="shame-card">
          <h3>${app.appName}</h3>
          <p class="agency">${app.agency}</p>
          <p>${years} years since last update &middot; ${rating}</p>
        </div>
      `;
    })
    .join('');
}

function renderTable(apps) {
  const tbody = document.querySelector('#app-table tbody');
  tbody.innerHTML = apps
    .map(
      (app) => `
        <tr>
          <td>${app.appName}</td>
          <td>${app.agency}</td>
          <td>${STATUS_LABELS[app.status]}</td>
          <td>${app.lastUpdated ?? 'unknown'}</td>
        </tr>
      `
    )
    .join('');
}

function renderChart(summary) {
  const ctx = document.getElementById('age-chart');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Fresh (<1yr)', 'Stale (1-3yr)', 'Abandoned (3+yr)', 'Shut down'],
      datasets: [
        {
          label: 'Number of apps',
          data: [summary.freshCount, summary.staleCount, summary.abandonedCount, summary.shutdownCount],
          backgroundColor: ['#3fb950', '#d29922', '#f85149', '#8b949e'],
        },
      ],
    },
    options: { plugins: { legend: { display: false } } },
  });
}

async function main() {
  const dataset = await loadDataset();
  renderSummary(dataset.summary, dataset.generatedAt);
  renderHallOfShame(dataset.hallOfShame);
  renderTable(dataset.apps);
  renderChart(dataset.summary);
}

main().catch((err) => {
  document.getElementById('summary').textContent = 'Failed to load data: ' + err.message;
  console.error(err);
});
```

- [ ] **Step 5: Verify the dev server serves the dashboard**

Run: `npm run dev` (leave it running in the background)

Then in another terminal:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/data.json
```

Expected: both print `200`.

Recommended (not required — the spec calls for no automated UI tests): open `http://localhost:8080` in a browser and confirm the headline stat, chart, Hall of Shame section, and table all render using the real `data.json` from Task 6.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css app.js scripts/dev-server.js
git commit -m "feat: add static dashboard frontend"
```

---

### Task 8: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/refresh.yml`

**Interfaces:**
- Consumes: `npm run generate` (Task 6, exits non-zero on invalid data without writing `data.json`), `data.json` and static frontend files (Task 7).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create `.github/workflows/refresh.yml`**

```yaml
name: Refresh data and deploy

on:
  schedule:
    - cron: '0 3 * * 1'
  workflow_dispatch: {}

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  refresh-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Run tests
        run: npm test

      - name: Generate data.json
        run: npm run generate

      - name: Commit data.json if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data.json
          git diff --cached --quiet || git commit -m "chore: refresh data.json"
          git push

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: .

      - uses: actions/deploy-pages@v4
```

Note on error handling: `npm run generate` calls `main()` in `scripts/fetch-and-analyze.js`, which exits with a non-zero code and does **not** write `data.json` if `validateDataset` reports errors. A non-zero exit fails this workflow step, which stops the job before the commit/deploy steps run — so an invalid run never touches the committed `data.json` or redeploys the site, satisfying the spec's error-handling requirement.

- [ ] **Step 2: Verify the workflow YAML is well-formed**

Run:

```bash
node -e "
const fs = require('node:fs');
const text = fs.readFileSync('.github/workflows/refresh.yml', 'utf8');
if (!text.includes('actions/deploy-pages')) throw new Error('missing deploy step');
if (!text.includes('schedule')) throw new Error('missing schedule trigger');
console.log('workflow file looks structurally sound');
"
```

Expected: `workflow file looks structurally sound`

This is a lightweight sanity check, not full YAML validation — full end-to-end verification requires pushing to a real GitHub repository (see Step 3).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/refresh.yml
git commit -m "feat: add weekly refresh + deploy GitHub Actions workflow"
```

**Manual follow-up (requires your confirmation before doing — pushes to a remote and changes repo settings):** once this repo is pushed to GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Then trigger the workflow once manually via the **Actions** tab (`workflow_dispatch`) to confirm it runs end-to-end and the site deploys.

---

### Task 9: README, issue template, and polish

**Files:**
- Create: `README.md`
- Create: `.github/ISSUE_TEMPLATE/correction.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create `.github/ISSUE_TEMPLATE/correction.md`**

```markdown
---
name: Correction
about: Flag an app that's mischaracterized in the MyGov App Graveyard
title: "Correction: <app name>"
labels: correction
---

**App name (as it appears in the dashboard):**

**What's wrong?**
(e.g. "This app was actually updated in March 2026" or "This isn't really a critical/safety app")

**Evidence:**
(link to App Store/Play Store listing, official announcement, changelog, etc.)
```

- [ ] **Step 2: Create `README.md`**

```markdown
# MyGov App Graveyard

![Refresh workflow](https://github.com/azuriru3/mygov-app-graveyard/actions/workflows/refresh.yml/badge.svg)

Malaysia's official [GAMMA app registry](https://data.gov.my/data-catalogue/government_apps) lists 500+ government mobile apps. This dashboard tracks how many of them are actually still maintained.

**[View the live dashboard](https://azuriru3.github.io/mygov-app-graveyard/)**

## What this shows

- What fraction of official apps haven't been updated in 1, 3+ years
- A "Hall of Shame" of critical (health/disaster/food-safety) apps that are effectively abandoned
- For iOS apps, an independent cross-check of the registry's self-reported update date against Apple's own App Store record

## How it works

A GitHub Actions workflow refreshes the data weekly: it downloads the official CSV, classifies every app's staleness, cross-checks iOS apps against the iTunes Search API, and redeploys the static dashboard. See [the design spec](docs/superpowers/specs/2026-07-05-mygov-app-graveyard-design.md) for full methodology.

Think an app here is mischaracterized? [Open a correction](../../issues/new?template=correction.md) — this is independent analysis of public data, not an official statement.

## Development

```bash
npm test          # run the unit tests
npm run generate  # fetch fresh data and regenerate data.json
npm run dev       # serve the dashboard locally at http://localhost:8080
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md .github/ISSUE_TEMPLATE/correction.md
git commit -m "docs: add README and correction issue template"
```

**Manual follow-up (do after the first live deploy, not now):** take a screenshot of the live dashboard and add a `## Screenshot` section to `README.md` with it — there's nothing to screenshot until the site is actually deployed.

---

## Self-Review Notes

- **Spec coverage:** architecture (Task 1-9 overall), data sources (Tasks 1, 4), staleness thresholds (Task 2), agency + Hall of Shame curation (Task 3), iTunes cross-check with politeness/retry (Task 4), schema validation gating commit/deploy (Tasks 5, 6, 8), error handling for fetch/iTunes/validation failures (Tasks 1, 4, 6, 8), frontend with methodology/disclaimer (Task 7), correction path (Task 9), weekly cron (Task 8) — all covered.
- **Placeholder scan:** no TBD/TODO markers. The two "manual follow-up" notes (enabling Pages, adding a screenshot) are genuinely sequenced after a live deploy exists and are called out explicitly as manual, confirmation-required steps rather than left implicit.
- **Type consistency:** `App` (Task 1) → `AnalyzedApp` (Task 6, spreads `App` plus `status`/`agency`/`isCritical`/`itunes`) is used consistently in Tasks 3, 5, 6, 7. `STATUS.*` string values are identical everywhere they're referenced (`classify.js` is the single source, imported by `hallOfShame.js`, `validate.js`, `fetch-and-analyze.js`, `app.js`'s `STATUS_LABELS` keys).
