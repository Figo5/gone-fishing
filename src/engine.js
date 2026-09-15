/**
 * Gone Fishing — simulation engine (schema v2: the dock is a small business).
 *
 * Up to six workers each run their own cast loop at their assigned location and bait.
 * Rod upgrades are shared across the operation, the fish stall improves every sale,
 * and the player can fish personally with a short timing game. Everything runs
 * through advanceState(state, now) — DOM-free, timestamp-driven — so live play and
 * offline catch-up are the same code path.
 *
 * Determinism: every random consumer (each worker, the player, the contract board)
 * has its own persisted uint32 stream, and every worker persists fractional cast
 * progress, so the same starting state and actions resolve identically whether
 * elapsed time is processed in one batch or many small ones.
 */

import {
  BASE_RARITY_WEIGHTS,
  CONTRACT_REWARD_MULT,
  CONTRACT_TEMPLATES,
  DOCK_LEVELS,
  HIRE_COSTS,
  LOCATIONS,
  OFFLINE_CAP_MS,
  MIN_CAST_MS,
  PLAYER_CAST,
  PRESTIGE,
  RECENT_LIMIT,
  RARITY_ORDER,
  REEL_CONTROL_LEVELS,
  STALL_LEVELS,
  TRAINING_LEVELS,
  castDurationMs,
  coinsForCatch,
  getBait,
  getLocation,
  getRod,
  getSpecies,
  isTrophy,
  rollWeight,
  speciesByLocation,
  trophyThreshold,
} from './data.js';
import { createRngState, rngStep } from './rng.js';

export const EMPTY_COLLECTION_ENTRY = { catches: 0, bestWeight: 0, trophies: 0 };

export function createWorker(id) {
  return {
    id,
    name: `Worker ${id}`,
    locationId: 'loc_pond',
    baitId: 'bait_worms',
    rngState: createRngState((0x51ed + id * 7919) >>> 0),
    progressMs: 0,
    catches: 0,
  };
}

/** v2 state. (v1's single `fishing` flag is superseded; migration handles old saves.) */
export function createNewState(now, seed) {
  return {
    schemaVersion: 3,
    coins: 0,
    ownedRods: ['rod_bamboo'],
    ownedBaits: ['bait_worms'],
    unlockedLocations: ['loc_pond'],
    ownedWorkers: 1,
    dockLevel: 0,
    stallLevel: 0,
    trainingLevel: 0,
    reelControlLevel: 0,
    rodId: 'rod_bamboo',
    workers: [createWorker(1)],
    player: {
      locationId: 'loc_pond',
      baitId: 'bait_worms',
      rngState: createRngState((seed ^ 0x9e3779b9) >>> 0),
      casts: 0,
      catches: 0,
      coins: 0,
      bestWeight: 0,
      active: null,
    },
    contract: {
      rngState: createRngState((seed ^ 0xc0ffee) >>> 0),
      available: [],
      accepted: null,
      completed: 0,
      earnedCoins: 0,
    },
    prestige: {
      count: 0,
      runEarnings: 0, // this run's gross earnings; spending never reduces it
      lastPrestigeAt: 0, // timestamp of the last prestige (0 = never)
      homePondId: 'loc_pond',
    },
    paused: false,
    castCount: 0,
    lifetimeCatches: 0,
    lifetimeCoins: 0,
    playTimeMs: 0,
    collection: {},
    recent: [],
    recentCounter: 0,
    processedAt: Math.floor(now),
    lastSeenAt: Math.floor(now),
  };
}

export function collectionEntry(state, speciesId) {
  const entry = state.collection[speciesId];
  return entry ? entry : { ...EMPTY_COLLECTION_ENTRY };
}

export function discoveredCount(state) {
  return Object.keys(state.collection).filter((id) => state.collection[id].catches > 0).length;
}

export function discoveredCountFor(state, locationId) {
  return speciesByLocation(locationId).filter((s) => {
    const e = state.collection[s.id];
    return e && e.catches > 0;
  }).length;
}

/** The operation's shared rod + crew training — cast-time curve for everyone. */
export function currentCastDurationMs(state) {
  const base = castDurationMs(getRod(state.rodId), getBait('bait_worms'));
  const training = TRAINING_LEVELS[state.trainingLevel];
  const trained = training ? Math.round(base * training.mult) : base;
  return Math.max(MIN_CAST_MS, trained);
}

/** Worker cast time includes their bait's speed penalty plus crew training. */
export function workerCastDurationMs(state, worker) {
  const base = castDurationMs(getRod(state.rodId), getBait(worker.baitId));
  const training = TRAINING_LEVELS[state.trainingLevel];
  const trained = training ? Math.round(base * training.mult) : base;
  return Math.max(MIN_CAST_MS, trained);
}

export function dockCapacity(state) {
  const level = DOCK_LEVELS[state.dockLevel];
  return level ? level.capacity : 2;
}

export function dockName(state) {
  const level = DOCK_LEVELS[state.dockLevel];
  return level ? level.name : 'Old Jetty';
}

export function stallMultiplier(state) {
  const level = STALL_LEVELS[state.stallLevel];
  return level ? level.mult : 1;
}

export function stallName(state) {
  const level = STALL_LEVELS[state.stallLevel];
  return level ? level.name : 'Crate on a Barrel';
}

/** Permanent prestige multiplier: 1.00x, 1.25x, 1.50x, ... (additive, data-driven). */
export function earningsMultiplier(state) {
  const count = state.prestige ? state.prestige.count : 0;
  return 1 + PRESTIGE.multCoefficient * count;
}

/** Manual timing target half-width, widened by reel-control upgrades. */
export function reelHalfWidth(state) {
  const level = REEL_CONTROL_LEVELS[state.reelControlLevel];
  return level ? level.halfWidth : PLAYER_CAST.halfWidth;
}

export function trainingName(state) {
  const level = TRAINING_LEVELS[state.trainingLevel];
  return level ? level.name : 'Green Crew';
}

export function reelControlName(state) {
  const level = REEL_CONTROL_LEVELS[state.reelControlLevel];
  return level ? level.name : 'Bare Hands';
}

/** Sale value of a fish: stall cut, then the permanent prestige multiplier, once. */
export function stallValue(state, coins) {
  return Math.max(1, Math.round(coins * stallMultiplier(state) * earningsMultiplier(state)));
}

/** Track gross run earnings for prestige eligibility; spending never reduces it. */
function addRunEarnings(state, coins) {
  if (!state.prestige) state.prestige = { count: 0, runEarnings: 0, lastPrestigeAt: 0, homePondId: 'loc_pond' };
  state.prestige.runEarnings += coins;
}

/* ------------------------------------------------------------------ *
 * Catch recording                                                     *
 * ------------------------------------------------------------------ */

/**
 * Record a landed fish: collection, recent feed, lifetime totals, stall sale and
 * contract progress. `source` is 'worker' or 'player'.
 */
export function recordCatch(state, species, weight, coins, source, stampAt) {
  const entry = state.collection[species.id] || { ...EMPTY_COLLECTION_ENTRY };
  const isNewSpecies = entry.catches === 0;
  const isRecord = weight > entry.bestWeight;
  const trophy = isTrophy(species, weight);
  state.collection[species.id] = {
    catches: entry.catches + 1,
    bestWeight: isRecord ? weight : entry.bestWeight,
    trophies: entry.trophies + (trophy ? 1 : 0),
  };
  state.coins += coins;
  state.lifetimeCatches += 1;
  state.lifetimeCoins += coins;
  state.castCount += 1;

  state.recentCounter += 1;
  state.recent.unshift({
    id: state.recentCounter,
    speciesId: species.id,
    weight,
    coins,
    source,
    trophy,
    isNewSpecies,
    isRecord: isRecord && !isNewSpecies,
    at: stampAt,
  });
  if (state.recent.length > RECENT_LIMIT) state.recent.length = RECENT_LIMIT;

  const result = {
    speciesId: species.id,
    weight,
    coins,
    source,
    trophy,
    isNewSpecies,
    isRecord: isRecord && !isNewSpecies,
  };
  applyContractProgress(state, result);
  return result;
}

/* ------------------------------------------------------------------ *
 * Species rolls                                                       *
 * ------------------------------------------------------------------ */

/** Bait-modified, normalized species roll for a location. */
function rollSpeciesFrom(locationId, baitId, uniform) {
  const bait = getBait(baitId);
  const mult = (bait && bait.rarity) || null;
  const pool = speciesByLocation(locationId);
  const weights = pool.map((s) => (BASE_RARITY_WEIGHTS[s.rarity] || 0) * (mult ? (mult[s.rarity] || 0) : 1));
  let total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) total = 1;
  const u = uniform * total;
  let acc = 0;
  for (let i = 0; i < pool.length; i += 1) {
    acc += weights[i];
    if (u < acc) return pool[i];
  }
  return pool[pool.length - 1];
}

function workerDuration(state, worker) {
  return workerCastDurationMs(state, worker);
}

/** Resolve one worker cast: exactly two draws from the worker's own stream, fixed order. */
function resolveWorkerCatch(state, worker, stampAt) {
  const s1 = rngStep(worker.rngState);
  const s2 = rngStep(s1.state);
  worker.rngState = s2.state;

  const species = rollSpeciesFrom(worker.locationId, worker.baitId, s1.value);
  const bait = getBait(worker.baitId);
  const weight = rollWeight(species, s2.value, bait ? bait.sizeBias : 1);
  const rounded = Math.max(species.minWeight, Math.round(weight * 100) / 100);
  const coins = stallValue(state, coinsForCatch(species, rounded));

  worker.catches += 1;
  addRunEarnings(state, coins);
  return recordCatch(state, species, rounded, coins, 'worker', stampAt);
}

/* ------------------------------------------------------------------ *
 * advanceState                                                        *
 * ------------------------------------------------------------------ */

/**
 * Advance the whole business to `now`.
 * @returns summary: creditedMs, discardedMs, catches (workers), coins, contractCompletions.
 */
export function advanceState(state, now, options = {}) {
  const cap = Number.isFinite(options.offlineCapMs) ? options.offlineCapMs : OFFLINE_CAP_MS;
  const result = {
    creditedMs: 0,
    discardedMs: 0,
    catches: [],
    contractCompletions: [],
    coins: 0,
    clockAnomaly: false,
  };
  if (!Number.isFinite(now)) return result;

  const target = Math.floor(now);
  const rawDelta = target - state.processedAt;
  if (rawDelta < 0) {
    result.clockAnomaly = true;
    state.lastSeenAt = target;
    return result;
  }

  const credited = Math.min(rawDelta, cap);
  result.creditedMs = credited;
  result.discardedMs = rawDelta - credited;

  if (credited > 0 && !state.paused) {
    state.playTimeMs += credited;

    for (const worker of state.workers) {
      const duration = workerDuration(state, worker);
      const startProgress = worker.progressMs;
      let budget = startProgress + credited;
      let guard = 0;
      const maxCatches = Math.min(100000, Math.ceil(budget / Math.max(1, duration)) + 2);
      let k = 0;
      while (budget >= duration && guard < maxCatches) {
        budget -= duration;
        // Time from the batch start to this catch — keeps the feed stable
        // across batch sizes without influencing any reward.
        const offset = Math.min(credited, Math.max(0, duration - startProgress + k * duration));
        result.catches.push(resolveWorkerCatch(state, worker, state.processedAt + offset));
        k += 1;
        guard += 1;
      }
      worker.progressMs = Math.max(0, budget);
    }
  }

  // Watermark always advances (capped) so over-cap time is discarded exactly once.
  if (target > state.processedAt) state.processedAt = target;
  state.lastSeenAt = target;
  result.coins = result.catches.reduce((a, r) => a + r.coins, 0);
  for (const r of result.catches) {
    if (r.contractComplete) result.contractCompletions.push(r.contractComplete);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Business investments (one-time costs, all competing for the same coins)
 * ------------------------------------------------------------------ */

function funds(state, cost) {
  if (state.coins < cost) return { ok: false, reason: 'insufficient_coins', missing: cost - state.coins };
  return { ok: true };
}

export function hireCost(state) {
  return HIRE_COSTS[Math.min(state.ownedWorkers + 1, HIRE_COSTS.length - 1)];
}

export function hireWorker(state, now) {
  if (state.ownedWorkers >= dockCapacity(state)) return { ok: false, reason: 'dock_full' };
  if (state.ownedWorkers >= 6) return { ok: false, reason: 'at_limit' };
  const cost = hireCost(state);
  const check = funds(state, cost);
  if (!check.ok) return { ...check, cost };
  const settle = advanceState(state, now); // settle before the new worker exists
  state.coins -= cost;
  state.ownedWorkers += 1;
  const worker = createWorker(state.ownedWorkers);
  worker.locationId = 'loc_pond';
  state.workers.push(worker);
  return { ok: true, cost, worker, settle };
}

export function nextDockLevel(state) {
  return DOCK_LEVELS[state.dockLevel + 1] || null;
}

export function expandDock(state, now) {
  const next = nextDockLevel(state);
  if (!next) return { ok: false, reason: 'maxed' };
  const check = funds(state, next.cost);
  if (!check.ok) return { ...check, cost: next.cost };
  const settle = advanceState(state, now);
  state.dockLevel += 1;
  state.coins -= next.cost;
  return { ok: true, cost: next.cost, level: next, settle };
}

export function nextStallLevel(state) {
  return STALL_LEVELS[state.stallLevel + 1] || null;
}

export function upgradeStall(state, now) {
  const next = nextStallLevel(state);
  if (!next) return { ok: false, reason: 'maxed' };
  const check = funds(state, next.cost);
  if (!check.ok) return { ...check, cost: next.cost };
  const settle = advanceState(state, now);
  state.stallLevel += 1;
  state.coins -= next.cost;
  return { ok: true, cost: next.cost, level: next, settle };
}

/** Shared rod upgrade: every worker and the player cast faster from now on. */
export function upgradeRod(state, now, rodId) {
  const rod = getRod(rodId);
  if (!rod) return { ok: false, reason: 'unknown_item' };
  if (state.ownedRods.includes(rodId)) return { ok: false, reason: 'already_owned' };
  const check = funds(state, rod.cost);
  if (!check.ok) return { ...check, cost: rod.cost };
  const settle = advanceState(state, now);
  state.ownedRods.push(rodId);
  state.rodId = rodId;
  return { ok: true, cost: rod.cost, rod, settle };
}

/** Unlock a new bait (usable by the player and assignable to workers). */
export function purchaseBait(state, now, baitId) {
  const bait = getBait(baitId);
  if (!bait) return { ok: false, reason: 'unknown_item' };
  if (state.ownedBaits.includes(baitId)) return { ok: false, reason: 'already_owned' };
  const check = funds(state, bait.cost);
  if (!check.ok) return { ...check, cost: bait.cost };
  const settle = advanceState(state, now);
  state.ownedBaits.push(baitId);
  state.coins -= bait.cost;
  return { ok: true, cost: bait.cost, settle };
}

/** Unlock a location (then assign workers or visit personally). */
export function purchaseLocation(state, now, locationId) {
  const location = getLocation(locationId);
  if (!location) return { ok: false, reason: 'unknown_item' };
  if (state.unlockedLocations.includes(locationId)) return { ok: false, reason: 'already_owned' };
  const check = funds(state, location.cost);
  if (!check.ok) return { ...check, cost: location.cost };
  const settle = advanceState(state, now);
  state.unlockedLocations.push(locationId);
  return { ok: true, cost: location.cost, settle };
}

/** Upgrade crew training (faster automatic casts for the rest of the run). */
export function nextTrainingLevel(state) {
  return TRAINING_LEVELS[state.trainingLevel + 1] || null;
}

export function upgradeTraining(state, now) {
  const next = nextTrainingLevel(state);
  if (!next) return { ok: false, reason: 'maxed' };
  const check = funds(state, next.cost);
  if (!check.ok) return { ...check, cost: next.cost };
  const settle = advanceState(state, now);
  state.trainingLevel += 1;
  state.coins -= next.cost;
  return { ok: true, cost: next.cost, level: next, settle };
}

/** Upgrade reel control (wider manual timing target for the rest of the run). */
export function nextReelControlLevel(state) {
  return REEL_CONTROL_LEVELS[state.reelControlLevel + 1] || null;
}

export function upgradeReelControl(state, now) {
  const next = nextReelControlLevel(state);
  if (!next) return { ok: false, reason: 'maxed' };
  const check = funds(state, next.cost);
  if (!check.ok) return { ...check, cost: next.cost };
  const settle = advanceState(state, now);
  state.reelControlLevel += 1;
  state.coins -= next.cost;
  return { ok: true, cost: next.cost, level: next, settle };
}

/** Purchase a bait unlock; availability gated by prestige tier (access is permanent). */
export function baitAvailable(state, baitId) {
  const bait = getBait(baitId);
  if (!bait) return false;
  const needed = bait.prestige || 0;
  return (state.prestige ? state.prestige.count : 0) >= needed;
}

/* ------------------------------------------------------------------ *
 * Worker assignment                                                   *
 * ------------------------------------------------------------------ */

/** Change a worker's location and/or bait. Settles first; fresh cast afterwards. */
export function assignWorker(state, now, workerId, patch = {}) {
  const worker = state.workers.find((w) => w.id === workerId);
  if (!worker) return { ok: false, reason: 'no_worker' };
  let settled = false;
  const settleOnce = () => {
    if (!settled) advanceState(state, now);
    settled = true;
  };
  let changed = false;

  if (patch.locationId && patch.locationId !== worker.locationId) {
    if (!state.unlockedLocations.includes(patch.locationId)) return { ok: false, reason: 'locked' };
    settleOnce();
    worker.locationId = patch.locationId;
    worker.progressMs = 0; // new water, fresh cast
    changed = true;
  }
  if (patch.baitId && patch.baitId !== worker.baitId) {
    if (!state.ownedBaits.includes(patch.baitId)) return { ok: false, reason: 'not_owned' };
    settleOnce();
    worker.baitId = patch.baitId;
    worker.progressMs = 0;
    changed = true;
  }
  return { ok: true, changed };
}

/**
 * Estimated coins per hour for one worker. An estimate from the location's bait-weighted
 * distribution at average fish size — actual results vary with luck.
 */
export function workerEstimate(state, worker) {
  const duration = workerDuration(state, worker);
  const bait = getBait(worker.baitId);
  const mult = (bait && bait.rarity) || null;
  const pool = speciesByLocation(worker.locationId);
  const weights = pool.map((s) => (BASE_RARITY_WEIGHTS[s.rarity] || 0) * (mult ? (mult[s.rarity] || 0) : 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let expected = 0;
  for (let i = 0; i < pool.length; i += 1) {
    const species = pool[i];
    const mid = (species.minWeight + species.maxWeight) / 2;
    expected += (weights[i] / total) * coinsForCatch(species, mid);
  }
  const perCast = stallValue(state, expected);
  return {
    perCatch: perCast,
    perHour: Math.round(perCast * (3_600_000 / duration)),
  };
}

/* ------------------------------------------------------------------ *
 * Player fishing                                                      *
 * ------------------------------------------------------------------ */

/**
 * Start a player cast. Draws exactly twice from the player's own stream (species,
 * size), so starting or canceling minigames can never disturb worker catches.
 */
export function startPlayerCast(state, now) {
  if (state.player.active) return { ok: false, reason: 'already_casting' };
  const s1 = rngStep(state.player.rngState);
  const s2 = rngStep(s1.state);
  state.player.rngState = s2.state;
  const species = rollSpeciesFrom(state.player.locationId, state.player.baitId, s1.value);
  const bait = getBait(state.player.baitId);
  const sizeRoll = rollWeight(species, s2.value, bait ? bait.sizeBias : 1);
  state.player.active = {
    speciesId: species.id,
    sizeRoll,
    stages: PLAYER_CAST.stages,
    stage: 0,
    inputs: [],
    stageStart: now,
    startedAt: now,
  };
  return { ok: true };
}

/** The visible target zone for a reel stage (fractions of the marker track). */
export function stageTargetWindow(state) {
  const level = state && REEL_CONTROL_LEVELS[state.reelControlLevel];
  return { center: PLAYER_CAST.center, halfWidth: level ? level.halfWidth : PLAYER_CAST.halfWidth };
}

/**
 * Submit one timing input. `quality` 0..1 from where the marker was when the input
 * arrived (1 = dead centre). A stage scores at most once, so held keys, key repeat
 * and double clicks cannot submit extra inputs.
 */
export function submitPlayerInput(state, now, quality) {
  const game = state.player.active;
  if (!game) return { ok: false, reason: 'not_casting' };
  if (game.stage >= game.stages) return { ok: false, reason: 'complete' };
  const q = Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 0));
  game.inputs.push(q);
  game.stage += 1;
  game.stageStart = now;
  return { ok: true, complete: game.stage >= game.stages, quality: q };
}

/**
 * Resolve a finished player cast exactly once — and only if a cast is active.
 * `auto` (missed taps or the accessible route) awards a modest fixed quality;
 * nothing is ever lost.
 */
export function settlePlayerCast(state, now, auto = false) {
  const game = state.player.active;
  if (!game) return { ok: false, reason: 'not_casting' };
  const qualities = game.inputs.slice();
  while (qualities.length < game.stages) qualities.push(PLAYER_CAST.idleQuality);
  const q = auto
    ? PLAYER_CAST.idleQuality
    : qualities.reduce((a, b) => a + b, 0) / qualities.length;

  const species = getSpecies(game.speciesId);
  const bait = getBait(state.player.baitId);
  const base = rollWeight(species, game.sizeRoll, bait ? bait.sizeBias : 1);
  const weight = Math.max(species.minWeight, Math.round(base * PLAYER_CAST.sizeBonus(q) * 100) / 100);
  // Cap the player catch at a few worker-average catches *at the water being fished*,
  // so hands-on play stays meaningful on every pond without overshadowing the crew.
  const workerAverage = expectedWorkerPerCast(state, state.player.locationId, 'bait_worms');
  const cap = Math.max(1, Math.round(workerAverage * PLAYER_CAST.valueCapWorkerCasts));
  const coins = Math.min(cap, stallValue(state, Math.round(coinsForCatch(species, weight) * PLAYER_CAST.valueBonus(q))));

  state.player.active = null;
  state.player.casts += 1;
  state.player.catches += 1;
  state.player.coins += coins;
  state.player.bestWeight = Math.max(state.player.bestWeight, weight);
  addRunEarnings(state, coins);

  const result = recordCatch(state, species, weight, coins, 'player', Math.floor(now));
  return { ok: true, quality: q, ...result };
}

/** Cancel an in-progress cast with no penalty and no invented catch. */
export function cancelPlayerCast(state) {
  if (!state.player.active) return { ok: false, reason: 'not_casting' };
  state.player.active = null;
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Contracts                                                           *
 * ------------------------------------------------------------------ */

/** Estimated stall value of an average catch at a location under a given bait. */
function expectedWorkerPerCast(state, locationId, baitId) {
  const pool = speciesByLocation(locationId);
  const bait = getBait(baitId);
  const mult = (bait && bait.rarity) || null;
  const weights = pool.map((s) => (BASE_RARITY_WEIGHTS[s.rarity] || 0) * (mult ? (mult[s.rarity] || 0) : 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let expected = 0;
  for (let i = 0; i < pool.length; i += 1) {
    const species = pool[i];
    const mid = (species.minWeight + species.maxWeight) / 2;
    expected += (weights[i] / total) * coinsForCatch(species, mid);
  }
  return stallValue(state, expected);
}

/** Estimated stall value of an average catch at a location (Worms distribution). */
function expectedPerCatch(state, locationId) {
  return expectedWorkerPerCast(state, locationId, 'bait_worms');
}

function makeOffer(state) {
  const stream = state.contract;
  const draw = () => {
    const s = rngStep(stream.rngState);
    stream.rngState = s.state;
    return s.value;
  };
  const kindRoll = draw();
  const locRoll = draw();
  const paramRoll = draw();

  const template = CONTRACT_TEMPLATES[Math.floor(kindRoll * CONTRACT_TEMPLATES.length) % CONTRACT_TEMPLATES.length];
  const locations = state.unlockedLocations;
  const locationId = locations[Math.floor(locRoll * locations.length) % locations.length];
  const pool = speciesByLocation(locationId);
  const easy = pool.filter((s) => s.rarity === 'common' || s.rarity === 'uncommon');

  if (template.kind === 'qty') {
    const qty = 6 + Math.floor(paramRoll * 9); // 6..14
    return {
      id: `qty-${locationId}-${qty}-${Math.floor(paramRoll * 997)}`,
      templateId: template.id,
      kind: 'qty',
      locationId,
      qty,
      reward: Math.max(60, Math.round(expectedPerCatch(state, locationId) * qty * 2)),
    };
  }
  if (template.kind === 'size') {
    const target = easy[Math.floor(paramRoll * easy.length) % easy.length] || pool[0];
    const threshold = Math.round(trophyThreshold(target) * 0.5 * 100) / 100;
    return {
      id: `size-${locationId}-${target.id}`,
      templateId: template.id,
      kind: 'size',
      locationId,
      speciesId: target.id,
      threshold,
      qty: 3,
      reward: Math.max(80, Math.round(expectedPerCatch(state, locationId) * 3 * 2.4)),
    };
  }
  // rarity: keep early game achievable — common-tier orders stay away, the two
  // offered tiers are Uncommon (plentiful) and Rare-or-better (a real push).
  if (paramRoll < 0.55) {
    return {
      id: `rarity-uncommon-${locationId}`,
      templateId: template.id,
      kind: 'rarity',
      rarity: 'uncommon',
      locationId: null,
      qty: 8,
      reward: Math.max(90, Math.round(expectedPerCatch(state, locationId) * 8 * 1.6)),
    };
  }
  return {
    id: `rarity-rare-${locationId}`,
    templateId: template.id,
    kind: 'rarity',
    rarity: 'rare',
    locationId: null,
    qty: 2,
    reward: Math.max(140, Math.round(expectedPerCatch(state, locationId) * 2 * 3.2)),
  };
}

/**
 * Fill the board with three offers from unlocked content only. Refuses while a
 * contract is accepted; never runs during offline catch-up.
 */
export function generateContracts(state, now) {
  if (state.contract.accepted) return { ok: false, reason: 'one_at_a_time' };
  const settle = advanceState(state, now);
  state.contract.available = [makeOffer(state), makeOffer(state), makeOffer(state)];
  return { ok: true, offers: state.contract.available, settle };
}

/** Accept an offer. Only catches made after this moment count toward it. */
export function acceptContract(state, now, offerId) {
  const offer = state.contract.available.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: 'no_offer' };
  if (state.contract.accepted) return { ok: false, reason: 'one_at_a_time' };
  const settle = advanceState(state, now);
  state.contract.accepted = { ...offer, count: 0 };
  state.contract.available = [];
  return { ok: true, contract: state.contract.accepted, settle };
}

/** Abandon without penalty; the board can be refilled. */
export function abandonContract(state, now) {
  if (!state.contract.accepted) return { ok: false, reason: 'none' };
  const settle = advanceState(state, now);
  state.contract.accepted = null;
  return { ok: true, settle };
}

function rarityAtLeast(actual, required) {
  return RARITY_ORDER.indexOf(actual) >= RARITY_ORDER.indexOf(required);
}

/** Feed one catch into the accepted contract; pays the bonus exactly once. */
function applyContractProgress(state, result) {
  const c = state.contract.accepted;
  if (!c) return;
  const species = getSpecies(result.speciesId);
  let hit = false;
  if (c.kind === 'qty' && species.locationId === c.locationId) hit = true;
  if (c.kind === 'size' && result.speciesId === c.speciesId && result.weight >= c.threshold) hit = true;
  if (c.kind === 'rarity' && rarityAtLeast(species.rarity, c.rarity)) hit = true;
  if (!hit) return;
  c.count += 1;
  if (c.count >= c.qty) {
    const bonus = stallValue(state, c.reward); // prestige/stall applied once, here
    state.contract.accepted = null;
    state.contract.completed += 1;
    state.contract.earnedCoins += bonus;
    state.coins += bonus;
    addRunEarnings(state, bonus);
    result.contractComplete = { reward: bonus, templateId: c.templateId };
  }
}

/* ------------------------------------------------------------------ *
 * Prestige: move the business to a new pond                           *
 * ------------------------------------------------------------------ */

/** Run earnings needed at the current prestige count. */
export function prestigeThreshold(state) {
  const count = state.prestige ? state.prestige.count : 0;
  return PRESTIGE.baseThreshold + PRESTIGE.thresholdGrowth * count;
}

/** Ponds that unlock at a given prestige count (beyond the always-available ones). */
export function pondsUnlockingAt(count) {
  return LOCATIONS.filter((l) => l.prestige === count);
}

/** The pond(s) the player may settle after the next prestige. */
export function prestigeDestination(state) {
  const nextCount = (state.prestige ? state.prestige.count : 0) + 1;
  const unlocking = pondsUnlockingAt(nextCount);
  if (unlocking.length) {
    return { kind: 'new_pond', locationId: unlocking[0].id, location: unlocking[0] };
  }
  // All ponds unlocked: settle on any already-unlocked water. The reward is the
  // next multiplier, not a nonexistent pond.
  const home = state.prestige?.homePondId || 'loc_pond';
  return { kind: 'same_pond', locationId: home, location: getLocation(home) };
}

/** Eligibility against the current authoritative state (never cached). */
export function prestigeEligibility(state) {
  const threshold = prestigeThreshold(state);
  const earnings = state.prestige ? state.prestige.runEarnings : 0;
  const workers = state.ownedWorkers;
  return {
    eligible: earnings >= threshold && workers >= PRESTIGE.minWorkers,
    earnings,
    threshold,
    earningsMet: earnings >= threshold,
    workers,
    workersNeeded: PRESTIGE.minWorkers,
    workersMet: workers >= PRESTIGE.minWorkers,
    multiplier: earningsMultiplier(state),
    nextMultiplier: 1 + PRESTIGE.multCoefficient * ((state.prestige ? state.prestige.count : 0) + 1),
    destination: prestigeDestination(state),
  };
}

/**
 * Perform the prestige transition as one atomic step. Rechecks eligibility,
 * settles old-run time under OLD bonuses (settle happens in the caller before
 * this runs), increments the counter, unlocks the new pond, and restarts the
 * operating business at the destination.
 * @returns {{ ok: boolean, reason?: string, state: object, unlocked?: object }}
 */
export function performPrestige(state, now) {
  const eligibility = prestigeEligibility(state);
  if (!eligibility.eligible) return { ok: false, reason: 'not_eligible', eligibility };

  const previous = state.prestige;
  const newCount = previous.count + 1;
  const destination = eligibility.destination;

  // --- preserved across prestige
  const preserved = {
    collection: state.collection,
    recent: state.recent,
    recentCounter: state.recentCounter,
    lifetimeCatches: state.lifetimeCatches,
    lifetimeCoins: state.lifetimeCoins,
    playTimeMs: state.playTimeMs,
    castCount: state.castCount,
    unlockedLocations: state.unlockedLocations.slice(),
    ownedRods: ['rod_bamboo'], // tiers stay accessible; equipment is bought again
    ownedBaits: ['bait_worms'],
    paused: state.paused, // preserve whether the player had globally paused
    player: {
      ...state.player,
      active: null, // any unfinished hand cast is voided without penalty
    },
  };

  // --- the reset business
  const fresh = createNewState(now, previous.count * 7919 + 13);
  fresh.schemaVersion = state.schemaVersion;
  fresh.coins = 0;
  fresh.ownedWorkers = 1;
  fresh.workers = [createWorker(1)];
  fresh.dockLevel = 0;
  fresh.stallLevel = 0;
  fresh.trainingLevel = 0;
  fresh.reelControlLevel = 0;
  fresh.rodId = 'rod_bamboo';
  fresh.paused = preserved.paused;
  fresh.collection = preserved.collection;
  fresh.recent = preserved.recent;
  fresh.recentCounter = preserved.recentCounter;
  fresh.lifetimeCatches = preserved.lifetimeCatches;
  fresh.lifetimeCoins = preserved.lifetimeCoins;
  fresh.playTimeMs = preserved.playTimeMs;
  fresh.castCount = preserved.castCount;
  fresh.unlockedLocations = preserved.unlockedLocations;
  fresh.player = { ...preserved.player, locationId: destination.locationId, rngState: state.player.rngState };
  // The free worker starts at the new home pond with the viable free setup.
  fresh.workers[0].locationId = destination.locationId;
  fresh.workers[0].baitId = 'bait_worms';
  fresh.workers[0].progressMs = 0;
  fresh.processedAt = Math.floor(now);
  fresh.lastSeenAt = Math.floor(now);

  // --- prestige bookkeeping
  fresh.prestige = {
    count: newCount,
    runEarnings: 0, // the new run starts from zero; old-run data must not qualify it
    lastPrestigeAt: Math.floor(now),
    homePondId: destination.locationId,
  };

  // --- unlock the destination pond (plus any others at this count)
  const unlockedNow = [];
  for (const location of pondsUnlockingAt(newCount)) {
    if (!fresh.unlockedLocations.includes(location.id)) {
      fresh.unlockedLocations.push(location.id);
      unlockedNow.push(location);
    }
  }

  // Replace the caller's state in place (single object identity, atomic swap of fields).
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, fresh);

  return { ok: true, count: newCount, destination, unlockedNow, state };
}

/* ------------------------------------------------------------------ *
 * Pause                                                               *
 * ------------------------------------------------------------------ */

/**
 * Global pause: worker loops stop, an in-progress player cast is canceled without
 * penalty, and the watermark keeps advancing so nothing is earned retroactively.
 * Contract offers and progress are untouched.
 */
export function setPaused(state, now, on) {
  if (on) cancelPlayerCast(state);
  state.paused = Boolean(on);
  return { ok: true, paused: state.paused };
}

export function trophyTotal(state) {
  return Object.values(state.collection).reduce((s, e) => s + (e.trophies || 0), 0);
}

/** Loose ownership check kept for UI helpers. */
export function ownsItem(state, itemId) {
  return state.ownedRods.includes(itemId)
    || state.ownedBaits.includes(itemId)
    || state.unlockedLocations.includes(itemId);
}
