import assert from 'node:assert/strict';
import { resolveDefaultImportProxySelection } from '../src/features/authFiles/proxySelectionDefault.ts';

assert.deepEqual(resolveDefaultImportProxySelection(0), { mode: 'smart' });
assert.deepEqual(resolveDefaultImportProxySelection(1), { mode: 'file' });
assert.deepEqual(resolveDefaultImportProxySelection(5), { mode: 'file' });

console.log('proxySelectionDefault tests passed');
