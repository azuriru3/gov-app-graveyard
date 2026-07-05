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
