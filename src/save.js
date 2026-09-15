/**
 * Gone Fishing — persistence: serialization, validation, schema migration, storage.
 *
 * Fail-closed: an import or load that fails validation leaves the live state untouched.
 * v1 saves are migrated to v2 (the dock business). Migration is idempotent — importing
 * an already-migrated save changes nothing — and writes a backup of the original save
 * before replacing it.
 */

import {
  DOCK_LEVELS,
  HIRE_COSTS,
  PLAYER_CAST,
  RECENT_LIMIT,
  SCHEMA_VERSION,
  SPECIES,
  STALL_LEVELS,
  getLocation,
} from './data.js';
import { isValidRngState } from './rng.js';
import { createNewState, createWorker } from './engine.js';

export const SCHEMA_VERSION_V1 = 1;
export const SCHEMA_VERSION_V2 = 2;
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_V2;
export { SCHEMA_VERSION };

export const SAVE_KEY = 'gone-fishing.save.v1';
export const BACKUP_KEY_PREFIX = 'gone-fishing.backup.';
export const CORRUPT_KEY_PREFIX = 'gone-fishing.corrupt.';
export const LOCK_KEY = 'gone-fishing.writer';

const SPECIES_IDS = new Set(SPECIES.map((s) => s.id));
const ROD_IDS = new Set(['rod_bamboo', 'rod_fiberglass', 'rod_carbon', 'rod_pro']);
const BAIT_IDS = new Set(['bait_worms', 'bait_minnows', 'bait_glow']);
const LOCATION_IDS = new Set(['loc_pond', 'loc_river', 'loc_lake']);

const FINITE = (v) => typeof v === 'number' && Number.isFinite(v);
const NON_NEG = (v) => FINITE(v) && v >= 0;
const INT = (v) => Number.isInteger(v);
const NON_NEG_INT = (v) => INT(v) && v >= 0;
const UINT32 = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

/* ------------------------------------------------------------------ *
 * v1 validation (subset — enough to migrate safely)                   *
 * ------------------------------------------------------------------ */

/** @returns {{ ok: boolean, errors: string[], value?: object }} the v1 state object */
export function validateV1(input) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Save is not an object.'] };
  }
  if (input.schemaVersion !== 1) return { ok: false, errors: ['Not a v1 save.'] };

  if (!NON_NEG_INT(input.coins)) fail('coins must be a non-negative integer.');
  if (!NON_NEG_INT(input.lifetimeCatches)) fail('lifetimeCatches must be a non-negative integer.');
  if (!NON_NEG_INT(input.lifetimeCoins)) fail('lifetimeCoins must be a non-negative integer.');
  if (!NON_NEG(input.processedAt)) fail('processedAt must be a finite timestamp.');
  if (typeof input.fishing !== 'boolean') fail('fishing must be a boolean.');
  if (!isValidRngState(input.rngState)) fail('rngState must be a uint32 integer.');
  if (!LOCATION_IDS.has(input.locationId)) fail(`Unknown location: ${String(input.locationId)}.`);
  if (!ROD_IDS.has(input.rodId)) fail(`Unknown rod: ${String(input.rodId)}.`);
  if (!BAIT_IDS.has(input.baitId)) fail(`Unknown bait: ${String(input.baitId)}.`);
  const checkList = (list, valid, label) => {
    if (!Array.isArray(list) || !list.length) { fail(`${label} must be a non-empty array.`); return; }
    for (const id of list) if (!valid.has(id)) fail(`${label} has unknown id ${String(id)}.`);
  };
  checkList(input.ownedRods, ROD_IDS, 'ownedRods');
  checkList(input.ownedBaits, BAIT_IDS, 'ownedBaits');
  checkList(input.unlockedLocations, LOCATION_IDS, 'unlockedLocations');
  if (!fail.length && input.ownedRods && !input.ownedRods.includes(input.rodId)) fail('Selected rod is not owned.');
  if (!fail.length && input.unlockedLocations && !input.unlockedLocations.includes(input.locationId)) fail('Selected location is not unlocked.');
  return errors.length ? { ok: false, errors } : { ok: true, errors, value: input };
}

/* ------------------------------------------------------------------ *
 * v2 validation                                                       *
 * ------------------------------------------------------------------ */

/**
 * Validate a v2 state object.
 * @returns {{ ok: boolean, errors: string[], state?: object }}
 */
export function validateState(input) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Save is not an object.'] };
  }
  if (input.schemaVersion !== SCHEMA_VERSION_V2) {
    return {
      ok: false,
      errors: [`Unsupported save schema version: ${String(input.schemaVersion)} (expected ${SCHEMA_VERSION_V2}).`],
    };
  }

  if (!NON_NEG_INT(input.coins)) fail('coins must be a non-negative integer.');
  if (!NON_NEG_INT(input.lifetimeCatches)) fail('lifetimeCatches must be a non-negative integer.');
  if (!NON_NEG_INT(input.lifetimeCoins)) fail('lifetimeCoins must be a non-negative integer.');
  if (!NON_NEG_INT(input.castCount)) fail('castCount must be a non-negative integer.');
  if (!NON_NEG(input.playTimeMs)) fail('playTimeMs must be a non-negative number.');
  if (!FINITE(input.processedAt)) fail('processedAt must be a finite timestamp.');
  if (!FINITE(input.lastSeenAt)) fail('lastSeenAt must be a finite timestamp.');
  if (typeof input.paused !== 'boolean') fail('paused must be a boolean.');
  if (!NON_NEG_INT(input.ownedWorkers)) fail('ownedWorkers must be a non-negative integer.');
  if (!NON_NEG_INT(input.dockLevel)) fail('dockLevel must be a non-negative integer.');
  if (!NON_NEG_INT(input.stallLevel)) fail('stallLevel must be a non-negative integer.');
  if (!ROD_IDS.has(input.rodId)) fail(`Unknown rod: ${String(input.rodId)}.`);

  if (Array.isArray(input.ownedRods)) {
    for (const id of input.ownedRods) if (!ROD_IDS.has(id)) fail(`ownedRods has unknown id ${String(id)}.`);
  } else fail('ownedRods must be an array.');
  if (Array.isArray(input.ownedBaits)) {
    for (const id of input.ownedBaits) if (!BAIT_IDS.has(id)) fail(`ownedBaits has unknown id ${String(id)}.`);
  } else fail('ownedBaits must be an array.');
  if (Array.isArray(input.unlockedLocations)) {
    for (const id of input.unlockedLocations) if (!LOCATION_IDS.has(id)) fail(`unlockedLocations has unknown id ${String(id)}.`);
  } else fail('unlockedLocations must be an array.');

  // Equipment invariants: starters can never be lost.
  if (Array.isArray(input.ownedRods) && !input.ownedRods.includes('rod_bamboo')) fail('Starter rod is missing.');
  if (Array.isArray(input.ownedBaits) && !input.ownedBaits.includes('bait_worms')) fail('Free bait is missing.');
  if (Array.isArray(input.unlockedLocations) && !input.unlockedLocations.includes('loc_pond')) fail('Starting location is missing.');
  if (Array.isArray(input.ownedRods) && !input.ownedRods.includes(input.rodId)) fail('Selected rod is not owned.');

  // Bounds straight from content data.
  if (INT(input.dockLevel) && (input.dockLevel < 0 || input.dockLevel >= DOCK_LEVELS.length)) fail('dockLevel out of range.');
  if (INT(input.stallLevel) && (input.stallLevel < 0 || input.stallLevel >= STALL_LEVELS.length)) fail('stallLevel out of range.');
  if (INT(input.ownedWorkers) && input.ownedWorkers > 6) fail('ownedWorkers exceeds the six-worker limit.');

  // Workers.
  if (!Array.isArray(input.workers)) {
    fail('workers must be an array.');
  } else {
    if (input.workers.length !== input.ownedWorkers) fail('workers length must equal ownedWorkers.');
    if (input.workers.length > 6) fail('more than six workers.');
    const seen = new Set();
    for (const w of input.workers) {
      if (!w || typeof w !== 'object') { fail('worker entries must be objects.'); break; }
      if (!NON_NEG_INT(w.id) || w.id < 1) { fail('worker id must be a positive integer.'); break; }
      if (seen.has(w.id)) { fail(`duplicate worker id ${w.id}.`); break; }
      seen.add(w.id);
      if (!LOCATION_IDS.has(w.locationId)) { fail(`worker ${w.id} has unknown location.`); break; }
      if (!BAIT_IDS.has(w.baitId)) { fail(`worker ${w.id} has unknown bait.`); break; }
      if (!isValidRngState(w.rngState)) { fail(`worker ${w.id} rngState must be a uint32.`); break; }
      if (!NON_NEG(w.progressMs)) { fail(`worker ${w.id} progressMs must be non-negative.`); break; }
      if (!NON_NEG_INT(w.catches)) { fail(`worker ${w.id} catches must be a non-negative integer.`); break; }
    }
  }

  // Player block.
  const p = input.player;
  if (!p || typeof p !== 'object') {
    fail('player block is missing.');
  } else {
    if (!LOCATION_IDS.has(p.locationId)) fail(`player location unknown: ${String(p.locationId)}.`);
    if (!BAIT_IDS.has(p.baitId)) fail(`player bait unknown: ${String(p.baitId)}.`);
    if (!isValidRngState(p.rngState)) fail('player rngState must be a uint32.');
    if (!NON_NEG_INT(p.casts)) fail('player.casts must be a non-negative integer.');
    if (!NON_NEG_INT(p.catches)) fail('player.catches must be a non-negative integer.');
    if (!NON_NEG_INT(p.coins)) fail('player.coins must be a non-negative integer.');
    if (!NON_NEG(p.bestWeight)) fail('player.bestWeight must be non-negative.');
    if (p.active !== null && p.active !== undefined) fail('player.active must be null in a saved game.');
  }

  // Contract block.
  const c = input.contract;
  if (!c || typeof c !== 'object') {
    fail('contract block is missing.');
  } else {
    if (!isValidRngState(c.rngState)) fail('contract rngState must be a uint32.');
    if (!Array.isArray(c.available)) fail('contract.available must be an array.');
    if (c.available && c.available.length > 3) fail('contract.available holds at most three offers.');
    if (!NON_NEG_INT(c.completed)) fail('contract.completed must be a non-negative integer.');
    if (!NON_NEG_INT(c.earnedCoins)) fail('contract.earnedCoins must be a non-negative integer.');
    if (c.accepted !== null && (typeof c.accepted !== 'object' || !c.accepted)) {
      fail('contract.accepted must be an object or null.');
    } else if (c.accepted) {
      const a = c.accepted;
      if (!NON_NEG_INT(a.count)) fail('accepted contract count must be a non-negative integer.');
      if (!NON_NEG_INT(a.qty) || a.qty < 1) fail('accepted contract qty must be a positive integer.');
      if (!NON_NEG_INT(a.reward)) fail('accepted contract reward must be a non-negative integer.');
      if (!NON_NEG(a.threshold ?? 0)) fail('accepted contract threshold must be non-negative.');
      if (a.kind === 'qty' && !LOCATION_IDS.has(a.locationId)) fail('accepted qty contract has an unknown location.');
      if (a.kind === 'size' && !SPECIES_IDS.has(a.speciesId)) fail('accepted size contract has an unknown species.');
      if (a.kind === 'rarity' && !['common', 'uncommon', 'rare'].includes(a.rarity)) fail('accepted rarity contract has an invalid rarity.');
    }
    if (Array.isArray(c.available)) {
      for (const o of c.available) {
        if (!o || typeof o !== 'object' || typeof o.id !== 'string') { fail('offers must be objects with string ids.'); break; }
        if (!NON_NEG_INT(o.reward)) { fail('offer reward must be a non-negative integer.'); break; }
        if (!NON_NEG_INT(o.qty)) { fail('offer qty must be a positive integer.'); break; }
      }
    }
  }

  // Collection + recent (same shape as v1).
  if (!input.collection || typeof input.collection !== 'object' || Array.isArray(input.collection)) {
    fail('collection must be an object.');
  } else {
    for (const [id, entry] of Object.entries(input.collection)) {
      if (!SPECIES_IDS.has(id)) { fail(`collection has unknown species id ${id}.`); continue; }
      if (!entry || typeof entry !== 'object') { fail(`collection.${id} is not an object.`); continue; }
      if (!NON_NEG_INT(entry.catches)) fail(`collection.${id}.catches must be a non-negative integer.`);
      if (!NON_NEG(entry.bestWeight)) fail(`collection.${id}.bestWeight must be non-negative.`);
      if (!NON_NEG_INT(entry.trophies)) fail(`collection.${id}.trophies must be a non-negative integer.`);
      if (NON_NEG_INT(entry.trophies) && NON_NEG_INT(entry.catches) && entry.trophies > entry.catches) {
        fail(`collection.${id} has more trophies than catches.`);
      }
    }
  }
  if (!Array.isArray(input.recent)) {
    fail('recent must be an array.');
  } else if (input.recent.length > RECENT_LIMIT) {
    fail(`recent holds at most ${RECENT_LIMIT} entries.`);
  } else {
    for (const item of input.recent) {
      if (!item || typeof item !== 'object') { fail('recent entries must be objects.'); break; }
      if (!SPECIES_IDS.has(item.speciesId)) { fail(`recent has unknown species id ${String(item.speciesId)}.`); break; }
      if (!NON_NEG(item.weight)) { fail('recent weight must be non-negative.'); break; }
      if (!NON_NEG_INT(item.coins)) { fail('recent coins must be a non-negative integer.'); break; }
      if (item.source !== 'worker' && item.source !== 'player') { fail('recent source must be worker or player.'); break; }
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], state: input };
}

/* ------------------------------------------------------------------ *
 * Migration v1 → v2                                                   *
 * ------------------------------------------------------------------ */

/**
 * Migrate a validated v1 save to v2.
 * - The v1 automatic fisher becomes worker 1 with the same location/bait.
 * - The v1 fractional cast progress becomes that worker's fractional progress.
 * - Coins, gear, unlocks, collection and lifetime records are preserved exactly.
 * - The player block starts fresh (zero casts) — no invented offline player catches.
 * - The paused flag mirrors the v1 `fishing` state.
 * Idempotent: running it on a v2 state is a no-op.
 */
export function migrateV1toV2(v1) {
  if (!v1 || typeof v1 !== 'object') throw new Error('migrateV1toV2 needs a state object');
  if (v1.schemaVersion === SCHEMA_VERSION_V2) return { state: v1, migrated: false };

  const stamp = Math.floor(v1.processedAt) || 0;
  const v2 = createNewState(stamp, 1);

  // Preserve everything economic.
  v2.coins = v1.coins;
  v2.ownedRods = v1.ownedRods.slice();
  v2.ownedBaits = v1.ownedBaits.slice();
  v2.unlockedLocations = v1.unlockedLocations.slice();
  v2.rodId = v1.rodId;
  v2.lifetimeCatches = v1.lifetimeCatches;
  v2.lifetimeCoins = v1.lifetimeCoins;
  v2.playTimeMs = v1.playTimeMs || 0;
  v2.castCount = v1.castCount || v1.lifetimeCatches;
  v2.collection = v1.collection || {};
  v2.recent = (v1.recent || []).map((r) => ({ ...r, source: 'worker' }));
  v2.recentCounter = v1.recentCounter || (v1.recent ? v1.recent.length : 0);
  v2.processedAt = stamp;
  v2.lastSeenAt = stamp;

  // Worker 1 is the old automatic fisher, same assignment, same fractional progress.
  const worker = v2.workers[0];
  worker.locationId = v1.locationId;
  worker.baitId = v1.baitId;
  worker.progressMs = v1.castProgressMs || 0;
  worker.rngState = v1.rngState >>> 0; // the old stream continues seamlessly

  // The old `fishing` boolean maps to the global pause.
  v2.paused = !v1.fishing;

  // Player and contracts start fresh — no invented history, no double rewards.
  v2.player.rngState = ((v1.rngState ^ 0x9e3779b9) >>> 0) || 1;
  v2.contract.rngState = ((v1.rngState ^ 0xc0ffee) >>> 0) || 1;

  return { state: v2, migrated: true };
}

/* ------------------------------------------------------------------ *
 * Parse + migrate (any schema)                                        *
 * ------------------------------------------------------------------ */

/**
 * Parse a save and normalize it to the current schema.
 * @returns {{ ok: boolean, errors?: string[], state?: object, migrated?: boolean, fromVersion?: number }}
 */
export function deserialize(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Save file is not valid JSON (${err.message}).`] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['Save is not an object.'] };
  }

  if (parsed.schemaVersion === SCHEMA_VERSION_V2) {
    const checked = validateState(parsed);
    return checked.ok ? { ok: true, state: checked.state, migrated: false, fromVersion: 2 } : checked;
  }
  if (parsed.schemaVersion === SCHEMA_VERSION_V1) {
    const checked = validateV1(parsed);
    if (!checked.ok) return checked;
    const { state, migrated } = migrateV1toV2(checked.value);
    const rechecked = validateState(state);
    if (!rechecked.ok) {
      return { ok: false, errors: ['Migration produced an invalid state.', ...rechecked.errors] };
    }
    return { ok: true, state: rechecked.state, migrated, fromVersion: 1 };
  }
  return {
    ok: false,
    errors: [`Unsupported save schema version: ${String(parsed.schemaVersion)} (expected 1 or ${SCHEMA_VERSION_V2}).`],
  };
}

export function serialize(state) {
  return JSON.stringify(state);
}

export function validateV2Raw(input) {
  return validateState(input);
}

/* ------------------------------------------------------------------ *
 * Storage                                                             *
 * ------------------------------------------------------------------ */

export function getStorage() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    const probe = '__gf_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch (err) {
    return null;
  }
}

/**
 * Load a save from storage, migrating if needed.
 * @returns {{ status: 'loaded'|'empty'|'corrupt'|'unavailable',
 *             state?: object, migrated?: boolean, errors?: string[],
 *             raw?: string, backupKey?: string, preservedKey?: string }}
 */
export function loadFromStorage(storage) {
  if (!storage) return { status: 'unavailable' };
  let raw;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch (err) {
    return { status: 'unavailable' };
  }
  if (raw === null || raw === undefined || raw === '') return { status: 'empty' };

  const parsed = deserialize(raw);
  if (!parsed.ok) {
    let preserved = null;
    try {
      preserved = `${CORRUPT_KEY_PREFIX}${Date.now()}`;
      storage.setItem(preserved, raw);
    } catch (err) { preserved = null; }
    return { status: 'corrupt', errors: parsed.errors, raw, preservedKey: preserved };
  }
  return {
    status: 'loaded',
    state: parsed.state,
    migrated: parsed.migrated === true,
    fromVersion: parsed.fromVersion,
    raw,
  };
}

/**
 * Save to storage. When the on-disk version is older than the in-memory state's
 * schema, a backup of the original raw text is written first (exactly once per
 * migration — tracked with a dedicated key so a reload never grants it again).
 */
export function saveToStorage(storage, state, { backupRaw = null, wasMigrated = false } = {}) {
  if (!storage) return { ok: false, reason: 'unavailable' };
  try {
    if (wasMigrated && backupRaw) {
      const flagKey = 'gone-fishing.migrated.v2';
      if (storage.getItem(flagKey) !== '1') {
        storage.setItem(`${BACKUP_KEY_PREFIX}${Date.now()}`, backupRaw);
        storage.setItem(flagKey, '1');
      }
    }
    storage.setItem(SAVE_KEY, serialize(state));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'write_failed', error: err.message };
  }
}

export function exportSave(state) {
  return JSON.stringify(state, null, 2);
}
