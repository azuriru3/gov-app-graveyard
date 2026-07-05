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
