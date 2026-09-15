/**
 * Gone Fishing — persistence: serialization, validation, storage.
 *
 * Validation is strict and fail-closed: an import that fails validation leaves the
 * live state completely untouched. Missing or broken storage never crashes the game;
 * a corrupt save is preserved (and exportable) rather than silently erased.
 */

import {
  BAITS,
  DEFAULT_SETUP,
  LOCATIONS,
  RECENT_LIMIT,
  RODS,
  SCHEMA_VERSION,
  SPECIES,
} from './data.js';
import { isValidRngState } from './rng.js';
import { createNewState } from './engine.js';

export const SAVE_KEY = 'gone-fishing.save.v1';
export const CORRUPT_KEY_PREFIX = 'gone-fishing.corrupt.';
export const LOCK_KEY = 'gone-fishing.writer';

const SPECIES_IDS = new Set(SPECIES.map((s) => s.id));
const ROD_IDS = new Set(RODS.map((r) => r.id));
const BAIT_IDS = new Set(BAITS.map((b) => b.id));
const LOCATION_IDS = new Set(LOCATIONS.map((l) => l.id));

export function serialize(state) {
  return JSON.stringify(state);
}

const FINITE = (v) => typeof v === 'number' && Number.isFinite(v);
const NON_NEG = (v) => FINITE(v) && v >= 0;
const INT = (v) => Number.isInteger(v);
const NON_NEG_INT = (v) => INT(v) && v >= 0;

/**
 * Validate a candidate state object.
 * @returns {{ ok: boolean, errors: string[], state?: object }}
 */
export function validateState(input) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Save is not an object.'] };
  }
  if (input.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`Unsupported save schema version: ${String(input.schemaVersion)} (expected ${SCHEMA_VERSION}).`],
    };
  }

  if (!NON_NEG_INT(input.coins)) fail('coins must be a non-negative integer.');
  if (!NON_NEG_INT(input.lifetimeCatches)) fail('lifetimeCatches must be a non-negative integer.');
  if (!NON_NEG_INT(input.lifetimeCoins)) fail('lifetimeCoins must be a non-negative integer.');
  if (!NON_NEG_INT(input.castCount)) fail('castCount must be a non-negative integer.');
  if (!NON_NEG(input.playTimeMs)) fail('playTimeMs must be a non-negative number.');
  if (!NON_NEG(input.castProgressMs)) fail('castProgressMs must be a non-negative number.');
  if (!FINITE(input.processedAt)) fail('processedAt must be a finite timestamp.');
  if (!FINITE(input.lastSeenAt)) fail('lastSeenAt must be a finite timestamp.');
  if (typeof input.fishing !== 'boolean') fail('fishing must be a boolean.');
  if (!isValidRngState(input.rngState)) fail('rngState must be a uint32 integer.');

  const checkIdList = (list, valid, label) => {
    if (!Array.isArray(list) || list.length === 0) return fail(`${label} must be a non-empty array.`);
    for (const id of list) if (!valid.has(id)) fail(`${label} contains an unknown id: ${String(id)}.`);
  };

  checkIdList(input.ownedRods, ROD_IDS, 'ownedRods');
  checkIdList(input.ownedBaits, BAIT_IDS, 'ownedBaits');
  checkIdList(input.unlockedLocations, LOCATION_IDS, 'unlockedLocations');

  if (!LOCATION_IDS.has(input.locationId)) fail(`Unknown location: ${String(input.locationId)}.`);
  if (!ROD_IDS.has(input.rodId)) fail(`Unknown rod: ${String(input.rodId)}.`);
  if (!BAIT_IDS.has(input.baitId)) fail(`Unknown bait: ${String(input.baitId)}.`);

  if (Array.isArray(input.ownedRods) && !input.ownedRods.includes(input.rodId)) fail('Selected rod is not owned.');
  if (Array.isArray(input.ownedBaits) && !input.ownedBaits.includes(input.baitId)) fail('Selected bait is not owned.');
  if (Array.isArray(input.unlockedLocations) && !input.unlockedLocations.includes(input.locationId)) {
    fail('Selected location is not unlocked.');
  }
  // The starter rod, free bait and starting location can never be lost.
  if (ROD_IDS.has(DEFAULT_SETUP.rodId) && Array.isArray(input.ownedRods) && !input.ownedRods.includes(DEFAULT_SETUP.rodId)) {
    fail('Starter rod is missing from ownedRods.');
  }
  if (Array.isArray(input.ownedBaits) && !input.ownedBaits.includes(DEFAULT_SETUP.baitId)) {
    fail('Free bait is missing from ownedBaits.');
  }
  if (Array.isArray(input.unlockedLocations) && !input.unlockedLocations.includes(DEFAULT_SETUP.locationId)) {
    fail('Starting location is missing from unlockedLocations.');
  }

  if (!input.collection || typeof input.collection !== 'object' || Array.isArray(input.collection)) {
    fail('collection must be an object.');
  } else {
    for (const [id, entry] of Object.entries(input.collection)) {
      if (!SPECIES_IDS.has(id)) {
        fail(`collection contains an unknown species id: ${id}.`);
        continue;
      }
      if (!entry || typeof entry !== 'object') {
        fail(`collection entry ${id} is not an object.`);
        continue;
      }
      if (!NON_NEG_INT(entry.catches)) fail(`collection.${id}.catches must be a non-negative integer.`);
      if (!NON_NEG(entry.bestWeight)) fail(`collection.${id}.bestWeight must be a non-negative number.`);
      if (!NON_NEG_INT(entry.trophies)) fail(`collection.${id}.trophies must be a non-negative integer.`);
      if (NON_NEG_INT(entry.trophies) && NON_NEG_INT(entry.catches) && entry.trophies > entry.catches) {
        fail(`collection.${id} has more trophies than catches.`);
      }
    }
  }

  if (!Array.isArray(input.recent)) {
    fail('recent must be an array.');
  } else if (input.recent.length > RECENT_LIMIT) {
    fail(`recent must hold at most ${RECENT_LIMIT} entries.`);
  } else {
    for (const item of input.recent) {
      if (!item || typeof item !== 'object') { fail('recent entries must be objects.'); break; }
      if (!SPECIES_IDS.has(item.speciesId)) { fail(`recent contains an unknown species id: ${String(item.speciesId)}.`); break; }
      if (!NON_NEG(item.weight)) { fail('recent entry weight must be a non-negative number.'); break; }
      if (!NON_NEG_INT(item.coins)) { fail('recent entry coins must be a non-negative integer.'); break; }
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], state: input };
}

/** Parse + validate. Never mutates anything on failure. */
export function deserialize(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Save file is not valid JSON (${err.message}).`] };
  }
  return validateState(parsed);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

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

const SAFE_STORAGE_FALLBACK = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
})();

/**
 * Load a save from storage.
 * @returns {{ status: 'loaded'|'empty'|'corrupt'|'unavailable', state?: object, errors?: string[], raw?: string }}
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
    // Preserve the raw corrupt save instead of erasing it.
    let preserved = null;
    try {
      preserved = `${CORRUPT_KEY_PREFIX}${Date.now()}`;
      storage.setItem(preserved, raw);
    } catch (err) { preserved = null; }
    return { status: 'corrupt', errors: parsed.errors, raw, preservedKey: preserved };
  }
  return { status: 'loaded', state: parsed.state, raw };
}

export function saveToStorage(storage, state) {
  if (!storage) return { ok: false, reason: 'unavailable' };
  try {
    storage.setItem(SAVE_KEY, serialize(state));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'write_failed', error: err.message };
  }
}

export function exportSave(state) {
  return JSON.stringify(state, null, 2);
}

export function freshState(now, seed) {
  return createNewState(now, seed);
}
