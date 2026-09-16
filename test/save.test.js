import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNewState,
  advanceState,
  hireWorker,
  startPlayerCast,
  submitPlayerInput,
  settlePlayerCast,
  generateContracts,
  acceptContract,
} from '../src/engine.js';
import {
  BACKUP_KEY_PREFIX,
  CORRUPT_KEY_PREFIX,
  SAVE_KEY,
  SCHEMA_VERSION_V1,
  SCHEMA_VERSION_V2,
  SCHEMA_VERSION_V3,
  CURRENT_SCHEMA_VERSION,
  deserialize,
  exportSave,
  getStorage,
  loadFromStorage,
  saveToStorage,
  serialize,
  validateState,
} from '../src/save.js';

const T0 = 1_700_000_000_000;

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

function v2State() {
  const state = createNewState(T0, 99);
  advanceState(state, T0 + 3 * 60 * 1000);
  hireWorker(state, T0 + 3 * 60 * 1000);
  advanceState(state, T0 + 5 * 60 * 1000);
  return state;
}

/** A realistic, valid v1 save (the previous game's shape). */
function v1State() {
  return {
    schemaVersion: 1,
    coins: 12345,
    ownedRods: ['rod_bamboo', 'rod_fiberglass'],
    ownedBaits: ['bait_worms', 'bait_minnows'],
    unlockedLocations: ['loc_pond', 'loc_river'],
    locationId: 'loc_river',
    rodId: 'rod_fiberglass',
    baitId: 'bait_minnows',
    fishing: true,
    castProgressMs: 4321,
    castCount: 210,
    lifetimeCatches: 210,
    lifetimeCoins: 9876,
    playTimeMs: 3_600_000,
    collection: {
      sp_bluegill: { catches: 100, bestWeight: 1.1, trophies: 9 },
      sp_sturgeon: { catches: 2, bestWeight: 88, trophies: 1 },
    },
    recent: [{
      id: 1, speciesId: 'sp_bluegill', weight: 0.5, coins: 15,
      trophy: false, isNewSpecies: true, isRecord: false, at: T0,
    }],
    recentCounter: 1,
    rngState: 123456789,
    processedAt: T0,
    lastSeenAt: T0,
  };
}

/* ------------------------------------------------------------- v2 basics */

test('a valid v2 save round-trips exactly', () => {
  const state = v2State();
  const result = deserialize(serialize(state));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.migrated, false);
  assert.deepEqual(result.state, state);

  const storage = fakeStorage();
  assert.equal(saveToStorage(storage, state).ok, true);
  const loaded = loadFromStorage(storage);
  assert.equal(loaded.status, 'loaded');
  assert.equal(loaded.migrated, false);
  assert.deepEqual(loaded.state, state);
});

test('invalid v2 imports leave the existing state unchanged', () => {
  const live = v2State();
  const snapshot = JSON.parse(JSON.stringify(live));

  const cases = [
    ['not json', '{oops'],
    ['not an object', '[1,2,3]'],
    ['wrong schema version', JSON.stringify({ ...live, schemaVersion: 99 })],
    ['v1 shape (migrated, not rejected): see migration tests', null],
    ['negative coins', JSON.stringify({ ...live, coins: -5 })],
    ['fractional coins', JSON.stringify({ ...live, coins: 12.5 })],
    ['unknown rod', JSON.stringify({ ...live, rodId: 'rod_platinum' })],
    ['unknown species in collection', JSON.stringify({ ...live, collection: { sp_kraken: { catches: 1, bestWeight: 2, trophies: 0 } } })],
    ['selected rod not owned', JSON.stringify({ ...live, rodId: 'rod_pro', ownedRods: ['rod_bamboo'] })],
    ['missing starter rod', JSON.stringify({ ...live, ownedRods: ['rod_carbon'] })],
    ['nan timestamp', JSON.stringify({ ...live, processedAt: null })],
    ['rng out of range', JSON.stringify({ ...live, player: { ...live.player, rngState: 4294967296 } })],
    ['workers mismatch', JSON.stringify({ ...live, ownedWorkers: 5 })],
    ['seven workers', JSON.stringify({ ...live, ownedWorkers: 7, workers: [...live.workers, ...live.workers, ...live.workers].slice(0, 7).map((w, i) => ({ ...w, id: i + 1 })) })],
    ['worker unknown location', JSON.stringify({ ...live, workers: live.workers.map((w, i) => i === 0 ? { ...w, locationId: 'loc_mars' } : w) })],
    ['worker duplicate ids', JSON.stringify({ ...live, workers: [live.workers[0], { ...live.workers[0], id: 1 }], ownedWorkers: 2 })],
    ['player active in save', JSON.stringify({ ...live, player: { ...live.player, active: { speciesId: 'sp_bluegill' } } })],
    ['accepted contract bad rarity', JSON.stringify({ ...live, contract: { ...live.contract, accepted: { kind: 'rarity', rarity: 'legendary', qty: 2, count: 0, reward: 10, id: 'x', templateId: 'rarity_any' } } })],
    ['accepted contract bad species', JSON.stringify({ ...live, contract: { ...live.contract, accepted: { kind: 'size', speciesId: 'sp_nope', threshold: 1, qty: 2, count: 0, reward: 10, id: 'x', templateId: 'size_location' } } })],
    ['trophies exceed catches', JSON.stringify({ ...live, collection: { sp_bluegill: { catches: 1, bestWeight: 1, trophies: 9 } } })],
    ['too many offers', JSON.stringify({ ...live, contract: { ...live.contract, available: [1, 2, 3, 4] } })],
  ];

  for (const [label, payload] of cases) {
    if (payload === null) continue; // v1 saves are migrated, not rejected
    const result = deserialize(payload);
    assert.equal(result.ok, false, `${label} should be rejected`);
    assert.ok(result.errors.length > 0, `${label} should explain itself`);
  }

  assert.deepEqual(JSON.parse(JSON.stringify(live)), snapshot);
  assert.equal(validateState(JSON.parse(serialize(live))).ok, true);
});

/* ------------------------------------------------------------- migration */

test('v1 saves migrate: economy preserved, fisher becomes worker 1, no invented progress', () => {
  const result = deserialize(JSON.stringify(v1State()));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 1);

  const s = result.state;
  assert.equal(s.schemaVersion, SCHEMA_VERSION_V3);
  assert.equal(s.prestige.count, 0, 'v1 migration never forces prestige');
  assert.equal(s.prestige.runEarnings, 9876, 'run earnings seeded from lifetime coins');
  assert.equal(s.trainingLevel, 0);
  assert.equal(s.reelControlLevel, 0);
  assert.equal(s.coins, 12345, 'coins preserved');
  assert.deepEqual(s.ownedRods, ['rod_bamboo', 'rod_fiberglass'], 'rods preserved');
  assert.deepEqual(s.ownedBaits, ['bait_worms', 'bait_minnows']);
  assert.deepEqual(s.unlockedLocations, ['loc_pond', 'loc_river']);
  assert.equal(s.rodId, 'rod_fiberglass');
  assert.equal(s.lifetimeCatches, 210, 'lifetime records preserved');
  assert.equal(s.lifetimeCoins, 9876);
  assert.equal(s.collection.sp_sturgeon.bestWeight, 88, 'collection preserved');
  assert.equal(s.recent[0].source, 'worker', 'old catches were worker catches');

  // The v1 automatic fisher becomes worker 1, same water, same bait, same progress.
  assert.equal(s.workers.length, 1);
  assert.equal(s.workers[0].locationId, 'loc_river');
  assert.equal(s.workers[0].baitId, 'bait_minnows');
  assert.equal(s.workers[0].progressMs, 4321);
  assert.equal(s.workers[0].rngState, 123456789, 'the old stream continues');

  // The old `fishing` boolean maps to the pause flag.
  assert.equal(s.paused, false, 'v1 was actively fishing');

  // Player and contracts start fresh — nothing invented.
  assert.equal(s.player.casts, 0);
  assert.equal(s.player.catches, 0);
  assert.equal(s.player.active, null);
  assert.equal(s.contract.accepted, null);
  assert.equal(s.contract.completed, 0);
});

test('migration is idempotent: importing a migrated save changes nothing', () => {
  const first = deserialize(JSON.stringify(v1State())).state;
  const snapshot = JSON.parse(JSON.stringify(first));
  const second = deserialize(serialize(first));
  assert.equal(second.ok, true);
  assert.equal(second.migrated, false, 'no second migration');
  assert.deepEqual(second.state, snapshot);
});

test('invalid v1 saves are rejected without touching the live state', () => {
  const bad = { ...v1State(), coins: -5 };
  const result = deserialize(JSON.stringify(bad));
  assert.equal(result.ok, false);
  const badLocation = { ...v1State(), locationId: 'loc_mars' };
  assert.equal(deserialize(JSON.stringify(badLocation)).ok, false);
  assert.equal(deserialize(JSON.stringify({ ...v1State(), schemaVersion: 3 })).ok, false);
});

test('migrated saves keep working: workers earn, player can fish, contracts generate', () => {
  const s = deserialize(JSON.stringify(v1State())).state;
  const summary = advanceState(s, s.processedAt + 60_000);
  assert.ok(summary.catches.length > 0, 'the converted worker keeps fishing');
  assert.ok(s.workers[0].catches > 0);

  startPlayerCast(s, s.processedAt + 1000);
  submitPlayerInput(s, s.processedAt + 1100, 1);
  submitPlayerInput(s, s.processedAt + 1200, 1);
  submitPlayerInput(s, s.processedAt + 1300, 1);
  const settled = settlePlayerCast(s, s.processedAt + 1400);
  assert.equal(settled.ok, true);

  assert.equal(generateContracts(s, s.processedAt + 2000).ok, true);
  assert.equal(s.contract.available.length, 3);
  assert.ok(s.contract.available.every((o) => s.unlockedLocations.includes(o.locationId || 'loc_pond')));
});

test('loadFromStorage migrates v1 saves and flags the migration exactly once', () => {
  const storage = fakeStorage({ [SAVE_KEY]: JSON.stringify(v1State()) });
  const loaded = loadFromStorage(storage);
  assert.equal(loaded.status, 'loaded');
  assert.equal(loaded.migrated, true);

  // Saving the migrated state writes a one-time backup.
  assert.equal(saveToStorage(storage, loaded.state, { wasMigrated: true, backupRaw: loaded.raw }).ok, true);
  const backups = [...storage._map.keys()].filter((k) => k.startsWith(BACKUP_KEY_PREFIX));
  assert.equal(backups.length, 1, 'exactly one backup');
  assert.equal(storage.getItem(backups[0]), JSON.stringify(v1State()));
  assert.equal(JSON.parse(storage.getItem(backups[0])).schemaVersion, SCHEMA_VERSION_V1);

  // Saving again never adds another backup.
  saveToStorage(storage, loaded.state, { wasMigrated: true, backupRaw: loaded.raw });
  assert.equal([...storage._map.keys()].filter((k) => k.startsWith(BACKUP_KEY_PREFIX)).length, 1);

  // A fresh v2 save cycle grants no backup.
  const storage2 = fakeStorage({ [SAVE_KEY]: JSON.stringify(v2State()) });
  const loaded2 = loadFromStorage(storage2);
  saveToStorage(storage2, loaded2.state, { wasMigrated: loaded2.migrated, backupRaw: loaded2.raw });
  assert.equal([...storage2._map.keys()].filter((k) => k.startsWith(BACKUP_KEY_PREFIX)).length, 0);
});

/* ------------------------------------------------------------- misc */

test('a state produced by normal play always validates', () => {
  const state = v2State();
  generateContracts(state, state.processedAt);
  advanceState(state, state.processedAt + 9 * 60 * 60 * 1000 + 1234);
  const result = validateState(JSON.parse(serialize(state)));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('corrupt saves are preserved rather than erased', () => {
  const storage = fakeStorage({ [SAVE_KEY]: 'this is not json' });
  const loaded = loadFromStorage(storage);
  assert.equal(loaded.status, 'corrupt');
  assert.equal(loaded.raw, 'this is not json');
  assert.ok(loaded.preservedKey.startsWith(CORRUPT_KEY_PREFIX));
  assert.equal(storage.getItem(loaded.preservedKey), 'this is not json');
  assert.equal(storage.getItem(SAVE_KEY), 'this is not json', 'the original key is not wiped');
});

test('missing and unavailable storage are handled without throwing', () => {
  assert.equal(loadFromStorage(fakeStorage()).status, 'empty');
  assert.equal(loadFromStorage(null).status, 'unavailable');
  assert.equal(saveToStorage(null, v2State()).ok, false);
  const throwing = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  assert.equal(loadFromStorage(throwing).status, 'unavailable');
  assert.equal(saveToStorage(throwing, v2State()).ok, false);
});

test('export output is re-importable and does not mutate the source', () => {
  const state = v2State();
  const before = JSON.parse(JSON.stringify(state));
  const text = exportSave(state);
  assert.ok(text.includes('\n'), 'exported save is pretty printed');
  const reimported = deserialize(text);
  assert.equal(reimported.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  assert.equal(reimported.state.schemaVersion, CURRENT_SCHEMA_VERSION);
});

test('importing a different save replaces progress rather than adding to it', () => {
  const live = v2State();
  const other = createNewState(T0, 7);
  other.coins = 42;
  const imported = deserialize(serialize(other));
  assert.equal(imported.ok, true);
  assert.equal(imported.state.coins, 42, 'replacement, not addition');
  assert.notEqual(imported.state.coins, live.coins + 42);
});

test('getStorage reports availability honestly in this environment', () => {
  const storage = getStorage();
  if (typeof localStorage === 'undefined') {
    assert.equal(storage, null);
  } else {
    assert.ok(storage !== null);
  }
});
