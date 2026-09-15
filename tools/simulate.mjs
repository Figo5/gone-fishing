/**
 * Development-only balance simulation (no test framework, no dependencies).
 *   npm run simulate
 *
 * Compares idle-only play against intermittent active play with the v2 business:
 * the greedy policy hires workers and expands the dock; the active policy also
 * plays N player casts per simulated hour.
 */

import {
  BAITS,
  DOCK_LEVELS,
  HIRE_COSTS,
  LOCATIONS,
  PLAYER_CAST,
  RODS,
  STALL_LEVELS,
  castDurationMs,
  coinsForCatch,
  getBait,
  getRod,
  getSpecies,
  isTrophy,
  rarityDistribution,
  speciesByLocation,
} from '../src/data.js';
import {
  abandonContract,
  acceptContract,
  advanceState,
  assignWorker,
  createNewState,
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

const HOUR = 3_600_000;
const STEP = 5_000;
const START = 1_700_000_000_000;

const fmt = (ms) => {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  return m < 60 ? `${m}m${String(totalSec % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
};

/** Shared business policy: prefer hiring (needs dock first), then dock, then stall, then rod/bait/location. */
function businessStep(state, now, marks, wanted = []) {
  const tryHire = () => {
    const r = hireWorker(state, now);
    if (r.ok) { if (!marks.hire2) marks.hire2 = now; return true; }
    if (r.reason === 'dock_full') {
      const d = expandDock(state, now);
      if (d.ok) { if (!marks[`dock${state.dockLevel}`]) marks[`dock${state.dockLevel}`] = now; return true; }
      return false;
    }
    return false;
  };
  if (wanted.includes('business') && tryHire()) return;

  if (wanted.includes('rod') && !state.ownedRods.includes('rod_carbon')) {
    if (upgradeRod(state, now, 'rod_carbon').ok) { if (!marks.rod) marks.rod = now; return; }
  }
  if (wanted.includes('bait') && !state.ownedBaits.includes('bait_minnows')) {
    if (purchaseBait(state, now, 'bait_minnows').ok) { if (!marks.bait) marks.bait = now; return; }
  }
  if (wanted.includes('location') && !state.unlockedLocations.includes('loc_river')) {
    if (purchaseLocation(state, now, 'loc_river').ok) { if (!marks.location) marks.location = now; return; }
  }
  if (wanted.includes('stall') && upgradeStall(state, now).ok) { if (!marks.stall) marks.stall = now; }
}

/** One player cast with a given skill (1 = perfect, 0 = never taps). Returns coins. */
function playerCast(state, now, skill) {
  if (!startPlayerCast(state, now).ok) return 0;
  if (skill <= 0) return settlePlayerCast(state, now + 1000, true).coins;
  for (let stage = 0; stage < PLAYER_CAST.stages; stage += 1) {
    submitPlayerInput(state, now + 600 + stage * 700, skill);
  }
  return settlePlayerCast(state, now + 2800, false).coins;
}

/** Contract policy: always keep a contract accepted if one is affordable to complete. */
function contractStep(state, now, marks) {
  if (state.contract.accepted) return;
  if (!state.contract.available.length) {
    if (!generateContracts(state, now).ok) return;
  }
  // Accept the cheapest-to-complete looking offer (smallest qty).
  const offers = [...state.contract.available].sort((a, b) => a.qty - b.qty);
  if (offers.length && acceptContract(state, now, offers[0].id).ok) {
    if (!marks.contract1) marks.contract1 = now;
  }
}

function runPolicy({ seed, hours, castsPerHour, contracts }) {
  const state = createNewState(START, seed);
  state.fishing = true; void state.fishing;
  const marks = {};
  const wanted = castsPerHour > 0 ? ['business', 'rod', 'bait', 'location', 'stall'] : ['business', 'stall'];
  const castInterval = castsPerHour > 0 ? Math.floor(HOUR / castsPerHour) : 0;
  let castsPlayed = 0;

  for (let t = STEP; t <= hours * HOUR; t += STEP) {
    const now = START + t;
    advanceState(state, now);
    businessStep(state, now, marks, wanted);
    if (contracts) contractStep(state, now, marks);
    if (castInterval && t % castInterval < STEP) {
      // Perfect play for the upper bound of active benefit.
      playerCast(state, now, 1);
      castsPlayed += 1;
    }
  }
  return { state, marks, castsPlayed };
}

function report(label, { state, marks, castsPlayed }) {
  const parts = Object.entries(marks)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k}=${fmt(v - START)}`)
    .join('  ');
  console.log(`${label} | ${parts}`);
  console.log(`  coins ${Math.round(state.coins).toLocaleString()} · lifetime ${Math.round(state.lifetimeCoins).toLocaleString()} · ${state.lifetimeCatches} catches · workers ${state.workers.length} · dock ${state.dockLevel} · stall ${state.stallLevel}${castsPlayed ? ` · ${castsPlayed} player casts` : ''}`);
}

const SEEDS = [1, 7, 42, 1234, 90210];
const HOURS = 3;

console.log('=== Idle-only vs intermittent active play (3h, five seeds) ===');
for (const seed of SEEDS) {
  const idle = runPolicy({ seed, hours: HOURS, castsPerHour: 0, contracts: false });
  report(`seed ${String(seed).padStart(5)} idle-only      `, idle);
  const active = runPolicy({ seed, hours: HOURS, castsPerHour: 12, contracts: false });
  report(`seed ${String(seed).padStart(5)} active 12/h    `, active);
  const activeContracts = runPolicy({ seed, hours: HOURS, castsPerHour: 12, contracts: true });
  report(`seed ${String(seed).padStart(5)} active+contract`, activeContracts);
  console.log('');
}

console.log('=== Migration sanity: a rich v1 save keeps its coins and keeps earning ===');
console.log('(see test/save.test.js for the covered cases)');

console.log('\n=== Expected per-hour tables (Worms, average-size fish) ===');
for (const loc of LOCATIONS) {
  for (const rod of RODS) {
    const species = speciesByLocation(loc.id);
    const dist = rarityDistribution(species, getBait('bait_worms'));
    const byRarity = new Map(dist.map((d) => [d.rarity, d.probability]));
    let expected = 0;
    for (const s of species) {
      const inRarity = species.filter((x) => x.rarity === s.rarity).length || 1;
      expected += ((byRarity.get(s.rarity) || 0) / inRarity) * coinsForCatch(s, (s.minWeight + s.maxWeight) / 2);
    }
    const duration = castDurationMs(getRod(rod.id), getBait('bait_worms'));
    console.log(
      `${loc.name.padEnd(16)} ${rod.name.padEnd(22)} ${Math.round(duration / 1000).toString().padStart(2)}s/cast  ` +
      `${Math.round((expected * HOUR) / duration).toString().padStart(7)} coins/h per worker`,
    );
  }
}
