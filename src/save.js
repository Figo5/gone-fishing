/**
 * Gone Fishing — persistence: serialization, validation, schema migration, storage.
 *
 * Fail-closed: an import or load that fails validation leaves the live state untouched.
 * v1 saves are migrated to v2 (the dock business). Migration is idempotent — importing
 * an already-migrated save changes nothing — and writes a backup of the original save
 * before replacing it.
 */

import {
  BAITS,
  DOCK_LEVELS,
  EVENT_CHOICES,
  CONTRACT_OFFICE_LEVELS,
  LEGACY_PERKS,
  HIRE_COSTS,
  LOCATIONS,
  PLAYER_CAST,
  RODS,
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
export const SCHEMA_VERSION_V3 = 3;
export const SCHEMA_VERSION_V4 = 4;
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_V4;
export { SCHEMA_VERSION };

export const SAVE_KEY = 'gone-fishing.save.v1';
export const BACKUP_KEY_PREFIX = 'gone-fishing.backup.';
export const CORRUPT_KEY_PREFIX = 'gone-fishing.corrupt.';
export const LOCK_KEY = 'gone-fishing.writer';

const SPECIES_IDS = new Set(SPECIES.map((s) => s.id));
const ROD_IDS = new Set(RODS.map((r) => r.id));
const BAIT_IDS = new Set(BAITS.map((b) => b.id));
const LOCATION_IDS = new Set(LOCATIONS.map((l) => l.id));

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
  if (![SCHEMA_VERSION_V2, SCHEMA_VERSION_V3, SCHEMA_VERSION_V4].includes(input.schemaVersion)) {
    return {
      ok: false,
      errors: [`Unsupported save schema version: ${String(input.schemaVersion)}.`],
    };
  }
  const isV3 = input.schemaVersion >= SCHEMA_VERSION_V3;
  const isV4 = input.schemaVersion === SCHEMA_VERSION_V4;

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
      if (isV4 && !['qty', 'size', 'rarity', 'species', 'trophy', 'source'].includes(a.kind)) fail('accepted contract kind is invalid.');
      if (a.kind === 'species' && !SPECIES_IDS.has(a.speciesId)) fail('accepted species contract has an unknown species.');
      if (a.kind === 'trophy' && !LOCATION_IDS.has(a.locationId)) fail('accepted trophy contract has an unknown location.');
      if (a.kind === 'source' && (!LOCATION_IDS.has(a.locationId) || !['player', 'worker'].includes(a.source))) fail('accepted source contract is invalid.');
    }
    if (Array.isArray(c.available)) {
      for (const o of c.available) {
        if (!o || typeof o !== 'object' || typeof o.id !== 'string') { fail('offers must be objects with string ids.'); break; }
        if (!NON_NEG_INT(o.reward)) { fail('offer reward must be a non-negative integer.'); break; }
        if (!NON_NEG_INT(o.qty)) { fail('offer qty must be a positive integer.'); break; }
        if (isV4 && !['qty', 'size', 'rarity', 'species', 'trophy', 'source'].includes(o.kind)) { fail('offer kind is invalid.'); break; }
        if (o.locationId && !LOCATION_IDS.has(o.locationId)) { fail('offer location is invalid.'); break; }
        if (o.speciesId && !SPECIES_IDS.has(o.speciesId)) { fail('offer species is invalid.'); break; }
        if (o.kind === 'source' && !['player', 'worker'].includes(o.source)) { fail('offer source is invalid.'); break; }
      }
    }
  }

  // v3 prestige/business-training fields (required for v3, defaulted for v2).
  if (isV3) {
    if (!input.prestige || typeof input.prestige !== 'object') {
      fail('prestige block is missing.');
    } else {
      const pr = input.prestige;
      if (!NON_NEG_INT(pr.count)) fail('prestige.count must be a non-negative integer.');
      if (!NON_NEG(pr.runEarnings)) fail('prestige.runEarnings must be non-negative.');
      if (!NON_NEG(pr.lastPrestigeAt)) fail('prestige.lastPrestigeAt must be non-negative.');
      if (!LOCATION_IDS.has(pr.homePondId)) fail(`prestige.homePondId unknown: ${String(pr.homePondId)}.`);
      if (NON_NEG_INT(pr.count) && pr.count > 1000) fail('prestige.count is implausibly large.');
    }
    if (!NON_NEG_INT(input.trainingLevel)) fail('trainingLevel must be a non-negative integer.');
    if (!NON_NEG_INT(input.reelControlLevel)) fail('reelControlLevel must be a non-negative integer.');
    if (INT(input.trainingLevel) && input.trainingLevel > 3) fail('trainingLevel out of range.');
    if (INT(input.reelControlLevel) && input.reelControlLevel > 3) fail('reelControlLevel out of range.');
  }
  if (isV4) {
    if (!NON_NEG_INT(input.officeLevel) || input.officeLevel >= CONTRACT_OFFICE_LEVELS.length) fail('officeLevel out of range.');
    const legacy = input.legacy;
    if (!legacy || typeof legacy !== 'object') fail('legacy block is missing.');
    else {
      if (!NON_NEG_INT(legacy.points)) fail('legacy.points must be a non-negative integer.');
      if (!Array.isArray(legacy.perks) || new Set(legacy.perks).size !== legacy.perks.length ||
          legacy.perks.some((id) => !LEGACY_PERKS.some((perk) => perk.id === id))) fail('legacy.perks contains invalid or duplicate ids.');
      if (input.prestige && NON_NEG_INT(input.prestige.count) &&
          NON_NEG_INT(legacy.points) && Array.isArray(legacy.perks) && legacy.points + legacy.perks.length > input.prestige.count) {
        fail('Legacy points exceed earned prestiges.');
      }
    }
    const e = input.event;
    if (!e || typeof e !== 'object') fail('event block is missing.');
    else {
      if (e.activeId !== null && !EVENT_CHOICES.some((choice) => choice.id === e.activeId)) fail('event.activeId is invalid.');
      for (const field of ['startedAt', 'endsAt', 'nextAt', 'completed']) if (!NON_NEG_INT(e[field])) fail(`event.${field} must be non-negative.`);
      if (e.activeId && e.endsAt <= e.startedAt) fail('Active event has invalid timing.');
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
      if (isV4 && !NON_NEG_INT(entry.bestValue)) fail(`collection.${id}.bestValue must be a non-negative integer.`);
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
 * Migrate a validated v2 save to v3 (prestige + new business upgrades).
 * - prestigeCount starts at 0, multiplier 1: updating must not force a prestige.
 * - runEarnings is seeded from lifetimeCoins, the only trustworthy pre-existing
 *   earnings counter. This may understate a long-lived run (lifetime coins count
 *   every previous minute of play), but it never fabricates earnings from wallet
 *   balance or purchase history. Documented fallback per spec.
 * - trainingLevel and reelControlLevel start at 0 (the new systems begin fresh;
 *   their tiers are usable immediately).
 * Idempotent for v3 input.
 */
export function migrateV2toV3(v2) {
  if (!v2 || typeof v2 !== 'object') throw new Error('migrateV2toV3 needs a state object');
  if (v2.schemaVersion >= SCHEMA_VERSION_V3 && v2.prestige) return { state: v2, migrated: false };

  const v3 = JSON.parse(JSON.stringify(v2));
  v3.schemaVersion = SCHEMA_VERSION_V3;
  v3.prestige = {
    count: 0,
    runEarnings: Math.max(0, Math.floor(v2.lifetimeCoins || 0)),
    lastPrestigeAt: 0,
    homePondId: 'loc_pond',
  };
  v3.trainingLevel = 0;
  v3.reelControlLevel = 0;
  return { state: v3, migrated: true };
}

/** Add run automation, rotating opportunities, and earned legacy choices.
 * Old catch values cannot be reconstructed honestly, so records begin at zero. */
export function migrateV3toV4(v3) {
  if (!v3 || typeof v3 !== 'object') throw new Error('migrateV3toV4 needs a state object');
  if (v3.schemaVersion === SCHEMA_VERSION_V4) return { state: v3, migrated: false };
  const v4 = JSON.parse(JSON.stringify(v3));
  v4.schemaVersion = SCHEMA_VERSION_V4;
  v4.officeLevel = 0;
  v4.legacy = { points: 0, perks: [] };
  v4.event = { activeId: null, startedAt: 0, endsAt: 0, nextAt: Math.floor(v3.processedAt) + 25 * 60_000, completed: 0 };
  for (const entry of Object.values(v4.collection || {})) entry.bestValue = 0;
  return { state: v4, migrated: true };
}

/**
 * Migrate a validated v1 save to v2 (the dock business).
 * - The v1 automatic fisher becomes worker 1 with the same location/bait.
 * - The v1 fractional cast progress becomes that worker's fractional progress.
 * - Coins, gear, unlocks, collection and lifetime records are preserved exactly.
 * - The player block starts fresh (zero casts) — no invented offline player catches.
 * - The paused flag mirrors the v1 `fishing` state.
 * Idempotent: running it on a v2/v3 state is a no-op.
 */
export function migrateV1toV2(v1) {
  if (!v1 || typeof v1 !== 'object') throw new Error('migrateV1toV2 needs a state object');
  if (v1.schemaVersion !== SCHEMA_VERSION_V1) return { state: v1, migrated: false };

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
  v2.collection = Object.fromEntries(Object.entries(v1.collection || {}).map(([id, entry]) => [id, { ...entry, bestValue: 0 }]));
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

  // createNewState now emits v3 directly; seed run earnings from the only
  // trustworthy counter (see migrateV2toV3's note).
  v2.prestige = {
    count: 0,
    runEarnings: Math.max(0, Math.floor(v1.lifetimeCoins || 0)),
    lastPrestigeAt: 0,
    homePondId: 'loc_pond',
  };

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

  if (parsed.schemaVersion === SCHEMA_VERSION_V4) {
    const checked = validateState(parsed);
    return checked.ok ? { ok: true, state: checked.state, migrated: false, fromVersion: 4 } : checked;
  }
  if (parsed.schemaVersion === SCHEMA_VERSION_V3) {
    const checked = validateState(parsed);
    if (!checked.ok) return checked;
    const upgraded = migrateV3toV4(checked.state);
    const rechecked = validateState(upgraded.state);
    return rechecked.ok ? { ok: true, state: rechecked.state, migrated: true, fromVersion: 3 } : rechecked;
  }
  if (parsed.schemaVersion === SCHEMA_VERSION_V2) {
    const checked = validateState(parsed);
    if (!checked.ok) return checked;
    const v3 = migrateV2toV3(checked.state);
    const v4 = migrateV3toV4(v3.state);
    const rechecked = validateState(v4.state);
    if (!rechecked.ok) {
      return { ok: false, errors: ['Migration produced an invalid state.', ...rechecked.errors] };
    }
    return { ok: true, state: rechecked.state, migrated: true, fromVersion: 2 };
  }
  if (parsed.schemaVersion === SCHEMA_VERSION_V1) {
    const checked = validateV1(parsed);
    if (!checked.ok) return checked;
    const toV2 = migrateV1toV2(checked.value);
    const toV3 = migrateV2toV3(toV2.state);
    const toV4 = migrateV3toV4(toV3.state);
    const rechecked = validateState(toV4.state);
    if (!rechecked.ok) {
      return { ok: false, errors: ['Migration produced an invalid state.', ...rechecked.errors] };
    }
    return { ok: true, state: rechecked.state, migrated: true, fromVersion: 1 };
  }
  return {
    ok: false,
    errors: [`Unsupported save schema version: ${String(parsed.schemaVersion)} (expected 1–${SCHEMA_VERSION_V4}).`],
  };
}

export function serialize(state) {
  // A live hand cast is intentionally transient. Saving its partial input would
  // make the next load fail validation and could duplicate a catch on resume.
  return JSON.stringify({ ...state, player: { ...state.player, active: null } });
}

export function backupToStorage(storage, state) {
  if (!storage) return { ok: false, reason: 'unavailable' };
  const key = `${BACKUP_KEY_PREFIX}prestige.${Date.now()}`;
  try {
    storage.setItem(key, serialize(state));
    return { ok: true, key };
  } catch (error) {
    return { ok: false, reason: 'write_failed', error: error.message };
  }
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
      const flagKey = 'gone-fishing.migrated.v4';
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
  return JSON.stringify(JSON.parse(serialize(state)), null, 2);
}
