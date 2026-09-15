import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAITS,
  BASE_RARITY_WEIGHTS,
  LOCATIONS,
  RARITY_ORDER,
  RODS,
  SPECIES,
  coinsForCatch,
  getSpecies,
  rarityDistribution,
  speciesByLocation,
  trophyThreshold,
} from '../src/data.js';
import {
  advanceState,
  collectionEntry,
  createNewState,
  purchase,
  purchaseAndVisit,
} from '../src/engine.js';

const T0 = 1_700_000_000_000;

test('content shape matches the design: three locations, five ordered species each', () => {
  assert.equal(LOCATIONS.length, 3);
  assert.deepEqual(LOCATIONS.map((l) => l.id), ['loc_pond', 'loc_river', 'loc_lake']);
  assert.equal(LOCATIONS[0].cost, 0, 'the first location is free');
  assert.ok(LOCATIONS[1].cost > 0 && LOCATIONS[2].cost > LOCATIONS[1].cost, 'later water costs more');

  assert.equal(SPECIES.length, 15);
  const ids = new Set(SPECIES.map((s) => s.id));
  assert.equal(ids.size, 15, 'species ids are unique');

  for (const location of LOCATIONS) {
    const pool = speciesByLocation(location.id);
    assert.equal(pool.length, 5, `${location.name} has five species`);
    assert.deepEqual(pool.map((s) => s.rarity), RARITY_ORDER, `${location.name} rarities follow the listed order`);
    for (const species of pool) {
      assert.ok(species.minWeight > 0 && species.maxWeight > species.minWeight, `${species.id} weight range`);
      assert.ok(species.baseValue > 0, `${species.id} has a value`);
      const threshold = trophyThreshold(species);
      assert.ok(threshold > species.minWeight && threshold < species.maxWeight, `${species.id} trophy threshold inside range`);
      assert.ok(typeof species.hint === 'string' && species.hint.length > 10, `${species.id} has a useful hint`);
      assert.ok(coinsForCatch(species, species.minWeight) >= 1);
      assert.ok(Number.isInteger(coinsForCatch(species, species.maxWeight)));
    }
  }

  // Later water is worth more per cast.
  const meanValue = (locationId) => {
    const pool = speciesByLocation(locationId);
    return pool.reduce((sum, s) => sum + s.baseValue * BASE_RARITY_WEIGHTS[s.rarity], 0);
  };
  assert.ok(meanValue('loc_river') > meanValue('loc_pond') * 1.5);
  assert.ok(meanValue('loc_lake') > meanValue('loc_river') * 1.5);
});

test('base probability distribution is 58/28/10/3.5/0.5 and sums to one', () => {
  assert.deepEqual(BASE_RARITY_WEIGHTS, { common: 0.58, uncommon: 0.28, rare: 0.1, epic: 0.035, legendary: 0.005 });
  const worms = BAITS.find((b) => b.id === 'bait_worms');
  for (const location of LOCATIONS) {
    const dist = rarityDistribution(speciesByLocation(location.id), worms);
    const byRarity = Object.fromEntries(dist.map((d) => [d.rarity, d.probability]));
    for (const rarity of RARITY_ORDER) {
      assert.ok(Math.abs(byRarity[rarity] - BASE_RARITY_WEIGHTS[rarity]) < 1e-9, `${location.id} ${rarity}`);
    }
    assert.ok(Math.abs(dist.reduce((a, d) => a + d.probability, 0) - 1) < 1e-9);
  }
});

test('equipment list matches the design: four rods and three permanent baits', () => {
  assert.equal(RODS.length, 4);
  assert.equal(RODS[0].cost, 0, 'the starter rod is free');
  assert.deepEqual(RODS.map((r) => r.castSeconds), [20, 16, 12, 9], 'suggested base cast durations');
  for (let i = 1; i < RODS.length; i += 1) {
    assert.ok(RODS[i].cost > RODS[i - 1].cost, 'better rods cost more');
    assert.ok(RODS[i].castSeconds < RODS[i - 1].castSeconds, 'better rods cast faster');
  }

  assert.equal(BAITS.length, 3);
  const worms = BAITS.find((b) => b.id === 'bait_worms');
  assert.equal(worms.cost, 0, 'worms are free');
  assert.equal(worms.castMult, 1, 'worms keep full cast speed');
  assert.equal(worms.sizeBias, 1);
  assert.equal(worms.rarity, null, 'worms use the base species odds');

  for (const bait of BAITS.slice(1)) {
    assert.ok(bait.cost > 0, `${bait.id} is a one-time unlock`);
    assert.ok(bait.castMult > 1, `${bait.id} slows casting, so nothing is strictly better than worms`);
  }
  const minnows = BAITS.find((b) => b.id === 'bait_minnows');
  const glow = BAITS.find((b) => b.id === 'bait_glow');
  assert.ok(minnows.sizeBias > 1, 'minnows bias toward big fish');
  assert.ok(glow.sizeBias < 1, 'the glow lure skews small, paying for its rarity advantage');
  assert.ok(glow.rarity && glow.rarity.legendary > 1 && glow.rarity.common < 1);
});

test('long play keeps per-species records internally consistent at every location', () => {
  for (const location of LOCATIONS) {
    const state = createNewState(T0, 2024);
    state.fishing = true;
    state.locationId = location.id;
    state.unlockedLocations = LOCATIONS.map((l) => l.id);
    state.ownedRods = RODS.map((r) => r.id);
    state.rodId = 'rod_pro';
    state.coins = 10_000_000;

    const summary = advanceState(state, T0 + 8 * 60 * 60 * 1000);
    assert.ok(summary.catches.length > 1000, `${location.id} should resolve many catches`);
    assert.ok(state.coins > 0);

    for (const record of summary.catches) {
      assert.ok(Number.isInteger(record.coins) && record.coins >= 1, 'rewards are positive integers');
    }

    let trophies = 0;
    for (const species of speciesByLocation(location.id)) {
      const entry = collectionEntry(state, species.id);
      if (entry.catches === 0) continue;
      assert.ok(entry.bestWeight >= species.minWeight && entry.bestWeight <= species.maxWeight, `${species.id} best in range`);
      assert.ok(entry.trophies <= entry.catches, `${species.id} cannot have more trophies than catches`);
      if (entry.trophies > 0) {
        assert.ok(
          entry.bestWeight >= trophyThreshold(species),
          `${species.id} has ${entry.trophies} trophies, so its best must clear the trophy bar`,
        );
      }
      trophies += entry.trophies;
    }
    const loggedTrophies = summary.catches.filter((r) => r.trophy).length;
    assert.equal(trophies, loggedTrophies, `${location.id}: collection trophy counts match the catch log`);
    assert.ok(loggedTrophies > 0, `${location.id}: eight hours should land some trophies`);
  }
});

test('a mixed purchase run never goes negative and never soft-locks', () => {
  const state = createNewState(T0, 31337);
  state.fishing = true;
  const schedule = [
    ['bait_minnows'], ['rod_fiberglass'], ['loc_river'], ['rod_carbon'], ['bait_glow'], ['loc_lake'], ['rod_pro'],
  ].flat();

  let purchased = 0;
  for (let step = 1; step <= 40; step += 1) {
    const now = T0 + step * 6 * 60 * 1000;
    advanceState(state, now);
    for (const id of schedule) {
      const result = purchase(state, now, id);
      if (result.ok) purchased += 1;
      assert.ok(state.coins >= 0, `coins went negative after buying ${id}`);
    }
    assert.ok(Number.isFinite(state.coins));
    assert.ok(state.ownedRods.includes('rod_bamboo') && state.ownedBaits.includes('bait_worms'));
    assert.ok(state.unlockedLocations.includes('loc_pond'));
  }
  assert.equal(purchased, schedule.length, 'every item is attainable within four hours of pond play');

  // Still playable with free bait and the starter rod.
  const poor = createNewState(T0, 5);
  poor.fishing = true;
  poor.coins = 0;
  const summary = advanceState(poor, T0 + 60 * 60 * 1000);
  assert.ok(summary.catches.length >= 170, 'free gear keeps earning');
  assert.equal(poor.rodId, 'rod_bamboo');
  assert.equal(poor.baitId, 'bait_worms');
});

test('buying a location switches to it and keeps the old collection', () => {
  const state = createNewState(T0, 77);
  state.fishing = true;
  state.coins = 5_000;
  advanceState(state, T0 + 5 * 60 * 1000);
  const pondSpecies = Object.keys(state.collection);
  assert.ok(pondSpecies.length > 0);

  assert.equal(purchaseAndVisit(state, state.processedAt, 'loc_river').ok, true);
  assert.equal(state.locationId, 'loc_river');
  assert.equal(state.castProgressMs, 0, 'moving water starts a fresh cast');
  advanceState(state, state.processedAt + 32 * 60 * 1000);

  for (const id of pondSpecies) {
    assert.ok(collectionEntry(state, id).catches > 0, 'earlier records survive the move');
  }
  const riverCatch = state.recent.some((r) => getSpecies(r.speciesId).locationId === 'loc_river');
  assert.ok(riverCatch, 'river species are now being caught');
});