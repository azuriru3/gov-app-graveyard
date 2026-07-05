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
