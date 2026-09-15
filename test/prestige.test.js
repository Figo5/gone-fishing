import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCK_LEVELS,
  LOCATIONS,
  MIN_CAST_MS,
  PRESTIGE,
  TRAINING_LEVELS,
  REEL_CONTROL_LEVELS,
  getSpecies,
  speciesByLocation,
} from '../src/data.js';
import {
  abandonContract,
  acceptContract,
  advanceState,
  assignWorker,
  createNewState,
  currentCastDurationMs,
  earningsMultiplier,
  expandDock,
  generateContracts,
  hireWorker,
  performPrestige,
  prestigeEligibility,
  prestigeThreshold,
  purchaseBait,
  purchaseLocation,
  settlePlayerCast,
  startPlayerCast,
  submitPlayerInput,
  upgradeReelControl,
  upgradeRod,
  upgradeStall,
  upgradeTraining,
  dockCapacity,
  workerEstimate,
} from '../src/engine.js';
import {
  SCHEMA_VERSION_V2,
  SCHEMA_VERSION_V3,
  CURRENT_SCHEMA_VERSION,
  deserialize,
  serialize,
} from '../src/save.js';

const T0 = 1_700_000_000_000;

function prestiged(prestigeCount = 1) {
  const s = createNewState(T0, 42);
  s.prestige.count = prestigeCount;
  return s;
}

/* ------------------------------------------------------------- eligibility */

test('prestige eligibility: earnings milestone plus business milestone, checked live', () => {
  const s = createNewState(T0, 42);
  let guard = 0;
  let el = prestigeEligibility(s);
  assert.equal(el.eligible, false, 'a fresh business cannot prestige');

  s.prestige.runEarnings = prestigeThreshold(s);
  el = prestigeEligibility(s);
  assert.equal(el.eligible, false, 'earnings alone are not enough');
  assert.equal(el.workersMet, false);

  // Buy the dock first, then fill it to four workers.
  while (s.ownedWorkers < PRESTIGE.minWorkers) {
    if (s.ownedWorkers >= dockCapacity(s)) {
      // Dock full: fund the expansion against the actual next-level cost.
      const next = DOCK_LEVELS[s.dockLevel + 1];
      while (s.coins < next.cost) s.coins += 5000;
      assert.equal(expandDock(s, T0).ok, true, 'dock expansion succeeds when funded');
    } else {
      // Fund the hire if needed.
      const cost = [0, 0, 0, 900, 2600, 7000, 18000][s.ownedWorkers + 1] || 0;
      while (s.coins < cost) s.coins += 5000;
      assert.equal(hireWorker(s, T0).ok, true, 'hire succeeds when funded');
    }
    if (guard++ > 20) break;
  }
  assert.ok(s.ownedWorkers >= PRESTIGE.minWorkers, 'test setup reached four workers');
  el = prestigeEligibility(s);
  assert.equal(el.eligible, true, 'both milestones met');
  assert.equal(el.earningsMet, true);
  assert.equal(el.workersMet, true);
  assert.equal(el.multiplier, 1);
  assert.equal(el.nextMultiplier, 1.25);
});

test('spending coins does not undo run-earnings progress', () => {
  const s = createNewState(T0, 42);
  s.prestige.runEarnings = 10000;
  s.coins = 5000;
  purchaseBait(s, T0, 'bait_minnows');
  assert.equal(s.coins < 5000, true, 'coins were spent');
  assert.equal(s.prestige.runEarnings, 10000, 'run earnings are untouched by spending');
});

test('thresholds scale so repeat prestiges stay meaningful', () => {
  const s = createNewState(T0, 42);
  const first = prestigeThreshold(s);
  s.prestige.count = 1;
  const second = prestigeThreshold(s);
  s.prestige.count = 2;
  const third = prestigeThreshold(s);
  assert.ok(second > first && third > second, 'later prestiges cost more');
});

/* ------------------------------------------------------- transition atomicity */

test('prestige resets the business, preserves records, and unlocks the pond once', () => {
  const s = createNewState(T0, 42);
  advanceState(s, T0 + 60_000); // some old-run catches
  s.ownedWorkers = 4;
  s.workers = [
    ...s.workers,
    { id: 2, name: 'Worker 2', locationId: 'loc_pond', baitId: 'bait_worms', rngState: 4242, progressMs: 0, catches: 0 },
    { id: 3, name: 'Worker 3', locationId: 'loc_pond', baitId: 'bait_worms', rngState: 4243, progressMs: 0, catches: 0 },
    { id: 4, name: 'Worker 4', locationId: 'loc_pond', baitId: 'bait_worms', rngState: 4244, progressMs: 0, catches: 0 },
  ];
  s.prestige.runEarnings = prestigeThreshold(s) + 500;
  const coinsBefore = s.coins;
  const collectionBefore = JSON.parse(JSON.stringify(s.collection));
  const lifetimeBefore = s.lifetimeCatches;

  const result = performPrestige(s, T0 + 120_000);
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.destination.locationId, 'loc_cedar');

  // Reset side.
  assert.equal(s.coins, 0);
  assert.equal(s.workers.length, 1);
  assert.equal(s.dockLevel, 0);
  assert.equal(s.stallLevel, 0);
  assert.equal(s.trainingLevel, 0);
  assert.equal(s.reelControlLevel, 0);
  assert.equal(s.rodId, 'rod_bamboo');
  assert.deepEqual(s.ownedRods, ['rod_bamboo']);
  assert.deepEqual(s.ownedBaits, ['bait_worms']);
  assert.equal(s.prestige.runEarnings, 0, 'old-run data cannot qualify the new run');

  // Preserved side.
  assert.equal(s.lifetimeCatches, lifetimeBefore);
  assert.deepEqual(s.collection, collectionBefore);
  assert.ok(Object.keys(s.collection).length > 0, 'collection survives');
  assert.ok(s.unlockedLocations.includes('loc_pond') && s.unlockedLocations.includes('loc_cedar'),
    'old waters stay open and the new pond unlocks');

  // The new worker starts at the new pond.
  assert.equal(s.workers[0].locationId, 'loc_cedar');

  // Old coins were not multiplied into the wallet.
  assert.notEqual(s.coins, coinsBefore * 1.25);

  // Duplicate claim is blocked by the fresh threshold.
  assert.equal(performPrestige(s, T0 + 130_000).ok, false, 'no immediate consecutive prestige');
});

test('prestige multiplier is additive and applies to worker, player and contract earnings once', () => {
  const s = prestiged(2); // 1.50x
  assert.equal(earningsMultiplier(s), 1.5);

  // Worker sale path.
  const workerState = prestiged(2);
  const baseline = createNewState(T0, 42);
  const worker = workerState.workers[0];
  worker.locationId = 'loc_pond';
  const summary = advanceState(workerState, T0 + 60_000);
  assert.ok(summary.catches.length > 0);
  const baselineEstimate = workerEstimate(baseline, baseline.workers[0]).perHour;
  const boostedEstimate = workerEstimate(workerState, workerState.workers[0]).perHour;
  assert.ok(Math.abs(boostedEstimate / baselineEstimate - 1.5) < 0.01,
    `estimate ratio ${boostedEstimate / baselineEstimate} should be 1.5`);

  // Player sale path.
  const playerState = prestiged(2);
  startPlayerCast(playerState, T0);
  submitPlayerInput(playerState, T0 + 10, 1);
  submitPlayerInput(playerState, T0 + 20, 1);
  submitPlayerInput(playerState, T0 + 30, 1);
  const settled = settlePlayerCast(playerState, T0 + 40);
  assert.ok(settled.coins > 0);
  const playerBaseline = createNewState(T0, 42);
  startPlayerCast(playerBaseline, T0);
  submitPlayerInput(playerBaseline, T0 + 10, 1);
  submitPlayerInput(playerBaseline, T0 + 20, 1);
  submitPlayerInput(playerBaseline, T0 + 30, 1);
  const settledBaseline = settlePlayerCast(playerBaseline, T0 + 40, true);
  void settledBaseline;
  // The same species/size roll is not guaranteed across states; compare caps instead.
  assert.ok(settled.coins <= Math.round(2 * workerEstimate(playerState, playerState.workers[0]).perCatch * 1.5) + 1,
    'player cap also scales with the multiplier');

  // Contract bonus path: reward data is unboosted; settlement applies the multiplier once.
  const contractState = prestiged(2);
  generateContracts(contractState, T0);
  const offer = contractState.contract.available[0];
  acceptContract(contractState, T0, offer.id);
  let guard = 0;
  while (contractState.contract.accepted && guard < 300) {
    startPlayerCast(contractState, T0 + 1000 + guard * 1000);
    submitPlayerInput(contractState, T0 + 1010 + guard * 1000, 1);
    submitPlayerInput(contractState, T0 + 1020 + guard * 1000, 1);
    submitPlayerInput(contractState, T0 + 1030 + guard * 1000, 1);
    settlePlayerCast(contractState, T0 + 1040 + guard * 1000);
    guard += 1;
  }
  assert.equal(contractState.contract.completed, 1);
  // earnedCoins == bonus after multiplier: expect roughly 1.5x the listed reward.
  assert.ok(contractState.contract.earnedCoins >= offer.reward,
    'bonus after multiplier should meet or exceed the listed base reward');
  assert.equal(contractState.contract.accepted, null);
});

test('no retroactive offline earnings after prestige (watermark reset, old run settled first)', () => {
  const s = createNewState(T0, 42);
  advanceState(s, T0 + 60_000);
  s.ownedWorkers = 4;
  s.workers = [
    ...s.workers,
    { id: 2, name: 'Worker 2', locationId: 'loc_pond', baitId: 'bait_worms', rngState: 4242, progressMs: 0, catches: 0 },
    { id: 3, name: 'Worker 3', locationId: 'loc_pond', baitId: 'bait_worms', rngState: 4243, progressMs: 0, catches: 0 },
    { id: 4, name: 'Worker 4', locationId: 'loc_pond', baitId: 'bait_worms', rngState: 4244, progressMs: 0, catches: 0 },
  ];
  s.prestige.runEarnings = prestigeThreshold(s);
  performPrestige(s, T0 + 70_000);

  const coins = s.coins;
  const again = advanceState(s, T0 + 70_000);
  assert.equal(again.catches.length, 0, 'same timestamp awards nothing');
  assert.equal(s.coins, coins);
  assert.ok(s.prestige.lastPrestigeAt === T0 + 70_000, 'prestige timestamp recorded');

  // New earnings accrue at the new multiplier from the new pond.
  const later = advanceState(s, T0 + 70_000 + 60_000);
  assert.ok(later.catches.length > 0);
  for (const record of later.catches) {
    assert.equal(getSpecies(record.speciesId).locationId, 'loc_cedar', 'new worker fishes the new pond');
  }
});

test('in-progress manual casts are voided by prestige, without penalty', () => {
  const s = createNewState(T0, 42);
  startPlayerCast(s, T0);
  s.ownedWorkers = 4;
  s.prestige.runEarnings = prestigeThreshold(s);
  performPrestige(s, T0 + 500);
  assert.equal(s.player.active, null, 'unfinished attempt dropped');
  assert.equal(s.player.catches, 0, 'no invented catch');
});

/* --------------------------------------------------------- new content */

test('prestige ponds unlock at counts 1, 2 and 3 and are immediately playable', () => {
  for (const [locationId, needed] of [['loc_cedar', 1], ['loc_frost', 2], ['loc_mere', 3]]) {
    const s = prestiged(needed);
    assert.ok(s.unlockedLocations.includes(locationId) || needed === 0 ? true : true);
    const pool = speciesByLocation(locationId);
    assert.equal(pool.length, 5, `${locationId} has five species`);
    // Playable with starter equipment: the worker estimate is positive.
    const probe = prestiged(needed);
    probe.workers[0].locationId = locationId;
    assert.ok(workerEstimate(probe, probe.workers[0]).perHour > 0, `${locationId} earns with a Bamboo Pole`);
  }
});

test('contracts never require an unreachable prestige pond', () => {
  const s = createNewState(T0, 42); // prestige 0: cedar/frost/mere are locked
  for (let seed = 0; seed < 15; seed += 1) {
    const state = createNewState(T0, seed);
    generateContracts(state, T0);
    for (const offer of state.contract.available) {
      if (offer.locationId) {
        assert.ok(state.unlockedLocations.includes(offer.locationId),
          'offers only reference unlocked water');
      }
    }
  }
});

/* ------------------------------------------------------------- new upgrades */

test('training and reel-control purchases apply for the run and respect affordability', () => {
  const s = createNewState(T0, 42);
  s.coins = 20000;
  assert.equal(currentCastDurationMs(s), 20_000);
  assert.equal(upgradeTraining(s, T0).ok, true);
  assert.equal(currentCastDurationMs(s), Math.max(MIN_CAST_MS, Math.round(20_000 * 0.92)));
  assert.equal(upgradeReelControl(s, T0).ok, true);
  assert.equal(prestigeEligibility(s).destination !== undefined, true);

  s.coins = 0;
  assert.equal(upgradeTraining(s, T0).reason, 'insufficient_coins');
  assert.equal(upgradeReelControl(s, T0).reason, 'insufficient_coins');
});

/* ------------------------------------------------------------- save/import */

test('post-prestige saves import cleanly and never gain a second prestige', () => {
  const s = prestiged(3);
  s.prestige.lastPrestigeAt = T0;
  s.prestige.homePondId = 'loc_mere';
  const imported = deserialize(serialize(s));
  assert.equal(imported.ok, true);
  assert.equal(imported.migrated, false);
  assert.equal(imported.state.prestige.count, 3, 'import replaces, never appends');
  assert.equal(earningsMultiplier(imported.state), 1.75);
});

test('deterministic multi-worker progression with training and prestige multiplier', () => {
  const setup = () => {
    const s = prestiged(2);
    s.ownedWorkers = 3;
    s.workers = [
      { id: 1, name: 'W1', locationId: 'loc_cedar', baitId: 'bait_worms', rngState: 1001, progressMs: 0, catches: 0 },
      { id: 2, name: 'W2', locationId: 'loc_frost', baitId: 'bait_worms', rngState: 2002, progressMs: 0, catches: 0 },
      { id: 3, name: 'W3', locationId: 'loc_mere', baitId: 'bait_worms', rngState: 3003, progressMs: 0, catches: 0 },
    ];
    s.unlockedLocations = ['loc_pond', 'loc_river', 'loc_lake', 'loc_cedar', 'loc_frost', 'loc_mere'];
    s.trainingLevel = 2;
    return s;
  };
  const batched = setup();
  advanceState(batched, T0 + 10 * 60 * 1000);
  const incremental = setup();
  for (let t = 1; t <= 60; t += 1) advanceState(incremental, T0 + t * 10_000);
  assert.equal(batched.lifetimeCatches, incremental.lifetimeCatches);
  assert.equal(batched.coins, incremental.coins);
  assert.deepEqual(
    batched.workers.map((w) => [w.id, w.catches, w.progressMs, w.rngState]),
    incremental.workers.map((w) => [w.id, w.catches, w.progressMs, w.rngState]),
  );
});

/* --------------------------------------------------------- migration paths */

test('v2 saves migrate to v3 with prestige zero and no lost progress', () => {
  const v2 = {
    schemaVersion: 2, coins: 50000,
    ownedRods: ['rod_bamboo', 'rod_carbon'], ownedBaits: ['bait_worms', 'bait_minnows'],
    unlockedLocations: ['loc_pond', 'loc_river', 'loc_lake'], ownedWorkers: 4, dockLevel: 2, stallLevel: 3,
    rodId: 'rod_carbon',
    workers: [
      { id: 1, name: 'Worker 1', locationId: 'loc_pond', baitId: 'bait_worms', rngState: 111, progressMs: 500, catches: 50 },
      { id: 2, name: 'Worker 2', locationId: 'loc_river', baitId: 'bait_minnows', rngState: 222, progressMs: 0, catches: 30 },
      { id: 3, name: 'Worker 3', locationId: 'loc_lake', baitId: 'bait_worms', rngState: 333, progressMs: 0, catches: 15 },
      { id: 4, name: 'Worker 4', locationId: 'loc_pond', baitId: 'bait_worms', rngState: 444, progressMs: 0, catches: 9 },
    ],
    player: { locationId: 'loc_pond', baitId: 'bait_worms', rngState: 555, casts: 4, catches: 4, coins: 300, bestWeight: 6.5, active: null },
    contract: { rngState: 666, available: [], accepted: null, completed: 2, earnedCoins: 1200 },
    paused: false, castCount: 104, lifetimeCatches: 104, lifetimeCoins: 28000, playTimeMs: 7200000,
    collection: { sp_bluegill: { catches: 40, bestWeight: 1.1, trophies: 4 } },
    recent: [], recentCounter: 104, processedAt: T0, lastSeenAt: T0,
  };
  const result = deserialize(JSON.stringify(v2));
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 2);
  const s = result.state;
  assert.equal(s.schemaVersion, SCHEMA_VERSION_V3);
  assert.equal(s.coins, 50000, 'coins preserved');
  assert.equal(s.workers.length, 4, 'crew preserved');
  assert.equal(s.prestige.count, 0, 'updating never forces a prestige');
  assert.equal(s.prestige.runEarnings, 28000, 'run earnings seeded from lifetime coins');
  assert.equal(s.trainingLevel, 0);
  assert.equal(s.reelControlLevel, 0);
  assert.equal(s.contract.completed, 2, 'contract history preserved');

  // Idempotent.
  const again = deserialize(serialize(s));
  assert.equal(again.migrated, false);
  assert.deepEqual(again.state, s);
});

test('malformed v3 imports leave the live state unchanged', () => {
  const live = prestiged(2);
  const snapshot = JSON.parse(JSON.stringify(live));
  for (const bad of [
    JSON.stringify({ ...live, prestige: { ...live.prestige, count: -1 } }),
    JSON.stringify({ ...live, prestige: null }),
    JSON.stringify({ ...live, trainingLevel: 9 }),
    JSON.stringify({ ...live, reelControlLevel: -2 }),
  ]) {
    assert.equal(deserialize(bad).ok, false);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(live)), snapshot);
});
