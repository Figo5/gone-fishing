import test from 'node:test';
import assert from 'node:assert/strict';

import { SPECIES, getSpecies, speciesByLocation } from '../src/data.js';
import {
  advanceState, buyLegacyPerk, catchOdds, chooseEvent, createNewState,
  equipRod, eventActive, performPrestige, prestigeEligibility,
  purchaseLocation, settlePlayerCast, stallValue, startPlayerCast,
  upgradeContractOffice, upgradeRod, workerCastDurationMs,
} from '../src/engine.js';
import { backupToStorage, deserialize, serialize, validateState } from '../src/save.js';

const T0 = 1_700_000_000_000;

test('rod and pond purchases deduct coins exactly; owned rods can be re-equipped', () => {
  const s = createNewState(T0, 9);
  s.coins = 10000;
  assert.equal(upgradeRod(s, T0, 'rod_carbon').ok, true);
  assert.equal(s.coins, 8200);
  assert.equal(purchaseLocation(s, T0, 'loc_river').ok, true);
  assert.equal(s.coins, 4700);
  const riverSpeed = workerCastDurationMs(s, { ...s.workers[0], locationId: 'loc_river' });
  assert.equal(equipRod(s, T0, 'rod_bamboo').ok, true);
  assert.equal(s.coins, 4700);
  assert.ok(workerCastDurationMs(s, { ...s.workers[0], locationId: 'loc_river' }) > riverSpeed);
  assert.equal(upgradeRod(s, T0, 'rod_frostwind').reason, 'prestige_locked');
  assert.equal(purchaseLocation(s, T0, 'loc_cedar').reason, 'prestige_locked');
});

test('bait, rod and conditions change species odds without hiding any fish', () => {
  const s = createNewState(T0, 10);
  const worm = catchOdds(s, 'loc_pond', 'bait_worms', 'worker', T0);
  const glow = catchOdds(s, 'loc_pond', 'bait_glow', 'worker', T0);
  assert.ok(Math.abs(worm.reduce((n, row) => n + row.probability, 0) - 1) < 1e-12);
  assert.ok(worm.every((row) => row.probability > 0));
  const koi = (odds) => odds.find((row) => row.species.id === 'sp_koi').probability;
  assert.ok(koi(glow) > koi(worm), 'glow lure favors a rare pond fish');
  s.rodId = 'rod_pro';
  assert.ok(koi(catchOdds(s, 'loc_pond', 'bait_worms', 'worker', T0)) > koi(worm));
  assert.notDeepEqual(
    catchOdds(s, 'loc_pond', 'bait_worms', 'worker', T0).map((row) => row.probability),
    catchOdds(s, 'loc_pond', 'bait_worms', 'worker', T0 + 25 * 60_000).map((row) => row.probability),
  );
});

test('manual catch remains inside the species size range', () => {
  const s = createNewState(T0, 10);
  s.player.rngState = 1;
  for (let i = 0; i < 100; i += 1) {
    startPlayerCast(s, T0 + i);
    const catchResult = settlePlayerCast(s, T0 + i, true);
    const fish = getSpecies(catchResult.speciesId);
    assert.ok(catchResult.weight >= fish.minWeight && catchResult.weight <= fish.maxWeight);
  }
});

test('pause prevents both automatic and personal fishing', () => {
  const s = createNewState(T0, 10);
  s.paused = true;
  assert.equal(startPlayerCast(s, T0).reason, 'paused');
  assert.equal(advanceState(s, T0 + 60_000).catches.length, 0);
});

test('chosen opportunity affects rewards and expires during offline progress', () => {
  const s = createNewState(T0, 7);
  const ready = s.event.nextAt;
  advanceState(s, ready);
  assert.equal(chooseEvent(s, ready, 'market').ok, true);
  assert.equal(eventActive(s, 'market', ready + 1), true);
  const withEvent = stallValue(s, 100, ready + 1);
  assert.equal(withEvent, 125);
  advanceState(s, ready + 61 * 60_000);
  assert.equal(s.event.activeId, null);
  assert.equal(stallValue(s, 100), 100);
  assert.equal(s.event.completed, 1);
});

test('contract office refills and accepts after a completion', () => {
  const s = createNewState(T0, 8);
  s.coins = 200000;
  assert.equal(upgradeContractOffice(s, T0).ok, true);
  assert.equal(upgradeContractOffice(s, T0).ok, true);
  assert.equal(s.officeLevel, 2);
  s.contract.accepted = { id: 'test', templateId: 'qty_location', kind: 'qty', locationId: 'loc_pond', qty: 1, count: 0, reward: 100 };
  advanceState(s, T0 + 60_000);
  assert.ok(s.contract.completed >= 1);
  assert.ok(s.contract.accepted, 'next order automatically accepted');
});

test('offline batch matches live increments with automation and a timed event', () => {
  const initial = createNewState(T0, 81);
  initial.coins = 200000;
  initial.ownedWorkers = 2;
  initial.workers.push({ ...initial.workers[0], id: 2, name: 'Worker 2', rngState: 99, progressMs: 0, catches: 0 });
  upgradeContractOffice(initial, T0);
  upgradeContractOffice(initial, T0);
  initial.event.nextAt = T0;
  chooseEvent(initial, T0, 'migration');
  const batch = structuredClone(initial);
  const live = structuredClone(initial);
  advanceState(batch, T0 + 2 * 3_600_000);
  for (let t = T0 + 5 * 60_000; t <= T0 + 2 * 3_600_000; t += 5 * 60_000) advanceState(live, t);
  assert.deepEqual(batch, live);
});

test('legacy point purchases carry through prestige and change the next start', () => {
  const s = createNewState(T0, 3);
  s.prestige.count = 1;
  s.legacy.points = 1;
  assert.equal(buyLegacyPerk(s, 'starterCrew').ok, true);
  assert.equal(s.legacy.points, 0);
  assert.equal(buyLegacyPerk(s, 'starterCrew').ok, false);
  s.prestige.runEarnings = 1_000_000;
  s.ownedWorkers = 4;
  s.workers = Array.from({ length: 4 }, (_, i) => ({ ...s.workers[0], id: i + 1, rngState: i + 1 }));
  const requirement = prestigeEligibility(s);
  for (const [index, fish] of SPECIES.slice(0, requirement.discoveriesNeeded).entries()) {
    s.collection[fish.id] = { catches: 1, bestWeight: fish.minWeight, bestValue: 1,
      trophies: index < requirement.trophySpeciesNeeded ? 1 : 0 };
  }
  assert.equal(performPrestige(s, T0 + 1).ok, true);
  assert.equal(s.ownedWorkers, 2);
  assert.ok(s.legacy.perks.includes('starterCrew'));
  assert.equal(s.legacy.points, 1);
  assert.equal(validateState(s).ok, true);
});

test('v3 migration preserves old records and initializes new choices safely', () => {
  const v3 = createNewState(T0, 42);
  v3.schemaVersion = 3;
  v3.coins = 1234;
  v3.collection.sp_bluegill = { catches: 2, bestWeight: 1.1, trophies: 1 };
  delete v3.officeLevel;
  delete v3.legacy;
  delete v3.event;
  const loaded = deserialize(JSON.stringify(v3));
  assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
  assert.equal(loaded.state.schemaVersion, 4);
  assert.equal(loaded.state.coins, 1234);
  assert.equal(loaded.state.collection.sp_bluegill.bestWeight, 1.1);
  assert.equal(loaded.state.collection.sp_bluegill.bestValue, 0);
  assert.equal(loaded.state.officeLevel, 0);
  assert.equal(deserialize(JSON.stringify(loaded.state)).migrated, false);
  const bad = structuredClone(loaded.state);
  bad.legacy.points = 99;
  assert.equal(deserialize(JSON.stringify(bad)).ok, false);
});

test('saving an unfinished hand cast is reloadable and prestige backup keeps old state', () => {
  const s = createNewState(T0, 5);
  startPlayerCast(s, T0);
  const liveCast = s.player.active;
  const stored = serialize(s);
  assert.ok(liveCast, 'live hand cast continues');
  const loaded = deserialize(stored);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.player.active, null, 'reload drops incomplete cast');
  const entries = new Map();
  const storage = { setItem: (key, value) => entries.set(key, value), getItem: (key) => entries.get(key) || null };
  const backup = backupToStorage(storage, s);
  assert.equal(backup.ok, true);
  s.coins = 500;
  assert.equal(deserialize(entries.get(backup.key)).state.coins, 0);
});
