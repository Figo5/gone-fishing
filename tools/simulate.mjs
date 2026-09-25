/** Deterministic development playthroughs. Each policy checks in for two minutes
 * every five or fifteen simulated minutes, makes purchases, then leaves. */
import {
  advanceState, assignWorker, chooseEvent, createNewState, expandDock,
  generateContracts, acceptContract, hireWorker, performPrestige,
  prestigeEligibility, purchaseBait, purchaseLocation, settlePlayerCast,
  startPlayerCast, submitPlayerInput, upgradeContractOffice, upgradeRod,
  upgradeStall, upgradeTraining, discoveredCount, locationMastery,
} from '../src/engine.js';
import { LOCATIONS, SPECIES } from '../src/data.js';

const START = 1_700_000_000_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const fmt = (ms) => ms == null ? '—' : `${Math.floor(ms / HOUR)}h${String(Math.floor(ms % HOUR / MINUTE)).padStart(2, '0')}m`;

const POLICIES = [
  { name: 'idle check-ins', interval: 15, active: 0, contracts: false, priority: 'balanced' },
  { name: 'worker-heavy', interval: 5, active: 0, contracts: false, priority: 'workers' },
  { name: 'upgrade-heavy', interval: 5, active: 0, contracts: false, priority: 'upgrades' },
  { name: 'collection hunt', interval: 5, active: 2, contracts: false, priority: 'collection' },
  { name: 'contracts', interval: 5, active: 0, contracts: true, priority: 'balanced' },
  { name: 'active-heavy', interval: 5, active: 30, contracts: false, priority: 'balanced' },
  { name: 'active + contracts', interval: 5, active: 12, contracts: true, priority: 'balanced' },
];

function mark(marks, key, elapsed) { if (!(key in marks)) marks[key] = elapsed; }

function purchaseAndAssign(s, now, elapsed, policy, marks) {
  const buy = (fn, key) => {
    const result = fn();
    if (result.ok) { mark(marks, key, elapsed); return true; }
    return false;
  };

  // Exploration is a first-class investment. One worker can cover each early water,
  // then prestige home waters receive another. This policy never requires hand play.
  if (!s.unlockedLocations.includes('loc_river') && s.coins >= 3500) {
    buy(() => purchaseLocation(s, now, 'loc_river'), 'river');
  }
  if (!s.unlockedLocations.includes('loc_lake') && s.coins >= 60000 &&
      (policy.priority === 'collection' || s.prestige.count >= 1 || s.coins > 100000)) {
    buy(() => purchaseLocation(s, now, 'loc_lake'), 'lake');
  }

  const home = s.prestige.homePondId;
  for (const worker of s.workers) {
    const destination = worker.id === 2 && s.unlockedLocations.includes('loc_river') ? 'loc_river'
      : worker.id === 3 && s.unlockedLocations.includes('loc_lake') ? 'loc_lake'
      : worker.id === 4 && s.unlockedLocations.includes('loc_pond') ? 'loc_pond'
      : home;
    if (worker.locationId !== destination) assignWorker(s, now, worker.id, { locationId: destination });
  }

  const hire = () => {
    if (s.ownedWorkers >= 6) return false;
    if (s.ownedWorkers >= 2 && s.ownedWorkers >= [2, 3, 4, 5, 6][s.dockLevel]) {
      return buy(() => expandDock(s, now), `dock${s.dockLevel + 1}`);
    }
    return buy(() => hireWorker(s, now), `worker${s.ownedWorkers + 1}`);
  };
  const rod = () => {
    const next = ['rod_fiberglass', 'rod_carbon', 'rod_pro', 'rod_ashgrove', 'rod_frostwind', 'rod_tideglass', 'rod_merelight']
      .find((id) => !s.ownedRods.includes(id));
    return next ? buy(() => upgradeRod(s, now, next), `rod-${next}`) : false;
  };
  const stall = () => buy(() => upgradeStall(s, now), `stall${s.stallLevel + 1}`);
  const training = () => buy(() => upgradeTraining(s, now), `training${s.trainingLevel + 1}`);
  const office = () => policy.contracts && buy(() => upgradeContractOffice(s, now), `office${s.officeLevel + 1}`);
  const bait = () => !s.ownedBaits.includes('bait_glow') &&
    buy(() => purchaseBait(s, now, 'bait_glow'), 'glow');

  const order = policy.priority === 'upgrades' ? [rod, stall, hire, training, bait, office]
    : policy.priority === 'collection' ? [bait, hire, rod, stall, training, office]
      : policy.contracts ? [hire, office, stall, rod, training, bait]
        : [hire, stall, rod, training, office, bait];
  for (let i = 0; i < 4; i += 1) {
    if (!order.some((action) => action())) break;
  }
  if (s.ownedBaits.includes('bait_glow')) {
    for (const worker of s.workers) if ((policy.priority === 'collection' || worker.id === 2) && worker.baitId !== 'bait_glow') {
      assignWorker(s, now, worker.id, { baitId: 'bait_glow' });
    }
  }
  if (policy.active > 0) {
    const latestWater = [...LOCATIONS].reverse().find((loc) => s.unlockedLocations.includes(loc.id));
    s.player.locationId = latestWater.id;
    s.player.baitId = s.ownedBaits.includes('bait_glow') && policy.priority === 'collection' ? 'bait_glow' : 'bait_worms';
  }
}

function contractDecision(s, now) {
  if (s.contract.accepted) return;
  if (!s.contract.available.length) generateContracts(s, now);
  if (s.officeLevel >= 2 && s.contract.accepted) return;
  const candidates = s.contract.available.filter((offer) => offer.kind !== 'source' || offer.source === 'worker');
  const offer = candidates.sort((a, b) => a.qty - b.qty)[0];
  if (offer) acceptContract(s, now, offer.id);
}

function handCast(s, now) {
  if (!startPlayerCast(s, now).ok) return;
  for (let stage = 0; stage < 3; stage += 1) submitPlayerInput(s, now + 600 + stage * 700, 0.8);
  settlePlayerCast(s, now + 2800);
}

function simulate(policy, seed = 42, hours = 12) {
  const s = createNewState(START, seed);
  const marks = {};
  const prestiges = [];
  let lastCoins = 0;
  for (let elapsed = policy.interval * MINUTE; elapsed <= hours * HOUR; elapsed += policy.interval * MINUTE) {
    const now = START + elapsed;
    advanceState(s, now);
    purchaseAndAssign(s, now, elapsed, policy, marks);
    if (policy.contracts) contractDecision(s, now);
    if (!s.event.activeId && now >= s.event.nextAt) {
      chooseEvent(s, now, policy.priority === 'collection' ? 'migration' : policy.contracts ? 'festival' : 'market');
    }
    for (let i = 0; i < policy.active * policy.interval / 60; i += 1) handCast(s, now + i * 3000);
    if (prestigeEligibility(s).eligible) {
      const result = performPrestige(s, now);
      if (result.ok) prestiges.push({ at: elapsed, count: result.count, destination: result.destination.location.name });
    }
    if (elapsed === HOUR) lastCoins = s.lifetimeCoins;
  }
  return { s, marks, prestiges, firstHourSales: lastCoins };
}

console.log('Gone Fishing balance study — 12 simulated hours, fixed seed 42; check-ins every 5 or 15 minutes');
console.log('Policy               Worker 3  River    Lake     Prestige 1  P2      P3      Species  Trophies  Contracts  Hand sales');
for (const policy of POLICIES) {
  const result = simulate(policy);
  const { s, marks, prestiges } = result;
  const fields = [
    policy.name.padEnd(20), fmt(marks.worker3).padEnd(9), fmt(marks.river).padEnd(8), fmt(marks.lake).padEnd(8),
    fmt(prestiges[0]?.at).padEnd(11), fmt(prestiges[1]?.at).padEnd(7), fmt(prestiges[2]?.at).padEnd(7),
    `${discoveredCount(s)}/${SPECIES.length}`.padEnd(8),
    `${Object.values(s.collection).filter((e) => e.trophies > 0).length}`.padEnd(9),
    `${s.contract.completed}`.padEnd(10), `${s.player.coins.toLocaleString()}`,
  ];
  console.log(fields.join(' '));
}

const representative = simulate(POLICIES[6]);
console.log('\nActive + contracts details:');
console.log(`First paid upgrade: ${fmt(Math.min(...Object.entries(representative.marks).filter(([name]) => name !== 'worker2').map(([, at]) => at)))}`);
console.log(`First-hour fish sales: ${representative.firstHourSales.toLocaleString()} coins`);
console.log(`Lifetime fish sales: ${representative.s.lifetimeCoins.toLocaleString()} coins; hand fishing: ${representative.s.player.coins.toLocaleString()} (${Math.round(100 * representative.s.player.coins / Math.max(1, representative.s.lifetimeCoins))}%)`);
console.log(`Completed contracts: ${representative.s.contract.completed}; bonuses: ${representative.s.contract.earnedCoins.toLocaleString()} coins`);
console.log(`Pond masteries: ${LOCATIONS.map((loc) => `${loc.name} ${locationMastery(representative.s, loc.id).caught}/5`).join(', ')}`);
console.log(`Prestiges: ${representative.prestiges.map((p) => `P${p.count} ${fmt(p.at)} ${p.destination}`).join(' · ') || 'none'}`);

const burstBase = simulate(POLICIES[1], 42, 1).s;
burstBase.event.activeId = null;
burstBase.player.locationId = [...LOCATIONS].reverse().find((loc) => burstBase.unlockedLocations.includes(loc.id)).id;
const idleBurst = structuredClone(burstBase);
const activeBurst = structuredClone(burstBase);
const burstEnd = START + 65 * MINUTE;
advanceState(idleBurst, burstEnd);
advanceState(activeBurst, burstEnd);
for (let i = 0; i < 30; i += 1) handCast(activeBurst, burstEnd + i * 10_000);
const workerFiveMin = idleBurst.lifetimeCoins - burstBase.lifetimeCoins;
const handFiveMin = activeBurst.lifetimeCoins - idleBurst.lifetimeCoins;
console.log(`Five-minute active burst after one hour: workers ${workerFiveMin.toLocaleString()} fish-sale coins; 30 hand casts add ${handFiveMin.toLocaleString()} (${Math.round(100 * handFiveMin / Math.max(1, workerFiveMin))}% extra).`);
