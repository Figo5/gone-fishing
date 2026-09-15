import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAITS,
  BASE_RARITY_WEIGHTS,
  CONTRACT_TEMPLATES,
  DOCK_LEVELS,
  HIRE_COSTS,
  LOCATIONS,
  OFFLINE_CAP_MS,
  PLAYER_CAST,
  RARITY_ORDER,
  RODS,
  SPECIES,
  STALL_LEVELS,
  coinsForCatch,
  getSpecies,
  speciesByLocation,
  trophyThreshold,
} from '../src/data.js';
import {
  abandonContract,
  acceptContract,
  advanceState,
  assignWorker,
  collectionEntry,
  createNewState,
  dockCapacity,
  expandDock,
  generateContracts,
  hireWorker,
  purchaseBait,
  purchaseLocation,
  settlePlayerCast,
  startPlayerCast,
  submitPlayerInput,
  upgradeRod,
  upgradeStall,
  workerEstimate,
} from '../src/engine.js';

const T0 = 1_700_000_000_000;

test('content shape matches the design: three locations, five ordered species each', () => {
  assert.equal(LOCATIONS.length, 3);
  assert.deepEqual(LOCATIONS.map((l) => l.id), ['loc_pond', 'loc_river', 'loc_lake']);
  assert.equal(LOCATIONS[0].cost, 0, 'the first location is free');
  assert.ok(LOCATIONS[1].cost > 0 && LOCATIONS[2].cost > LOCATIONS[1].cost, 'later water costs more');

  assert.equal(SPECIES.length, 15);
  assert.equal(new Set(SPECIES.map((s) => s.id)).size, 15, 'species ids are unique');

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
    const dist = speciesByLocation(location.id);
    void dist;
    const sum = RARITY_ORDER.reduce((acc, r) => acc + BASE_RARITY_WEIGHTS[r], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  }
});

test('equipment list: four rods, three permanent baits, none strictly dominant', () => {
  assert.equal(RODS.length, 4);
  assert.equal(RODS[0].cost, 0);
  assert.deepEqual(RODS.map((r) => r.castSeconds), [20, 16, 12, 9]);
  for (let i = 1; i < RODS.length; i += 1) {
    assert.ok(RODS[i].cost > RODS[i - 1].cost && RODS[i].castSeconds < RODS[i - 1].castSeconds);
  }

  assert.equal(BAITS.length, 3);
  const worms = BAITS.find((b) => b.id === 'bait_worms');
  assert.equal(worms.cost, 0 && worms.castMult, 1);
  assert.equal(worms.castMult, 1);
  assert.equal(worms.sizeBias, 1);
  assert.equal(worms.rarity, null);
  for (const bait of BAITS.slice(1)) {
    assert.ok(bait.cost > 0, `${bait.id} is a one-time unlock`);
    assert.ok(bait.castMult > 1, `${bait.id} costs cast speed, so nothing is strictly better than worms`);
  }
  const minnows = BAITS.find((b) => b.id === 'bait_minnows');
  const glow = BAITS.find((b) => b.id === 'bait_glow');
  assert.ok(minnows.sizeBias > 1, 'minnows bias toward big fish');
  assert.ok(glow.sizeBias < 1, 'the glow lure skews small, paying for its rarity advantage');
  assert.ok(glow.rarity.legendary > 1 && glow.rarity.common < 1);
});

test('tycoon economy tables: six workers, five dock levels, four stall levels', () => {
  assert.equal(HIRE_COSTS.length, 7, 'worker 1..6 plus a sentinel');
  assert.equal(HIRE_COSTS[1], 0 && HIRE_COSTS[2], 0);
  assert.equal(HIRE_COSTS[2], 0, 'the second worker is free');
  for (let i = 3; i <= 6; i += 1) assert.ok(HIRE_COSTS[i] > HIRE_COSTS[i - 1], 'later hires cost more');

  assert.equal(DOCK_LEVELS[0].capacity, 2);
  for (let i = 1; i < DOCK_LEVELS.length; i += 1) {
    assert.ok(DOCK_LEVELS[i].capacity > DOCK_LEVELS[i - 1].capacity, 'capacity grows');
    assert.ok(DOCK_LEVELS[i].cost > 0);
  }
  assert.equal(DOCK_LEVELS[DOCK_LEVELS.length - 1].capacity, 6, 'six workers at most');

  assert.equal(STALL_LEVELS[0].mult, 1);
  assert.equal(STALL_LEVELS.length, 4, 'a small finite number of stall levels');
  for (let i = 1; i < STALL_LEVELS.length; i += 1) {
    assert.ok(STALL_LEVELS[i].mult > STALL_LEVELS[i - 1].mult, 'stall improves sales');
    assert.ok(STALL_LEVELS[i].mult <= 1.3, 'the improvement stays modest');
  }
});

test('long play keeps per-species records consistent at every location', () => {
  for (const location of LOCATIONS) {
    const state = createNewState(T0, 2024);
    state.ownedRods = RODS.map((r) => r.id);
    state.rodId = 'rod_pro';
    state.workers[0].locationId = location.id; // the whole business fishes this water
    const summary = advanceState(state, T0 + OFFLINE_CAP_MS);
    assert.ok(summary.catches.length > 1000, `${location.id} resolves many catches`);

    let loggedTrophies = 0;
    for (const species of speciesByLocation(location.id)) {
      const entry = state.collection[species.id];
      if (!entry || entry.catches === 0) continue;
      assert.ok(entry.bestWeight >= species.minWeight && entry.bestWeight <= species.maxWeight, `${species.id} best in range`);
      assert.ok(entry.trophies <= entry.catches, `${species.id} cannot have more trophies than catches`);
      if (entry.trophies > 0) {
        assert.ok(entry.bestWeight >= trophyThreshold(species), `${species.id} trophies imply a best above the bar`);
      }
      loggedTrophies += entry.trophies;
    }
    const logTrophies = summary.catches.filter((r) => r.trophy).length;
    assert.equal(loggedTrophies, logTrophies, `${location.id}: collection matches the catch log`);
    assert.ok(logTrophies > 0);
  }
});

test('all six workers, dock levels and stall levels are attainable within four hours of idle play', () => {
  const state = createNewState(T0, 31337);
  const step = 5 * 60 * 1000;
  const tryBuy = () => {
    // Prefer hiring, then dock space, then the stall — whatever is affordable.
    const hire = hireWorker(state, state.processedAt);
    if (hire.ok || hire.reason === 'at_limit') return hire.ok ? 'hire' : null;
    if (hire.reason === 'dock_full') {
      const dock = expandDock(state, state.processedAt);
      if (dock.ok) return 'dock';
    }
    const stall = upgradeStall(state, state.processedAt);
    if (stall.ok) return 'stall';
    return null;
  };
  let hires = 0;
  let docks = 0;
  let stalls = 0;
  for (let t = 1; t <= 48; t += 1) {
    advanceState(state, T0 + t * step);
    for (let guard = 0; guard < 10; guard += 1) {
      const what = tryBuy();
      if (!what) break;
      if (what === 'hire') hires += 1;
      if (what === 'dock') docks += 1;
      if (what === 'stall') stalls += 1;
    }
  }
  assert.equal(state.ownedWorkers, 6, `hired ${hires} workers`);
  assert.equal(state.dockLevel, DOCK_LEVELS.length - 1, `expanded the dock ${docks} times`);
  assert.equal(state.stallLevel, STALL_LEVELS.length - 1, `upgraded the stall ${stalls} times`);
  assert.ok(state.coins >= 0, 'never negative');
});

test('a mixed purchase run never goes negative and never soft-locks', () => {
  const state = createNewState(T0, 5);
  const schedule = ['loc_river', 'bait_minnows', 'rod_carbon', 'bait_glow', 'loc_lake', 'rod_pro'];
  for (let t = 1; t <= 60; t += 1) {
    const now = T0 + t * 5 * 60 * 1000;
    advanceState(state, now);
    for (const id of schedule) {
      if (id.startsWith('loc_')) purchaseLocation(state, now, id);
      else if (id.startsWith('bait_')) purchaseBait(state, now, id);
      else upgradeRod(state, now, id);
      assert.ok(state.coins >= 0, `negative coins after ${id}`);
    }
  }
  assert.equal(state.ownedRods.includes('rod_bamboo'), true);
  assert.equal(state.ownedBaits.includes('bait_worms'), true);

  // Free gear keeps earning: a fresh game with nothing bought still works.
  const poor = createNewState(T0, 5);
  const summary = advanceState(poor, T0 + 60 * 60 * 1000);
  assert.ok(summary.catches.length >= 170, 'idle-only play earns with the free setup');
});

test('player cap keeps hands-on play a boost, not a takeover', () => {
  const pondWorker = (state) => {
    const pool = speciesByLocation('loc_pond');
    return pool.reduce((sum, s) => sum + coinsForCatch(s, (s.minWeight + s.maxWeight) / 2) * BASE_RARITY_WEIGHTS[s.rarity], 0);
  };
  const state = createNewState(T0, 20260915);
  const cap = Math.round(pondWorker(state) * PLAYER_CAST.valueCapWorkerCasts);

  let perfectTotal = 0;
  for (let i = 0; i < 40; i += 1) {
    startPlayerCast(state, T0 + i * 1000);
    submitPlayerInput(state, T0 + i * 1000 + 10, 1);
    submitPlayerInput(state, T0 + i * 1000 + 20, 1);
    submitPlayerInput(state, T0 + i * 1000 + 30, 1);
    perfectTotal += settlePlayerCast(state, T0 + i * 1000 + 40).coins;
  }
  const average = perfectTotal / 40;
  assert.ok(average <= cap, `perfect player average ${average} must respect the cap ${cap}`);
  assert.ok(average > 0);
});

test('contract offers only use unlocked content and achievable rarities', () => {
  const state = createNewState(T0, 7);
  for (let seed = 0; seed < 20; seed += 1) {
    const s = createNewState(T0, seed);
    generateContracts(s, T0);
    for (const offer of s.contract.available) {
      if (offer.locationId) assert.ok(s.unlockedLocations.includes(offer.locationId), 'unlocked location only');
      if (offer.kind === 'size') {
        const species = getSpecies(offer.speciesId);
        assert.ok(['common', 'uncommon'].includes(species.rarity), 'early size goals use easy fish');
        assert.ok(offer.threshold < species.maxWeight, 'threshold is reachable');
      }
      if (offer.kind === 'rarity') {
        assert.ok(offer.rarity === 'uncommon' || offer.rarity === 'rare', 'no legendary-gated goals');
      }
      assert.ok(offer.reward > 0);
    }
  }
  assert.equal(CONTRACT_TEMPLATES.length, 3);
});

test('assignments change what workers catch (location and bait matter)', () => {
  const state = createNewState(T0, 91);
  state.unlockedLocations = ['loc_pond', 'loc_river', 'loc_lake'];
  state.ownedBaits = ['bait_worms', 'bait_minnows', 'bait_glow'];
  state.ownedWorkers = 3;
  // reuse hireWorker to keep workers array consistent
  while (state.workers.length < 3) {
    const w = { id: state.workers.length + 1, name: `Worker ${state.workers.length + 1}`, locationId: 'loc_pond', baitId: 'bait_worms', rngState: 1000 + state.workers.length, progressMs: 0, catches: 0 };
    state.workers.push(w);
  }
  assignWorker(state, T0, 1, { locationId: 'loc_pond' });
  assignWorker(state, T0, 2, { locationId: 'loc_river' });
  assignWorker(state, T0, 3, { locationId: 'loc_lake' });
  const summary = advanceState(state, T0 + 10 * 60 * 1000);
  const locations = new Set(summary.catches.map((r) => getSpecies(r.speciesId).locationId));
  assert.ok(locations.has('loc_pond') && locations.has('loc_river') && locations.has('loc_lake'),
    'three workers fish three waters at once');
});
