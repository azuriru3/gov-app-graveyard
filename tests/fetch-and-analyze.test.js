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
