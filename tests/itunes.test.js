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
