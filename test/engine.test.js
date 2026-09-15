import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCATIONS,
  OFFLINE_CAP_MS,
  RECENT_LIMIT,
  castDurationMs,
  coinsForCatch,
  getBait,
  getRod,
  getSpecies,
  isTrophy,
  rarityDistribution,
  speciesByLocation,
  trophyThreshold,
} from '../src/data.js';
import {
  advanceState,
  changeSetup,
  collectionEntry,
  createNewState,
  currentCastDurationMs,
  discoveredCount,
  purchase,
  purchaseAndVisit,
  selectBait,
  selectLocation,
  setFishing,
  trophyTotal,
} from '../src/engine.js';
import { serialize, deserialize, validateState } from '../src/save.js';

const T0 = 1_700_000_000_000;
const seed = 12345;

function freshFishing(now = T0) {
  const state = createNewState(now, seed);
  state.fishing = true;
  return state;
}

test('completed cast awards exactly one valid catch with the correct coin value', () => {
  const state = freshFishing();
  const duration = currentCastDurationMs(state);
  const summary = advanceState(state, T0 + duration);

  assert.equal(summary.catches.length, 1);
  const record = summary.catches[0];
  const species = getSpecies(record.speciesId);
  assert.ok(species, 'catch species must exist in the content table');
  assert.equal(species.locationId, state.locationId, 'catch must come from the current location');
  assert.ok(record.weight >= species.minWeight && record.weight <= species.maxWeight, 'weight inside range');
  assert.equal(record.coins, coinsForCatch(species, record.weight));
  assert.equal(state.coins, record.coins);
  assert.equal(state.lifetimeCatches, 1);
  assert.equal(state.castProgressMs, 0);
  assert.equal(collectionEntry(state, species.id).catches, 1);
  assert.equal(collectionEntry(state, species.id).bestWeight, record.weight);
});

test('an incomplete cast awards nothing and its progress survives serialization', () => {
  const state = freshFishing();
  const duration = currentCastDurationMs(state);
  const partial = Math.floor(duration * 0.4);
  advanceState(state, T0 + partial);

  assert.equal(state.coins, 0);
  assert.equal(state.lifetimeCatches, 0);
  assert.equal(state.castProgressMs, partial);

  const roundTripped = deserialize(serialize(state));
  assert.equal(roundTripped.ok, true, JSON.stringify(roundTripped.errors));
  assert.equal(roundTripped.state.castProgressMs, partial);
  assert.equal(roundTripped.state.rngState, state.rngState);

  // Resuming the round-tripped state completes the cast at the same moment as the original.
  const a = deserialize(serialize(state)).state;
  const b = deserialize(serialize(state)).state;
  const s1 = advanceState(a, T0 + duration);
  const s2 = advanceState(b, T0 + duration);
  assert.equal(s1.catches.length, 1);
  assert.equal(s2.catches.length, 1);
  assert.equal(s1.catches[0].speciesId, s2.catches[0].speciesId);
  assert.equal(s1.catches[0].weight, s2.catches[0].weight);
  assert.equal(a.castProgressMs, 0, 'completing the cast consumes all fractional progress');
  assert.equal(b.castProgressMs, 0);
});

test('calling advanceState twice with the same timestamp does not duplicate rewards', () => {
  const state = freshFishing();
  const duration = currentCastDurationMs(state);
  const summary = advanceState(state, T0 + duration);
  const coins = state.coins;
  const catches = state.lifetimeCatches;
  const rngState = state.rngState;

  const again = advanceState(state, T0 + duration);
  assert.equal(again.catches.length, 0);
  assert.equal(again.creditedMs, 0);
  assert.equal(state.coins, coins);
  assert.equal(state.lifetimeCatches, catches);
  assert.equal(state.rngState, rngState);
  assert.equal(summary.catches.length, 1);
});

test('batched and incremental simulation agree below the offline cap', () => {
  const totalMs = 20 * 60 * 1000; // 20 minutes, well under the cap
  const batched = freshFishing();
  const incremental = freshFishing();

  const batchSummary = advanceState(batched, T0 + totalMs);
  for (let t = 1; t <= 120; t += 1) {
    advanceState(incremental, T0 + t * (totalMs / 120));
  }

  assert.ok(batchSummary.catches.length > 50, 'sanity: a 20 minute batch resolves many casts');
  assert.equal(batched.lifetimeCatches, incremental.lifetimeCatches);
  assert.equal(batched.coins, incremental.coins);
  assert.equal(batched.rngState, incremental.rngState);
  assert.equal(batched.castProgressMs, incremental.castProgressMs);
  assert.equal(batched.processedAt, incremental.processedAt);
  assert.deepEqual(
    batched.recent.map((r) => `${r.speciesId}:${r.weight}:${r.coins}`),
    incremental.recent.map((r) => `${r.speciesId}:${r.weight}:${r.coins}`),
  );
});

test('an absence beyond the offline cap credits only the capped period, once', () => {
  const state = freshFishing();
  const twentyHours = 20 * 60 * 60 * 1000;
  const summary = advanceState(state, T0 + twentyHours);

  assert.equal(summary.creditedMs, OFFLINE_CAP_MS);
  assert.equal(summary.discardedMs, twentyHours - OFFLINE_CAP_MS);
  const expectedCatches = Math.floor(OFFLINE_CAP_MS / currentCastDurationMs(state));
  assert.equal(summary.catches.length, expectedCatches);
  assert.equal(state.processedAt, T0 + twentyHours, 'watermark advances past the discarded time');

  // Reloading again at the same wall clock gives nothing more.
  const coins = state.coins;
  const again = advanceState(state, T0 + twentyHours);
  assert.equal(again.catches.length, 0);
  assert.equal(again.creditedMs, 0);
  assert.equal(state.coins, coins);

  // And one minute of genuine new time still credits normally.
  const later = advanceState(state, T0 + twentyHours + 9 * 60 * 1000);
  assert.equal(later.creditedMs, 9 * 60 * 1000);
  assert.ok(later.catches.length > 0);
});

test('paused time earns nothing and freezes cast progress', () => {
  const state = freshFishing();
  const duration = currentCastDurationMs(state);
  advanceState(state, T0 + Math.floor(duration * 0.5));
  const progress = state.castProgressMs;

  setFishing(state, T0 + Math.floor(duration * 0.5), false);
  const summary = advanceState(state, T0 + 3 * 60 * 60 * 1000);
  assert.equal(summary.catches.length, 0);
  assert.equal(summary.coins, 0);
  assert.equal(state.coins, 0);
  assert.equal(state.castProgressMs, progress, 'progress is frozen while paused');

  // Not fishing also means a long absence yields nothing.
  const idle = createNewState(T0, seed);
  const idleSummary = advanceState(idle, T0 + 6 * 60 * 60 * 1000);
  assert.equal(idleSummary.catches.length, 0);
  assert.equal(idle.coins, 0);

  // Resume: the remaining progress finishes the cast, no retroactive catch.
  const resumed = freshFishing();
  advanceState(resumed, T0 + Math.floor(duration * 0.5));
  setFishing(resumed, T0 + Math.floor(duration * 0.5), false);
  advanceState(resumed, T0 + 3 * 60 * 60 * 1000);
  setFishing(resumed, T0 + 3 * 60 * 60 * 1000, true);
  advanceState(resumed, T0 + 3 * 60 * 60 * 1000 + Math.floor(duration * 0.5) - 1);
  assert.equal(resumed.lifetimeCatches, 0, 'still short of a full cast');
  advanceState(resumed, T0 + 3 * 60 * 60 * 1000 + Math.floor(duration * 0.5) + 1);
  assert.equal(resumed.lifetimeCatches, 1);
});

test('backward clock movement awards nothing and never corrupts state', () => {
  const state = freshFishing();
  const duration = currentCastDurationMs(state);
  advanceState(state, T0 + duration);
  const snapshot = JSON.parse(JSON.stringify(state));

  const back = advanceState(state, T0 - 5 * 60 * 1000);
  assert.equal(back.clockAnomaly, true);
  assert.equal(back.catches.length, 0);
  assert.equal(back.coins, 0);
  assert.equal(state.processedAt, snapshot.processedAt, 'watermark must not move backward');
  assert.equal(state.coins, snapshot.coins);
  assert.equal(state.rngState, snapshot.rngState);

  // Game continues normally afterwards.
  const forward = advanceState(state, snapshot.processedAt + duration);
  assert.equal(forward.catches.length, 1);
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).ok, true);
});

test('setup changes never apply new bonuses retroactively', () => {
  const state = freshFishing();
  state.coins = 100000;
  const slowDuration = currentCastDurationMs(state);

  // Four minutes of idle time at the slow starter rate: settle it before the upgrade.
  const elapsed = 4 * 60 * 1000;
  const bought = purchase(state, T0 + elapsed, 'rod_fiberglass');
  assert.equal(bought.ok, true);
  const earnedAtOldRate = state.coins - 100000 + bought.paid;
  const expectedCatches = Math.floor(elapsed / slowDuration);
  assert.equal(bought.settle.catches.length, expectedCatches, 'old setup settles the whole period');
  assert.equal(earnedAtOldRate, bought.settle.coins);

  // The new rod changes the rate only from here on.
  const fastDuration = currentCastDurationMs(state);
  assert.equal(fastDuration, castDurationMs(getRod('rod_fiberglass'), getBait('bait_worms')));
  assert.ok(fastDuration < slowDuration);
  const after = advanceState(state, T0 + elapsed + fastDuration);
  assert.equal(after.catches.length, 1, 'one fast cast resolves under the new rod');

  // Bait swap keeps earned catches at the old bait's timing, and never re-prices them.
  const coinsBefore = state.coins;
  const swap = changeSetup(state, T0 + elapsed + fastDuration, { baitId: 'bait_worms' });
  assert.equal(swap.settle.coins, 0, 'no time elapsed, so nothing new is credited');
  assert.equal(state.coins, coinsBefore);
});

test('purchases enforce affordability and ownership', () => {
  const state = createNewState(T0, seed);
  assert.equal(state.coins, 0);

  const denied = purchase(state, T0, 'rod_fiberglass');
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'insufficient_coins');
  assert.equal(state.coins, 0, 'failed purchase must not touch coins');
  assert.deepEqual(state.ownedRods, ['rod_bamboo']);

  state.coins = 1000;
  const rodCost = getRod('rod_fiberglass').cost;
  const bought = purchase(state, T0, 'rod_fiberglass');
  assert.equal(bought.ok, true);
  assert.equal(state.coins, 1000 - rodCost);

  const twice = purchase(state, T0, 'rod_fiberglass');
  assert.equal(twice.ok, false);
  assert.equal(twice.reason, 'already_owned');
  assert.equal(state.coins, 1000 - rodCost, 'no double charge');

  const unknown = purchase(state, T0, 'rod_platinum');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'unknown_item');

  assert.equal(purchase(state, T0, 'rod_carbon').ok, false);
  assert.ok(state.coins >= 0, 'coins can never go negative');

  // Location unlock + auto-switch.
  const riverCost = LOCATIONS.find((l) => l.id === 'loc_river').cost;
  state.coins = riverCost;
  const visited = purchaseAndVisit(state, T0, 'loc_river');
  assert.equal(visited.ok, true);
  assert.equal(state.coins, 0);
  assert.equal(state.locationId, 'loc_river');
  assert.ok(state.unlockedLocations.includes('loc_river'));

  // Bait selection only works on owned bait; a purchase equips it directly.
  assert.equal(selectBait(state, T0, 'bait_glow').ok, false);
  assert.equal(state.baitId, 'bait_worms');
  state.coins = 3500;
  assert.equal(purchase(state, T0, 'bait_glow').ok, true);
  assert.equal(state.baitId, 'bait_glow', 'purchased bait is equipped immediately');
  assert.equal(selectBait(state, T0, 'bait_worms').ok, true, 'starter bait can be re-selected at will');
  assert.equal(state.baitId, 'bait_worms');
});

test('species rolls stay valid for the selected location under every bait', () => {
  for (const locationId of ['loc_pond', 'loc_river', 'loc_lake']) {
    const validIds = new Set(speciesByLocation(locationId).map((s) => s.id));
    for (const baitId of ['bait_worms', 'bait_minnows', 'bait_glow']) {
      const state = createNewState(T0, 777);
      state.fishing = true;
      state.locationId = locationId;
      state.baitId = baitId;
      state.unlockedLocations.push(locationId);
      state.ownedBaits.push(baitId);
      const summary = advanceState(state, T0 + 2 * 60 * 60 * 1000);
      assert.ok(summary.catches.length > 100);
      for (const record of summary.catches) {
        assert.ok(validIds.has(record.speciesId), `${record.speciesId} is not in ${locationId}`);
      }
      const discovered = new Set(summary.catches.map((r) => r.speciesId));
      assert.ok(discovered.size >= 3, `expected several species in ${locationId} over 2h`);
    }
  }
});

test('collection totals, best weights and trophy counts update correctly', () => {
  const state = freshFishing();
  const summary = advanceState(state, T0 + 40 * 60 * 1000);
  assert.ok(summary.catches.length > 100);

  const bySpecies = new Map();
  let expectedTrophies = 0;
  let bestOverall = 0;
  for (const record of summary.catches) {
    const entry = bySpecies.get(record.speciesId) || { catches: 0, best: 0, trophies: 0 };
    entry.catches += 1;
    entry.best = Math.max(entry.best, record.weight);
    const trophy = isTrophy(getSpecies(record.speciesId), record.weight);
    if (trophy) entry.trophies += 1;
    bySpecies.set(record.speciesId, entry);
    if (trophy) expectedTrophies += 1;
  }

  for (const [speciesId, expected] of bySpecies) {
    const entry = collectionEntry(state, speciesId);
    assert.equal(entry.catches, expected.catches, `catch count for ${speciesId}`);
    assert.equal(entry.bestWeight, expected.best, `best weight for ${speciesId}`);
    assert.equal(entry.trophies, expected.trophies, `trophy count for ${speciesId}`);
    assert.ok(entry.bestWeight <= getSpecies(speciesId).maxWeight);
  }
  assert.equal(state.lifetimeCatches, summary.catches.length);
  assert.equal(trophyTotal(state), expectedTrophies);
  assert.equal(discoveredCount(state), bySpecies.size);
  assert.ok(state.recent.length <= RECENT_LIMIT);
  assert.equal(state.recent[0].speciesId, summary.catches[summary.catches.length - 1].speciesId);
  bestOverall = Math.max(...summary.catches.map((r) => r.weight));
  assert.ok(bestOverall > 0);
});

test('trophy thresholds sit inside the species size range and rarity odds are normalized', () => {
  for (const species of speciesByLocation('loc_pond').concat(speciesByLocation('loc_lake'))) {
    const threshold = trophyThreshold(species);
    assert.ok(threshold > species.minWeight && threshold < species.maxWeight, `${species.id} threshold`);
  }
  for (const baitId of ['bait_worms', 'bait_glow']) {
    const dist = rarityDistribution(speciesByLocation('loc_pond'), getBait(baitId));
    const sum = dist.reduce((a, d) => a + d.probability, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${baitId} probabilities must sum to 1 (got ${sum})`);
  }
  const base = rarityDistribution(speciesByLocation('loc_pond'), getBait('bait_worms'));
  const glow = rarityDistribution(speciesByLocation('loc_pond'), getBait('bait_glow'));
  const baseLegendary = base.find((d) => d.rarity === 'legendary').probability;
  const glowLegendary = glow.find((d) => d.rarity === 'legendary').probability;
  assert.ok(glowLegendary > baseLegendary, 'Glow Lure must raise legendary odds');
  assert.ok(
    glow.find((d) => d.rarity === 'common').probability < base.find((d) => d.rarity === 'common').probability,
    'Glow Lure trades away common fish',
  );
});

test('minnows bias sizes upward but the whole setup is never strictly better on speed', () => {
  const worms = getBait('bait_worms');
  const minnows = getBait('bait_minnows');
  assert.ok(minnows.castMult > worms.castMult, 'minnows slow casting down');
  assert.ok(minnows.sizeBias > 1, 'minnows bias the size roll upward');

  const state = createNewState(T0, 4242);
  state.fishing = true;
  state.ownedBaits.push('bait_minnows');
  state.baitId = 'bait_minnows';
  assert.ok(currentCastDurationMs(state) > castDurationMs(getRod('rod_bamboo'), worms));

  const summary = advanceState(state, T0 + 3 * 60 * 60 * 1000);
  const meanRatio = summary.catches
    .map((r) => {
      const s = getSpecies(r.speciesId);
      return (r.weight - s.minWeight) / (s.maxWeight - s.minWeight);
    })
    .reduce((a, b) => a + b, 0) / summary.catches.length;

  const plain = createNewState(T0, 4242);
  plain.fishing = true;
  const plainSummary = advanceState(plain, T0 + 3 * 60 * 60 * 1000);
  const plainMean = plainSummary.catches
    .map((r) => {
      const s = getSpecies(r.speciesId);
      return (r.weight - s.minWeight) / (s.maxWeight - s.minWeight);
    })
    .reduce((a, b) => a + b, 0) / plainSummary.catches.length;

  assert.ok(meanRatio > plainMean * 1.15, `minnows should catch bigger fish (${meanRatio} vs ${plainMean})`);
  assert.ok(summary.catches.length < plainSummary.catches.length, 'but fewer of them');
});

test('offline cap constant is eight hours', () => {
  assert.equal(OFFLINE_CAP_MS, 28_800_000);
});

test('location switch keeps collections and records from previous locations', () => {
  const state = freshFishing();
  state.coins = 100000;
  advanceState(state, T0 + 10 * 60 * 1000);
  const pondCatches = state.lifetimeCatches;
  assert.ok(pondCatches > 0);
  const pondDiscovery = discoveredCount(state);

  purchaseAndVisit(state, state.processedAt, 'loc_river');
  assert.equal(selectLocation(state, state.processedAt, 'loc_lake').ok, false, 'lake still locked');
  advanceState(state, state.processedAt + 10 * 60 * 1000);

  assert.ok(state.lifetimeCatches > pondCatches);
  assert.ok(discoveredCount(state) > pondDiscovery, 'river species add to the same collection');
  for (const record of state.recent) {
    assert.equal(getSpecies(record.speciesId).locationId, 'loc_river');
  }
});
