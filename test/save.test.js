import test from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION } from '../src/data.js';
import { createNewState, advanceState } from '../src/engine.js';
import {
  CORRUPT_KEY_PREFIX,
  SAVE_KEY,
  deserialize,
  exportSave,
  getStorage,
  loadFromStorage,
  saveToStorage,
  serialize,
  validateState,
} from '../src/save.js';

const T0 = 1_700_000_000_000;

/** Minimal in-memory storage stub for deterministic tests. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    _map: map,
  };
}

function playableState() {
  const state = createNewState(T0, 99);
  state.fishing = true;
  advanceState(state, T0 + 3 * 60 * 1000);
  return state;
}

test('a valid save round-trips exactly', () => {
  const state = playableState();
  const result = deserialize(serialize(state));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.state, state);

  const storage = fakeStorage();
  assert.equal(saveToStorage(storage, state).ok, true);
  const loaded = loadFromStorage(storage);
  assert.equal(loaded.status, 'loaded');
  assert.deepEqual(loaded.state, state);
});

test('invalid imports leave the existing state unchanged', () => {
  const live = playableState();
  const snapshot = JSON.parse(JSON.stringify(live));

  const cases = [
    ['not json', '{oops'],
    ['not an object', '[1,2,3]'],
    ['wrong schema version', JSON.stringify({ ...live, schemaVersion: 99 })],
    ['missing schema version', JSON.stringify({ ...live, schemaVersion: undefined })],
    ['negative coins', JSON.stringify({ ...live, coins: -5 })],
    ['fractional coins', JSON.stringify({ ...live, coins: 12.5 })],
    ['infinite coins', JSON.stringify({ ...live, coins: 'Infinity' })],
    ['unknown location', JSON.stringify({ ...live, locationId: 'loc_atlantis' })],
    ['unknown rod', JSON.stringify({ ...live, rodId: 'rod_platinum' })],
    ['unknown species in collection', JSON.stringify({ ...live, collection: { sp_kraken: { catches: 1, bestWeight: 2, trophies: 0 } } })],
    ['selected rod not owned', JSON.stringify({ ...live, rodId: 'rod_pro', ownedRods: ['rod_bamboo'] })],
    ['unlocked location selected but absent', JSON.stringify({ ...live, locationId: 'loc_lake', unlockedLocations: ['loc_pond'] })],
    ['nan numbers', JSON.stringify({ ...live, processedAt: null })],
    ['rng state out of range', JSON.stringify({ ...live, rngState: 4294967296 })],
    ['bad recent list', JSON.stringify({ ...live, recent: new Array(40).fill(live.recent[0] || { speciesId: 'sp_nope', weight: 1, coins: 1 }) })],
    ['trophies exceed catches', JSON.stringify({ ...live, collection: { sp_bluegill: { catches: 1, bestWeight: 1, trophies: 9 } } })],
  ];

  for (const [label, payload] of cases) {
    const result = deserialize(payload);
    assert.equal(result.ok, false, `${label} should be rejected`);
    assert.ok(result.errors.length > 0, `${label} should explain itself`);
    assert.equal(result.state, undefined, `${label} must not produce a state`);
  }

  // Nothing above was allowed to touch the live state.
  assert.deepEqual(JSON.parse(JSON.stringify(live)), snapshot);
  assert.equal(validateState(JSON.parse(serialize(live))).ok, true);
});

test('a state produced by normal play always validates', () => {
  const state = createNewState(T0, 5);
  state.fishing = true;
  advanceState(state, T0 + 9 * 60 * 60 * 1000 + 1234);
  const result = validateState(JSON.parse(serialize(state)));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('corrupt saves are preserved rather than erased, and the game falls back to a fresh state', () => {
  const storage = fakeStorage({ [SAVE_KEY]: 'this is not json' });
  const loaded = loadFromStorage(storage);
  assert.equal(loaded.status, 'corrupt');
  assert.equal(loaded.raw, 'this is not json');
  assert.ok(loaded.errors.length > 0);
  assert.equal(loaded.preservedKey !== null, true, 'raw copy kept for recovery');
  assert.ok(loaded.preservedKey.startsWith(CORRUPT_KEY_PREFIX));
  assert.equal(storage.getItem(loaded.preservedKey), 'this is not json');
  assert.equal(storage.getItem(SAVE_KEY), 'this is not json', 'the original key is not wiped');
});

test('missing and unavailable storage are handled without throwing', () => {
  assert.equal(loadFromStorage(fakeStorage()).status, 'empty');
  assert.equal(loadFromStorage(null).status, 'unavailable');
  assert.equal(saveToStorage(null, createNewState(T0, 1)).ok, false);

  const throwing = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  assert.equal(loadFromStorage(throwing).status, 'unavailable');
  assert.equal(saveToStorage(throwing, createNewState(T0, 1)).ok, false);
});

test('export output is re-importable and does not mutate the source', () => {
  const state = playableState();
  const before = JSON.parse(JSON.stringify(state));
  const text = exportSave(state);
  assert.ok(text.includes('\n'), 'exported save is pretty printed for humans');
  const reimported = deserialize(text);
  assert.equal(reimported.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  assert.equal(reimported.state.schemaVersion, SCHEMA_VERSION);
});

test('importing a different save replaces progress rather than adding to it', () => {
  const live = playableState();
  const liveCoins = live.coins;

  const other = createNewState(T0, 7);
  other.coins = 42;
  const imported = deserialize(serialize(other));
  assert.equal(imported.ok, true);
  // Replacement semantics: the imported object is used as-is, never summed with live state.
  assert.equal(imported.state.coins, 42);
  assert.notEqual(imported.state.coins, liveCoins + 42);
});

test('getStorage reports availability honestly in this environment', () => {
  const storage = getStorage();
  if (typeof localStorage === 'undefined') {
    assert.equal(storage, null);
  } else {
    assert.ok(storage !== null);
  }
});
