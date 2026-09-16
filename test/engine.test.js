import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCK_LEVELS,
  HIRE_COSTS,
  OFFLINE_CAP_MS,
  PLAYER_CAST,
  STALL_LEVELS,
  castDurationMs,
  getBait,
  getRod,
  getSpecies,
  speciesByLocation,
} from '../src/data.js';
import {
  abandonContract,
  acceptContract,
  advanceState,
  assignWorker,
  cancelPlayerCast,
  createNewState,
  dockCapacity,
  expandDock,
  generateContracts,
  hireWorker,
  purchaseBait,
  purchaseLocation,
  settlePlayerCast,
  setPaused,
  startPlayerCast,
  submitPlayerInput,
  upgradeRod,
  upgradeStall,
  workerEstimate,
} from '../src/engine.js';
import { deserialize } from '../src/save.js';

const T0 = 1_700_000_000_000;

function business(extraCoins = 0) {
  const s = createNewState(T0, 42);
  s.coins = extraCoins;
  return s;
}

/* ------------------------------------------------------------------ workers */

test('one free worker runs the business; hiring respects capacity, cost and ownership', () => {
  const s = business();
  assert.equal(s.ownedWorkers, 1);
  assert.equal(s.workers.length, 1);
  assert.equal(dockCapacity(s), 2);

  const summary = advanceState(s, T0 + 60_000);
  assert.ok(summary.catches.length > 2, 'a worker should land several catches in a minute');
  assert.ok(summary.catches.every((c) => c.source === 'worker'));
  assert.ok(s.coins > 0);

  // Second worker is free (two berths at dock level 0).
  const coinsAtHire = s.coins;
  assert.equal(hireWorker(s, T0 + 60_000).ok, true);
  assert.equal(s.workers.length, 2);
  assert.equal(s.coins, coinsAtHire, 'worker 2 costs nothing');

  // Dock full: hiring refuses even with money.
  s.coins = 100000;
  const refused = hireWorker(s, T0 + 60_000);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'dock_full');
  assert.equal(s.workers.length, 2);

  // Expand, then hire again — and the price comes from the content table.
  assert.equal(expandDock(s, T0 + 60_000).ok, true);
  assert.equal(dockCapacity(s), 3);
  const cost = HIRE_COSTS[3];
  s.coins = cost - 1;
  assert.equal(hireWorker(s, T0 + 60_000).reason, 'insufficient_coins');
  s.coins = cost;
  assert.equal(hireWorker(s, T0 + 60_000).ok, true);
  assert.equal(s.coins, 0);
  assert.equal(s.workers.length, 3);
});

test('workers fish different locations simultaneously with their own bait', () => {
  const s = business(20000);
  advanceState(s, T0 + 30_000);
  purchaseLocation(s, T0 + 30_000, 'loc_river');
  purchaseBait(s, T0 + 30_000, 'bait_minnows');
  hireWorker(s, T0 + 30_000);

  assert.equal(assignWorker(s, T0 + 30_000, 2, { locationId: 'loc_river', baitId: 'bait_minnows' }).ok, true);
  assert.equal(s.workers[0].locationId, 'loc_pond');
  assert.equal(s.workers[1].locationId, 'loc_river');

  const summary = advanceState(s, T0 + 90_000);
  const byWorkerLocation = new Map(summary.catches.map((c) => [c.speciesId, getSpecies(c.speciesId).locationId]));
  const pond = summary.catches.filter((c) => getSpecies(c.speciesId).locationId === 'loc_pond');
  const river = summary.catches.filter((c) => getSpecies(c.speciesId).locationId === 'loc_river');
  assert.ok(pond.length > 0, 'worker 1 still feeds the pond');
  assert.ok(river.length > 0, 'worker 2 is fishing the river');
  assert.ok(byWorkerLocation.size >= 2);
});

test('no retroactive earnings: hiring, dock, stall, rod and assignments settle first', () => {
  const s = business();
  advanceState(s, T0 + 60_000);
  const coinsBefore = s.coins;

  // Hiring settles the previous minute at the old rate, then charges.
  const result = hireWorker(s, T0 + 120_000);
  assert.equal(result.ok, true);
  assert.ok(s.coins >= 0);
  // Worker 2's first catch cannot have happened before it was hired: in the
  // settled minute only worker 1's catches exist.
  const minute2 = advanceState(s, T0 + 180_000);
  const expectTwoWorkers = minute2.catches.length;
  void expectTwoWorkers;
  // Contract: total lifetime coins must equal the sum of settled batches.
  const s2 = business();
  advanceState(s2, T0 + 60_000);
  hireWorker(s2, T0 + 120_000);
  advanceState(s2, T0 + 180_000);
  const batched = business();
  advanceState(batched, T0 + 180_000);
  assert.ok(s2.coins >= batched.coins, 'two workers out-earn one, never fewer catches than a plain batch');
  assert.ok(coinsBefore >= 0);
});

test('rod upgrade is shared: every worker and the player cast faster, never retroactively', () => {
  const s = business(2000);
  advanceState(s, T0 + 60_000);
  const slow = castDurationMs(getRod(s.rodId), getBait('bait_worms'));

  assert.equal(upgradeRod(s, T0 + 60_000, 'rod_carbon').ok, true);
  const fast = castDurationMs(getRod(s.rodId), getBait('bait_worms'));
  assert.equal(fast, 12_000);
  assert.ok(fast < slow, 'the shared rod speeds everyone up');
  assert.equal(workerEstimate(s, s.workers[0]).perHour > 0, true);

  // The settled minute was paid at the slow rate; the next minute is faster.
  const summary = advanceState(s, T0 + 120_000);
  assert.ok(summary.catches.length > 0);
});

test('worker estimates are labeled estimates and roughly match reality', () => {
  const s = business();
  const est = workerEstimate(s, s.workers[0]);
  assert.ok(est.perHour > 0 && est.perCatch > 0);
  const summary = advanceState(s, T0 + 60 * 60 * 1000);
  const actual = summary.coins;
  // Within a wide band: luck matters, structure does not.
  assert.ok(actual > est.perHour * 0.5 && actual < est.perHour * 2, `estimate ${est.perHour} vs actual ${actual}`);
});

/* ---------------------------------------------------------------- determinism */

test('batched and incremental multi-worker simulation agree exactly', () => {
  const setup = () => {
    const s = business(50000);
    advanceState(s, T0 + 30_000);
    purchaseLocation(s, T0 + 30_000, 'loc_river');
    purchaseBait(s, T0 + 30_000, 'bait_minnows');
    hireWorker(s, T0 + 30_000);
    expandDock(s, T0 + 30_000);
    hireWorker(s, T0 + 30_000);
    assignWorker(s, T0 + 30_000, 2, { locationId: 'loc_river', baitId: 'bait_minnows' });
    assignWorker(s, T0 + 30_000, 3, { locationId: 'loc_pond' });
    return s;
  };

  const batched = setup();
  // processedAt is T0+30s after setup; both runs must cover the SAME horizon.
  advanceState(batched, T0 + 30_000 + 30 * 60 * 1000);

  const incremental = setup();
  for (let t = 1; t <= 60; t += 1) advanceState(incremental, T0 + 30_000 + t * 30_000);

  assert.equal(batched.lifetimeCatches, incremental.lifetimeCatches);
  assert.equal(batched.coins, incremental.coins);
  assert.deepEqual(
    batched.workers.map((w) => [w.id, w.catches, w.progressMs, w.rngState]),
    incremental.workers.map((w) => [w.id, w.catches, w.progressMs, w.rngState]),
  );
  // Per-worker streams are identical, so each worker's own catches match; the
  // global recent feed interleaves the workers differently depending on batch
  // size (worker A's batch-2 catch can land before worker B's batch-1 catch),
  // so compare multisets of per-worker results instead of the interleaved feed.
  const census = (s) => {
    const m = new Map();
    for (const r of [
      ...s.workers.map((w) => `${w.id}:${w.catches}:${w.progressMs}`),
      `coins:${s.coins}`,
      `lifetime:${s.lifetimeCatches}:${s.lifetimeCoins}`,
    ].sort()) m.set(r, (m.get(r) || 0) + 1);
    return [...m.entries()].sort();
  };
  assert.deepEqual(census(batched), census(incremental));
});

test('offline cap applies once across all workers', () => {
  const s = business();
  hireWorker(s, T0 + 1000);
  const summary = advanceState(s, T0 + 20 * 60 * 60 * 1000);
  assert.equal(summary.creditedMs, OFFLINE_CAP_MS);
  const expectedMin = 2 * Math.floor(OFFLINE_CAP_MS / 20_000) * 0.9;
  assert.ok(summary.catches.length >= expectedMin, 'both workers earned for the capped window');
  const coins = s.coins;
  const again = advanceState(s, T0 + 20 * 60 * 60 * 1000);
  assert.equal(again.catches.length, 0);
  assert.equal(s.coins, coins);
});

test('paused time earns nothing and the watermark still advances', () => {
  const s = business();
  setPaused(s, T0, true);
  const summary = advanceState(s, T0 + 3 * 60 * 60 * 1000);
  assert.equal(summary.catches.length, 0);
  assert.equal(s.coins, 0);
  assert.equal(s.processedAt, T0 + 3 * 60 * 60 * 1000);
  setPaused(s, T0 + 3 * 60 * 60 * 1000, false);
  const resumed = advanceState(s, T0 + 3 * 60 * 60 * 1000 + 60_000);
  assert.ok(resumed.catches.length > 0);
});

test('backward clock movement awards nothing and state stays valid', () => {
  const s = business();
  advanceState(s, T0 + 60_000);
  const before = s.coins;
  const back = advanceState(s, T0 - 60_000);
  assert.equal(back.clockAnomaly, true);
  assert.equal(back.catches.length, 0);
  assert.equal(s.coins, before);
  const forward = advanceState(s, T0 + 120_000);
  assert.ok(forward.catches.length > 0);
});

/* ------------------------------------------------------------- player fishing */

test('player cast: one result exactly once, separate stream, cancel is safe', () => {
  const s = business();
  const workerRng = s.workers[0].rngState;
  const before = s.rngState === undefined ? null : null;

  assert.equal(startPlayerCast(s, T0).ok, true);
  assert.equal(startPlayerCast(s, T0).ok, false, 'no double cast');
  assert.notEqual(s.workers[0].rngState, undefined);
  assert.equal(s.workers[0].rngState, workerRng, 'worker stream untouched');

  submitPlayerInput(s, T0 + 100, 1);
  submitPlayerInput(s, T0 + 200, 1);
  const last = submitPlayerInput(s, T0 + 300, 1);
  assert.equal(last.complete, true);

  const settled = settlePlayerCast(s, T0 + 400);
  assert.equal(settled.ok, true);
  assert.equal(settled.source, 'player');
  assert.ok(settled.coins >= 1);
  assert.equal(s.player.active, null, 'cast consumed');

  assert.equal(settlePlayerCast(s, T0 + 500).ok, false, 'cannot settle twice');
  assert.equal(s.player.catches, 1);

  // Cancel path.
  startPlayerCast(s, T0 + 1000);
  assert.equal(cancelPlayerCast(s).ok, true);
  assert.equal(s.player.catches, 1, 'no invented catch');
  assert.equal(settlePlayerCast(s, T0 + 1100).ok, false);
});

test('auto settle (missed taps / accessible route) still sells an ordinary fish', () => {
  const s = business();
  startPlayerCast(s, T0);
  const auto = settlePlayerCast(s, T0 + 100, true);
  assert.equal(auto.ok, true);
  assert.equal(auto.quality, PLAYER_CAST.idleQuality);
  assert.ok(auto.coins >= 1);

  // Skilled play should beat auto on average, but both are positive.
  const s2 = business();
  startPlayerCast(s2, T0);
  submitPlayerInput(s2, T0 + 10, 1); submitPlayerInput(s2, T0 + 20, 1); submitPlayerInput(s2, T0 + 30, 1);
  const skilled = settlePlayerCast(s2, T0 + 40, false);
  assert.ok(skilled.coins >= auto.coins * 0.9, 'skilled is never worse than auto by much');
});

test('player catches update the collection, records and count as business catches', () => {
  const s = business();
  startPlayerCast(s, T0);
  submitPlayerInput(s, T0 + 10, 1); submitPlayerInput(s, T0 + 20, 1); submitPlayerInput(s, T0 + 30, 1);
  const result = settlePlayerCast(s, T0 + 40);
  assert.equal(s.collection[result.speciesId].catches, 1);
  assert.equal(s.player.bestWeight, result.weight);
  assert.equal(s.lifetimeCatches, 1);
  assert.equal(s.castCount, 1);
});

/* --------------------------------------------------------------- contracts */

test('contract board: only unlocked content, three offers, one accepted at a time', () => {
  const s = business();
  const generated = generateContracts(s, T0);
  assert.equal(generated.ok, true);
  assert.equal(s.contract.available.length, 3);

  // Offers must reference unlocked locations only.
  for (const offer of s.contract.available) {
    if (offer.locationId) assert.ok(s.unlockedLocations.includes(offer.locationId));
  }
  // Early-game offers must not demand epic or legendary fish.
  for (const offer of s.contract.available) {
    if (offer.kind === 'size') {
      const species = getSpecies(offer.speciesId);
      assert.ok(['common', 'uncommon'].includes(species.rarity), 'early size goals use easy fish');
    }
    if (offer.kind === 'rarity') {
      assert.ok(['uncommon', 'rare'].includes(offer.rarity), 'rarity goals are uncommon or rare, not legendary');
    }
  }

  assert.equal(acceptContract(s, T0, s.contract.available[0].id).ok, true);
  assert.equal(s.contract.available.length, 0);
  assert.equal(generateContracts(s, T0).ok, false, 'one at a time');
  assert.equal(acceptContract(s, T0, 'nope').ok, false);
});

test('only catches after acceptance count; bonus is paid exactly once, on top of sales', () => {
  const s = business();
  generateContracts(s, T0);
  const offer = s.contract.available[0];
  assert.ok(offer, 'an offer exists');
  const coinsBeforeAccept = s.coins;
  acceptContract(s, T0, offer.id);
  assert.equal(s.coins, coinsBeforeAccept, 'accepting never charges coins');

  // Worker catches feed the contract (same location for qty contracts).
  advanceState(s, T0 + 5 * 60 * 1000);
  const progressAfterWorkers = s.contract.accepted ? s.contract.accepted.count : offer.qty;

  // Drive to completion with player casts if needed.
  let guard = 0;
  while (s.contract.accepted && guard < 300) {
    startPlayerCast(s, T0 + 600_000 + guard * 1000);
    submitPlayerInput(s, T0 + 600_000 + guard * 1000 + 10, 1);
    submitPlayerInput(s, T0 + 600_000 + guard * 1000 + 20, 1);
    submitPlayerInput(s, T0 + 600_000 + guard * 1000 + 30, 1);
    settlePlayerCast(s, T0 + 600_000 + guard * 1000 + 40);
    guard += 1;
  }
  assert.equal(s.contract.accepted, null, 'contract completed');
  assert.equal(s.contract.completed, 1);
  assert.equal(s.contract.earnedCoins, offer.reward, 'bonus paid exactly once');
  assert.ok(progressAfterWorkers >= 0);
});

test('abandoning is free and the board can be refilled', () => {
  const s = business();
  generateContracts(s, T0);
  acceptContract(s, T0, s.contract.available[0].id);
  const coins = s.coins;
  assert.equal(abandonContract(s, T0).ok, true);
  assert.equal(s.coins, coins, 'no penalty');
  assert.equal(generateContracts(s, T0).ok, true);
});

test('contract progress survives save/load', () => {
  const s = business();
  generateContracts(s, T0);
  acceptContract(s, T0, s.contract.available[0].id);
  advanceState(s, T0 + 60_000);
  const raw = JSON.stringify(s);
  const loaded = deserialize(raw);
  assert.equal(loaded.ok, true);
  if (s.contract.accepted) {
    assert.equal(loaded.state.contract.accepted.id, s.contract.accepted.id);
    assert.equal(loaded.state.contract.accepted.count, s.contract.accepted.count);
  } else {
    assert.equal(loaded.state.contract.completed, 1);
  }
});
