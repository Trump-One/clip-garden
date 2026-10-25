import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { Garden, initialState } = createRequire(import.meta.url)('../desktop/core.cjs');

test('migrates a saved paused state to the always-recording desktop behavior', () => {
  const state = { ...initialState(), paused: true };
  const garden = new Garden(state);

  assert.equal(Object.hasOwn(garden.state, 'paused'), false);
  assert.equal(Object.hasOwn(garden.snapshot(), 'paused'), false);

  garden.configure({ paused: true });
  assert.equal(Object.hasOwn(garden.state, 'paused'), false);
});
