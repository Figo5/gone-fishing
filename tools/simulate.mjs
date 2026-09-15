/**
 * Development-only balance simulation (no test framework, no dependencies).
 *   npm run simulate
 *
 * Runs a simple greedy policy against several fixed seeds and reports:
 *  - coins per minute in each location with each rod
 *  - when a player could afford each upgrade / unlock
 *  - expected value per cast from the probability tables
 */

import {
  BAITS,
  LOCATIONS,
  RODS,
  castDurationMs,
  coinsForCatch,
  getBait,
  getRod,
  getSpecies,
  isTrophy,
  rarityDistribution,
  speciesByLocation,
} from '../src/data.js';
import { advanceState, createNewState, ownsItem, purchase, purchaseAndVisit } from '../src/engine.js';

const HOUR = 3600 * 1000;
const STEP = 5 * 1000; // five simulated seconds per policy tick

function policyStep(state, now, remaining) {
  // Buy the cheapest affordable thing we still want, and move to the newest water.
  const targets = ['rod_fiberglass', 'bait_minnows', 'rod_carbon', 'loc_river', 'bait_glow', 'rod_pro', 'loc_lake'];
  const affordable = targets
    .filter((id) => !ownsItem(state, id))
    .map((id) => ({ id, cost: costOf(id) }))
    .filter((t) => t.cost <= state.coins)
    .sort((a, b) => a.cost - b.cost);
  if (!affordable.length) return;
  const target = affordable[0];
  if (target.id.startsWith('loc_')) purchaseAndVisit(state, now, target.id);
  else purchase(state, now, target.id);
  if (remaining[target.id] === undefined) remaining[target.id] = now;
}

function costOf(id) {
  const all = [...RODS, ...BAITS, ...LOCATIONS];
  const item = all.find((i) => i.id === id);
  return item ? item.cost : Infinity;
}

function runSeed(seed, hours) {
  const start = 1_700_000_000_000;
  const state = createNewState(start, seed);
  state.fishing = true;
  const firstBought = {};
  const total = hours * HOUR;
  let lastRatesAt = start;
  let lastCoins = 0;

  for (let t = STEP; t <= total; t += STEP) {
    const now = start + t;
    advanceState(state, now);
    policyStep(state, now, firstBought);
    lastRatesAt = now;
    lastCoins = state.coins;
  }
  return { state, firstBought, lastCoins, lastRatesAt };
}

/** Expected coin value per cast for a location + rod + bait combination. */
function expectedPerHour(locationId, rodId, baitId) {
  const species = speciesByLocation(locationId);
  const dist = rarityDistribution(species, getBait(baitId));
  const byRarity = new Map(dist.map((d) => [d.rarity, d.probability]));
  let expected = 0;
  for (const s of species) {
    const inRarity = species.filter((x) => x.rarity === s.rarity).length || 1;
    const p = (byRarity.get(s.rarity) || 0) / inRarity;
    // average of coinsForCatch over the size range
    let sum = 0;
    const steps = 200;
    for (let i = 0; i <= steps; i += 1) {
      sum += coinsForCatch(s, s.minWeight + (s.maxWeight - s.minWeight) * (i / steps));
    }
    expected += p * (sum / (steps + 1));
  }
  const duration = castDurationMs(getRod(rodId), getBait(baitId));
  return { perCast: expected, perHour: (expected * HOUR) / duration, durationSec: duration / 1000 };
}

function fmt(ms) {
  if (ms === undefined) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

console.log('=== Expected value per hour (average-size fish, perfect uptime) ===');
for (const loc of LOCATIONS) {
  for (const rod of RODS) {
    const row = expectedPerHour(loc.id, rod.id, 'bait_worms');
    console.log(
      `${loc.name.padEnd(16)} ${rod.name.padEnd(22)} ${row.durationSec.toFixed(0).padStart(2)}s/cast  ` +
      `${Math.round(row.perCast).toString().padStart(5)} coins/cast  ${Math.round(row.perHour).toString().padStart(7)} coins/h`,
    );
  }
}

console.log('\n=== Greedy policy, fixed seeds (time to first afford each item) ===');
const SEEDS = [1, 7, 42, 1234, 90210];
const hoursArg = Number(process.argv[2] || 3);
for (const seed of SEEDS) {
  const { state, firstBought } = runSeed(seed, hoursArg);
  const parts = ['rod_fiberglass', 'bait_minnows', 'rod_carbon', 'loc_river', 'bait_glow', 'rod_pro', 'loc_lake']
    .map((id) => `${id.replace(/^(rod_|bait_|loc_)/, '')}=${fmt(firstBought[id] === undefined ? undefined : firstBought[id] - 1_700_000_000_000)}`)
    .join('  ');
  console.log(`seed ${String(seed).padStart(5)} | ${parts}`);
  console.log(
    `            | ${state.lifetimeCatches} catches, ${Math.round(state.lifetimeCoins).toLocaleString()} coins earned, ` +
    `${Object.keys(state.collection).length}/15 species, in ${state.locationId}`,
  );
}

console.log('\n=== Bait tradeoffs, measured by running the engine (3h, Bamboo Pole, Stillwater Pond) ===');
for (const bait of BAITS) {
  const state = createNewState(1_700_000_000_000, 31337);
  state.fishing = true;
  state.ownedBaits = BAITS.map((b) => b.id);
  state.baitId = bait.id;
  const hours = 3;
  const summary = advanceState(state, 1_700_000_000_000 + hours * HOUR);
  const ratios = summary.catches.map((r) => {
    const s = getSpecies(r.speciesId);
    return (r.weight - s.minWeight) / (s.maxWeight - s.minWeight);
  });
  const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const trophies = summary.catches.filter((r) => isTrophy(getSpecies(r.speciesId), r.weight)).length;
  console.log(
    `${bait.name.padEnd(10)} ${(castDurationMs(getRod('rod_bamboo'), bait) / 1000).toFixed(0)}s/cast  ` +
    `${summary.catches.length} casts  ${Math.round(summary.coins / hours).toString().padStart(6)} coins/h  ` +
    `avg size ${(meanRatio * 100).toFixed(0)}% of range  ${trophies} trophies ` +
    `(${((trophies / summary.catches.length) * 100).toFixed(2)}% of casts)`,
  );
}

console.log('\n=== Species probability tables (Worms vs Glow Lure) ===');
for (const loc of LOCATIONS) {
  const species = speciesByLocation(loc.id);
  for (const baitId of ['bait_worms', 'bait_glow']) {
    const dist = rarityDistribution(species, getBait(baitId));
    console.log(
      `${loc.name.padEnd(16)} ${getBait(baitId).name.padEnd(10)} ` +
      dist.map((d) => `${d.rarity[0].toUpperCase()} ${(d.probability * 100).toFixed(1)}%`).join('  '),
    );
  }
}
