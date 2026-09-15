/**
 * Gone Fishing — simulation engine.
 *
 * Pure and DOM-free: everything runs through advanceState(state, now), which uses
 * timestamps only. Live play and offline catch-up share this one code path, so a
 * batch of elapsed time and many smaller batches produce identical results given
 * the same starting state.
 *
 * Time model:
 *   state.processedAt  — high-water mark of simulated time (never moves backward)
 *   state.castProgressMs — fractional progress into the current cast, preserved across saves
 *   paused/not fishing — the watermark advances but nothing is awarded and progress freezes
 */

import {
  BASE_RARITY_WEIGHTS,
  BAITS,
  DEFAULT_SETUP,
  OFFLINE_CAP_MS,
  RARITY_ORDER,
  RECENT_LIMIT,
  RODS,
  SCHEMA_VERSION,
  STARTING_COINS,
  castDurationMs,
  coinsForCatch,
  getBait,
  getLocation,
  getRod,
  isTrophy,
  rollWeight,
  speciesByLocation,
} from './data.js';
import { createRngState, rngStep } from './rng.js';

export const EMPTY_COLLECTION_ENTRY = { catches: 0, bestWeight: 0, trophies: 0 };

export function createNewState(now, seed) {
  return {
    schemaVersion: SCHEMA_VERSION,
    coins: STARTING_COINS,
    ownedRods: [DEFAULT_SETUP.rodId],
    ownedBaits: [DEFAULT_SETUP.baitId],
    unlockedLocations: [DEFAULT_SETUP.locationId],
    locationId: DEFAULT_SETUP.locationId,
    rodId: DEFAULT_SETUP.rodId,
    baitId: DEFAULT_SETUP.baitId,
    fishing: false,
    castProgressMs: 0,
    castCount: 0,
    lifetimeCatches: 0,
    lifetimeCoins: 0,
    playTimeMs: 0,
    collection: {},
    recent: [],
    recentCounter: 0,
    rngState: createRngState(seed),
    processedAt: Math.floor(now),
    lastSeenAt: Math.floor(now),
  };
}

export function collectionEntry(state, speciesId) {
  const entry = state.collection[speciesId];
  if (!entry) return { ...EMPTY_COLLECTION_ENTRY };
  return entry;
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

export function currentCastDurationMs(state) {
  return castDurationMs(getRod(state.rodId), getBait(state.baitId));
}

/** Pick a species id from a location using the bait-modified distribution. */
function rollSpecies(state, rng) {
  const bait = getBait(state.baitId);
  const mult = (bait && bait.rarity) || null;
  const pool = speciesByLocation(state.locationId);
  const weights = pool.map((s) => (BASE_RARITY_WEIGHTS[s.rarity] || 0) * (mult ? (mult[s.rarity] || 0) : 1));
  let total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) total = 1;
  const u = rng.value * total;
  let acc = 0;
  for (let i = 0; i < pool.length; i += 1) {
    acc += weights[i];
    if (u < acc) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Resolve exactly one catch under the CURRENT setup.
 * Consumes exactly two random draws (species, size) so draw ordering is stable.
 */
function resolveOneCatch(state, rngRef) {
  const bait = getBait(state.baitId);

  const speciesDraw = rngStep(rngRef.value);
  rngRef.value = speciesDraw.state;
  const species = rollSpecies(state, { value: speciesDraw.value });

  const sizeDraw = rngStep(rngRef.value);
  rngRef.value = sizeDraw.state;
  const weight = rollWeight(species, sizeDraw.value, bait ? bait.sizeBias : 1);

  const roundWeight = Math.max(species.minWeight, Math.round(weight * 100) / 100);
  const coins = coinsForCatch(species, roundWeight);
  const trophy = isTrophy(species, roundWeight);

  const entry = state.collection[species.id] || { ...EMPTY_COLLECTION_ENTRY };
  const isNewSpecies = entry.catches === 0;
  const isRecord = roundWeight > entry.bestWeight;
  state.collection[species.id] = {
    catches: entry.catches + 1,
    bestWeight: isRecord ? roundWeight : entry.bestWeight,
    trophies: entry.trophies + (trophy ? 1 : 0),
  };

  state.coins += coins;
  state.lifetimeCatches += 1;
  state.lifetimeCoins += coins;
  state.castCount += 1;

  state.recentCounter += 1;
  const record = {
    id: state.recentCounter,
    speciesId: species.id,
    weight: roundWeight,
    coins,
    trophy,
    isNewSpecies,
    isRecord: isRecord && !isNewSpecies,
    at: state.processedAt,
  };
  state.recent.unshift(record);
  if (state.recent.length > RECENT_LIMIT) state.recent.length = RECENT_LIMIT;

  return record;
}

/**
 * Advance the world to `now`.
 * @returns a summary of what happened; state is mutated in place.
 */
export function advanceState(state, now, options = {}) {
  const cap = Number.isFinite(options.offlineCapMs) ? options.offlineCapMs : OFFLINE_CAP_MS;
  const target = Math.floor(now);
  const result = {
    creditedMs: 0,
    discardedMs: 0,
    catches: [],
    coins: 0,
    newSpecies: [],
    records: [],
    trophies: 0,
    clockAnomaly: false,
    processedAt: state.processedAt,
  };
  if (!Number.isFinite(now)) return result;

  const rawDelta = target - state.processedAt;
  if (rawDelta < 0) {
    // Clock moved backward: award nothing and never move the watermark backward.
    result.clockAnomaly = true;
    state.lastSeenAt = target;
    return result;
  }

  const credited = state.fishing ? Math.min(rawDelta, cap) : 0;
  result.discardedMs = state.fishing ? rawDelta - credited : 0;
  result.creditedMs = credited;

  if (state.fishing && credited > 0) {
    const duration = currentCastDurationMs(state);
    let budget = state.castProgressMs + credited;
    state.playTimeMs += credited;
    const rngRef = { value: state.rngState };
    let guard = 0;
    const maxCatches = Math.min(200000, Math.ceil(budget / Math.max(1, duration)) + 2);
    while (budget >= duration && guard < maxCatches) {
      budget -= duration;
      const record = resolveOneCatchStamped(state, rngRef, target);
      result.catches.push(record);
      result.coins += record.coins;
      if (record.isNewSpecies) result.newSpecies.push(record.speciesId);
      if (record.isRecord) result.records.push({ speciesId: record.speciesId, weight: record.weight });
      if (record.trophy) result.trophies += 1;
      guard += 1;
    }
    state.rngState = rngRef.value;
    state.castProgressMs = Math.max(0, budget);
  }

  // Watermark: always move forward by the full elapsed time, capped or not, so time
  // beyond the offline cap is discarded consistently and never replayed.
  if (target > state.processedAt) state.processedAt = target;
  state.lastSeenAt = target;
  result.processedAt = state.processedAt;
  return result;
}

/** resolveOneCatch, with the catch stamped at the batch end time. */
function resolveOneCatchStamped(state, rngRef, stampAt) {
  const savedProcessedAt = state.processedAt;
  state.processedAt = stampAt;
  const record = resolveOneCatch(state, rngRef);
  state.processedAt = savedProcessedAt;
  return record;
}

/** Turn fishing on/off. Settles first, then freezes or resumes the cast clock. */
export function setFishing(state, now, on) {
  const summary = advanceState(state, now);
  state.fishing = Boolean(on);
  return summary;
}

/**
 * Apply a setup change (location / bait / rod). Already-earned catches are settled
 * under the OLD setup first; the new setup only affects casts started after this call.
 */
export function changeSetup(state, now, patch = {}) {
  const summary = advanceState(state, now);
  if (patch.locationId && state.unlockedLocations.includes(patch.locationId)) {
    state.locationId = patch.locationId;
  }
  if (patch.rodId && state.ownedRods.includes(patch.rodId)) state.rodId = patch.rodId;
  if (patch.baitId && state.ownedBaits.includes(patch.baitId)) state.baitId = patch.baitId;
  return { settle: summary, castProgressMs: state.castProgressMs };
}

export function findItem(itemId) {
  return (
    getRod(itemId) || getBait(itemId) || getLocation(itemId) || null
  );
}

function itemKind(itemId) {
  if (getRod(itemId)) return 'rod';
  if (getBait(itemId)) return 'bait';
  if (getLocation(itemId)) return 'location';
  return null;
}

export function ownsItem(state, itemId) {
  const kind = itemKind(itemId);
  if (kind === 'rod') return state.ownedRods.includes(itemId);
  if (kind === 'bait') return state.ownedBaits.includes(itemId);
  if (kind === 'location') return state.unlockedLocations.includes(itemId);
  return false;
}

/**
 * Buy a rod, bait unlock, or location.
 * Settles elapsed time first; never allows negative coins or double purchases.
 */
export function purchase(state, now, itemId) {
  const item = findItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  if (ownsItem(state, itemId)) return { ok: false, reason: 'already_owned' };
  const settle = advanceState(state, now);
  if (state.coins < item.cost) {
    return { ok: false, reason: 'insufficient_coins', missing: item.cost - state.coins, settle };
  }
  const kind = itemKind(itemId);
  state.coins -= item.cost;
  if (kind === 'rod') {
    state.ownedRods.push(itemId);
    state.rodId = itemId; // gear is equipped on purchase; idle games should not hide a second step
  }
  if (kind === 'bait') {
    state.ownedBaits.push(itemId);
    state.baitId = itemId;
  }
  if (kind === 'location') state.unlockedLocations.push(itemId);
  return { ok: true, kind, item, paid: item.cost, settle };
}

/** Unlock a location and switch to it if the purchase succeeds. */
export function purchaseAndVisit(state, now, locationId) {
  const result = purchase(state, now, locationId);
  if (result.ok) {
    state.locationId = locationId;
    // A location change starts a fresh cast under the new water.
    state.castProgressMs = 0;
  }
  return result;
}

export function selectBait(state, now, baitId) {
  if (!state.ownedBaits.includes(baitId)) return { ok: false, reason: 'not_owned' };
  if (state.baitId === baitId) return { ok: false, reason: 'already_selected' };
  changeSetup(state, now, { baitId });
  return { ok: true };
}

export function selectRod(state, now, rodId) {
  if (!state.ownedRods.includes(rodId)) return { ok: false, reason: 'not_owned' };
  if (state.rodId === rodId) return { ok: false, reason: 'already_selected' };
  changeSetup(state, now, { rodId });
  return { ok: true };
}

export function selectLocation(state, now, locationId) {
  if (!state.unlockedLocations.includes(locationId)) return { ok: false, reason: 'locked' };
  if (state.locationId === locationId) return { ok: false, reason: 'already_selected' };
  changeSetup(state, now, { locationId });
  // Moving water means a fresh cast, so old progress does not carry across locations.
  state.castProgressMs = 0;
  return { ok: true };
}

export function trophyTotal(state) {
  return Object.values(state.collection).reduce((sum, e) => sum + (e.trophies || 0), 0);
}

export function nextUpgrade(state) {
  const unowned = [...RODS, ...BAITS]
    .filter((item) => !ownsItem(state, item.id))
    .sort((a, b) => a.cost - b.cost);
  return unowned[0] || null;
}

/** Rarity order helper used by the collection UI. */
export function rarityRank(rarity) {
  return RARITY_ORDER.indexOf(rarity);
}