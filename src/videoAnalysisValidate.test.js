import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spearman } from './videoAnalysisValidate.js';

test('spearman() returns 1 for a perfectly monotonic increasing relationship', () => {
  var rho = spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]);
  assert.equal(rho, 1);
});

test('spearman() returns -1 for a perfectly monotonic decreasing relationship', () => {
  var rho = spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]);
  assert.equal(rho, -1);
});

test('spearman() handles tied ranks with average-rank ties', () => {
  var rho = spearman([1, 1, 2, 3], [10, 10, 20, 30]);
  assert.equal(rho, 1);
});

test('spearman() returns null with fewer than 3 points', () => {
  assert.equal(spearman([1, 2], [1, 2]), null);
});

test('spearman() returns null when one series has no variance', () => {
  assert.equal(spearman([5, 5, 5, 5], [1, 2, 3, 4]), null);
});

test('spearman() requires equal-length inputs', () => {
  assert.equal(spearman([1, 2, 3], [1, 2]), null);
});
