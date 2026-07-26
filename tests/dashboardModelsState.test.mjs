import assert from 'node:assert/strict';
import { getDashboardModelsStatValue } from '../src/utils/dashboard.ts';

assert.equal(getDashboardModelsStatValue(0, false, null), 0);
assert.equal(getDashboardModelsStatValue(0, false, 'request failed'), '-');
assert.equal(getDashboardModelsStatValue(3, true, null), '-');

console.log('Dashboard model count states passed');
