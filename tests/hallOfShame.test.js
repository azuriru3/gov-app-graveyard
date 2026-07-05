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
