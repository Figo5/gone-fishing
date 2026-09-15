/**
 * Gone Fishing — content data and pure content math.
 * Everything tunable lives here: probabilities, values, weight ranges, prices, modifiers.
 */

export const SCHEMA_VERSION = 1;

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY_LABEL = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/** Base rarity distribution, must sum to 1. */
export const BASE_RARITY_WEIGHTS = {
  common: 0.58,
  uncommon: 0.28,
  rare: 0.1,
  epic: 0.035,
  legendary: 0.005,
};

/** A trophy is a specimen at or above this fraction of its species size range. */
export const TROPHY_RATIO = 0.9;

export const RECENT_LIMIT = 10;
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
/** Absences at least this long produce a "While you were away" summary. */
export const AWAY_THRESHOLD_MS = 60 * 1000;
export const STARTING_COINS = 0;
export const AWAY_CAP_HOURS = OFFLINE_CAP_MS / 3600000;

export const LOCATIONS = [
  {
    id: 'loc_pond',
    name: 'Stillwater Pond',
    cost: 0,
    blurb: 'Warm shallows, lily pads and easy fishing.',
    scene: 'pond',
  },
  {
    id: 'loc_river',
    name: 'Willow River',
    cost: 3500,
    blurb: 'Fast current and colder water. Bigger, stronger fish.',
    scene: 'river',
  },
  {
    id: 'loc_lake',
    name: 'Moonlit Lake',
    cost: 60000,
    blurb: 'Deep night water where the rare ones live.',
    scene: 'lake',
  },
  {
    id: 'loc_cedar',
    name: 'Cedar Hollow',
    cost: 0,
    prestige: 1,
    blurb: 'A warm woodland pond that hums with dragonflies. The prestige route.',
    scene: 'cedar',
  },
  {
    id: 'loc_frost',
    name: 'Frostwater Basin',
    cost: 0,
    prestige: 2,
    blurb: 'A cold alpine fishery where the water glitters like broken glass.',
    scene: 'frost',
  },
  {
    id: 'loc_mere',
    name: 'Starlight Mere',
    cost: 0,
    prestige: 3,
    blurb: 'A luminous night pond. The fish here glow faintly, like held breath.',
    scene: 'mere',
  },
];

/** Prestige earnings milestone (run earnings, coins). Scales with prestige count. */
export const PRESTIGE = {
  /** runEarnings needed to prestige: base + growth * prestigeCount. */
  baseThreshold: 250000,
  thresholdGrowth: 350000,
  /** Minimum owned workers to be eligible. */
  minWorkers: 4,
  /** Permanent multiplier: 1 + coefficient * prestigeCount. */
  multCoefficient: 0.25,
  maxWorkers: 6,
};

/** The three prestige ponds unlock at these prestige counts (and their cost is 0). */
export const PRESTIGE_POND_UNLOCK = { loc_cedar: 1, loc_frost: 2, loc_mere: 3 };

/**
 * Five species per location, in listing order:
 * Common, Uncommon, Rare, Epic, Legendary.
 * weights are pounds. baseValue is the coin value of an average-sized fish;
 * actual value scales up with size.
 */
export const SPECIES = [
  // Stillwater Pond
  {
    id: 'sp_bluegill', name: 'Bluegill', rarity: 'common', locationId: 'loc_pond',
    minWeight: 0.1, maxWeight: 1.2, baseValue: 14,
    hint: 'Nibbles anything. Hangs around the lily pads.',
  },
  {
    id: 'sp_yellowperch', name: 'Yellow Perch', rarity: 'uncommon', locationId: 'loc_pond',
    minWeight: 0.3, maxWeight: 2.5, baseValue: 30,
    hint: 'Striped and schooling, a little deeper than the shallows.',
  },
  {
    id: 'sp_largemouth', name: 'Largemouth Bass', rarity: 'rare', locationId: 'loc_pond',
    minWeight: 1, maxWeight: 9, baseValue: 95,
    hint: 'Ambushes near the weed line when the light drops.',
  },
  {
    id: 'sp_carp', name: 'Mirror Carp', rarity: 'epic', locationId: 'loc_pond',
    minWeight: 3, maxWeight: 22, baseValue: 260,
    hint: 'Heavy, slow and partial to the muddy bottom.',
  },
  {
    id: 'sp_koi', name: 'Golden Koi', rarity: 'legendary', locationId: 'loc_pond',
    minWeight: 2, maxWeight: 15, baseValue: 1400,
    hint: 'A pond legend. Ornamental, old, and rarely hungry.',
  },

  // Willow River
  {
    id: 'sp_creekchub', name: 'Creek Chub', rarity: 'common', locationId: 'loc_river',
    minWeight: 0.2, maxWeight: 1.5, baseValue: 30,
    hint: 'Everywhere in the riffles.',
  },
  {
    id: 'sp_rainbowtrout', name: 'Rainbow Trout', rarity: 'uncommon', locationId: 'loc_river',
    minWeight: 0.5, maxWeight: 6, baseValue: 70,
    hint: 'Holds in the cold oxygenated seams of the current.',
  },
  {
    id: 'sp_smallmouth', name: 'Smallmouth Bass', rarity: 'rare', locationId: 'loc_river',
    minWeight: 1, maxWeight: 8, baseValue: 210,
    hint: 'Fights hard around submerged rock.',
  },
  {
    id: 'sp_pike', name: 'Northern Pike', rarity: 'epic', locationId: 'loc_river',
    minWeight: 3, maxWeight: 25, baseValue: 620,
    hint: 'A long ambush predator in the slow water near the bank.',
  },
  {
    id: 'sp_sturgeon', name: 'Ghost Sturgeon', rarity: 'legendary', locationId: 'loc_river',
    minWeight: 10, maxWeight: 120, baseValue: 3200,
    hint: 'Fictional. Pale, ancient, and barely moves until it does.',
  },

  // Moonlit Lake
  {
    id: 'sp_crappie', name: 'Black Crappie', rarity: 'common', locationId: 'loc_lake',
    minWeight: 0.5, maxWeight: 3, baseValue: 60,
    hint: 'Suspended in schools over deep structure.',
  },
  {
    id: 'sp_walleye', name: 'Walleye', rarity: 'uncommon', locationId: 'loc_lake',
    minWeight: 1, maxWeight: 12, baseValue: 150,
    hint: 'Feeds on the edges of the dark.',
  },
  {
    id: 'sp_catfish', name: 'Channel Catfish', rarity: 'rare', locationId: 'loc_lake',
    minWeight: 3, maxWeight: 45, baseValue: 430,
    hint: 'Bottom feeder. Follows scent more than sight.',
  },
  {
    id: 'sp_laketrout', name: 'Lake Trout', rarity: 'epic', locationId: 'loc_lake',
    minWeight: 5, maxWeight: 50, baseValue: 1250,
    hint: 'Deep, cold, slow-growing and enormous.',
  },
  {
    id: 'sp_moonfin', name: 'Moonfin', rarity: 'legendary', locationId: 'loc_lake',
    minWeight: 8, maxWeight: 90, baseValue: 6500,
    hint: 'Fictional. Surfaces only in still, moonlit water.',
  },

  // Cedar Hollow (prestige 1) — warm woodland pond
  {
    id: 'sp_pumpkinseed', name: 'Pumpkinseed', rarity: 'common', locationId: 'loc_cedar',
    minWeight: 0.1, maxWeight: 1.1, baseValue: 90,
    hint: 'Bright as a dropped coin among the cedar roots.',
  },
  {
    id: 'sp_redbreast', name: 'Redbreast Sunfish', rarity: 'uncommon', locationId: 'loc_cedar',
    minWeight: 0.3, maxWeight: 2.2, baseValue: 200,
    hint: 'Guards its shallows jealously. Strike while the dragonflies hover.',
  },
  {
    id: 'sp_warmpouth', name: 'Warmouth', rarity: 'rare', locationId: 'loc_cedar',
    minWeight: 0.5, maxWeight: 4, baseValue: 560,
    hint: 'Lurks under sunken limbs. All mouth, all patience.',
  },
  {
    id: 'sp_bowfin', name: 'Bowfin', rarity: 'epic', locationId: 'loc_cedar',
    minWeight: 4, maxWeight: 21, baseValue: 1600,
    hint: 'A living fossil that prefers the warm, weedy margins.',
  },
  {
    id: 'sp_emberpike', name: 'Ember Pike', rarity: 'legendary', locationId: 'loc_cedar',
    minWeight: 9, maxWeight: 60, baseValue: 9500,
    hint: 'Fictional. Its scales hold the last light of the sunset.',
  },

  // Frostwater Basin (prestige 2) — cold alpine fishery
  {
    id: 'sp_arcticchar', name: 'Arctic Char', rarity: 'common', locationId: 'loc_frost',
    minWeight: 0.6, maxWeight: 4.5, baseValue: 320,
    hint: 'Comfortable in water that would ache your hands.',
  },
  {
    id: 'sp_grayling', name: 'Grayling', rarity: 'uncommon', locationId: 'loc_frost',
    minWeight: 0.8, maxWeight: 5, baseValue: 700,
    hint: 'Its sail fin cuts the surface like a knife tip.',
  },
  {
    id: 'sp_bulltrout', name: 'Bull Trout', rarity: 'rare', locationId: 'loc_frost',
    minWeight: 2, maxWeight: 14, baseValue: 1900,
    hint: 'A loner of the deep drop-offs. Rarely the first to bite.',
  },
  {
    id: 'sp_glacierchar', name: 'Glacier Char', rarity: 'epic', locationId: 'loc_frost',
    minWeight: 6, maxWeight: 30, baseValue: 5200,
    hint: 'Fictional. Cold-blooded enough to ignore the ice.',
  },
  {
    id: 'sp_auroratrout', name: 'Aurora Trout', rarity: 'legendary', locationId: 'loc_frost',
    minWeight: 12, maxWeight: 70, baseValue: 14000,
    hint: 'Fictional. Said to carry the northern lights in its flanks.',
  },

  // Starlight Mere (prestige 3) — luminous night pond
  {
    id: 'sp_glimmerdace', name: 'Glimmerdace', rarity: 'common', locationId: 'loc_mere',
    minWeight: 0.2, maxWeight: 1.4, baseValue: 900,
    hint: 'Fictional. Darts in silver flickers beneath the mere.',
  },
  {
    id: 'sp_lanternperch', name: 'Lantern Perch', rarity: 'uncommon', locationId: 'loc_mere',
    minWeight: 0.7, maxWeight: 4, baseValue: 2100,
    hint: 'Fictional. Its fin-lamp dims when it senses a hook.',
  },
  {
    id: 'sp_starwhisker', name: 'Starwhisker Catfish', rarity: 'rare', locationId: 'loc_mere',
    minWeight: 3, maxWeight: 20, baseValue: 5600,
    hint: 'Fictional. Feeds on fallen starlight along the bottom.',
  },
  {
    id: 'sp_cometkoi', name: 'Comet Koi', rarity: 'epic', locationId: 'loc_mere',
    minWeight: 6, maxWeight: 34, baseValue: 15000,
    hint: 'Fictional. Leaves a fading tail of light when it turns.',
  },
  {
    id: 'sp_mereavatar', name: 'Mere Avatar', rarity: 'legendary', locationId: 'loc_mere',
    minWeight: 15, maxWeight: 110, baseValue: 42000,
    hint: 'Fictional. The mere itself, briefly wearing a fish.',
  },
];

export const RODS = [
  { id: 'rod_bamboo', name: 'Bamboo Pole', cost: 0, castSeconds: 20, blurb: 'The starter pole. Slow, but it always casts.' },
  { id: 'rod_fiberglass', name: 'Fiberglass Rod', cost: 900, castSeconds: 16, blurb: 'Lighter tip, quicker casts.' },
  { id: 'rod_carbon', name: 'Carbon Spinning Rod', cost: 1800, castSeconds: 12, blurb: 'Fast, sensitive, good for river current.' },
  { id: 'rod_ashgrove', name: 'Ashgrove Rod', cost: 6500, castSeconds: 10, blurb: 'Cedar-cured and balanced for long woodland sessions.', prestige: 1 },
  { id: 'rod_pro', name: 'Pro Tournament Rod', cost: 12000, castSeconds: 9, blurb: 'The tournament standard. Fast and unforgiving.' },
  { id: 'rod_frostwind', name: 'Frostwind Rod', cost: 30000, castSeconds: 8, blurb: 'Built for alpine gusts; hardly flexes at all.', prestige: 2 },
  { id: 'rod_tideglass', name: 'Tideglass Rod', cost: 75000, castSeconds: 7, blurb: 'A crystalline blank that hums on the drop.', prestige: 2 },
  { id: 'rod_merelight', name: 'Merelight Rod', cost: 190000, castSeconds: 6, blurb: 'Rods woven from mere-light. The fastest casts in the game.', prestige: 3 },
];

/** Floor on cast duration so speed upgrades cannot make timing meaningless. */
export const MIN_CAST_MS = 5000;

/**
 * Bait tradeoffs are real: only Worms keeps full cast speed.
 *  castMult  — multiplier on cast duration (>1 is slower)
 *  sizeBias  — exponent < 1 on the uniform size roll; pushes weights toward the top of the range
 *  rarity    — multipliers applied to BASE_RARITY_WEIGHTS, then renormalized
 *  prestige  — unlock tier; omitted or 0 means available from prestige zero
 */
export const BAITS = [
  {
    id: 'bait_worms', name: 'Worms', cost: 0, castMult: 1, sizeBias: 1, rarity: null,
    blurb: 'Free forever. Full cast speed with a flat, balanced size roll.',
  },
  {
    id: 'bait_minnows', name: 'Minnows', cost: 1200, castMult: 1.15, sizeBias: 1.8, rarity: null,
    blurb: 'Only big fish take a minnow: much better trophy and personal-best odds, slightly fewer casts.',
  },
  {
    id: 'bait_glow', name: 'Glow Lure', cost: 3500, castMult: 1.4, sizeBias: 0.85,
    rarity: { common: 0.55, uncommon: 1, rare: 1.8, epic: 2.2, legendary: 2.5 },
    blurb: 'Draws rarer species far more often, but the rig is slow to cast and the big ones ignore it.',
  },
  {
    id: 'bait_berries', name: 'Cedar Berries', cost: 14000, castMult: 1.1, sizeBias: 1.25,
    prestige: 1,
    blurb: 'Woodland bait: bigger fish than Worms with almost no speed lost, but rarity odds stay flat.',
  },
  {
    id: 'bait_moonmote', name: 'Moonmote', cost: 120000, castMult: 1.3, sizeBias: 0.9,
    rarity: { common: 0.45, uncommon: 1.2, rare: 1.9, epic: 2.6, legendary: 3.2 },
    prestige: 3,
    blurb: 'A mote of mere-light. Even better rarity odds than the Glow Lure and gentler on speed — the pride of the tackle box.',
  },
];

/** Crew training: modest, permanent-for-the-run improvements to automatic cast speed. */
export const TRAINING_LEVELS = [
  { mult: 1, cost: 0, name: 'Green Crew' },
  { mult: 0.92, cost: 4500, name: 'Drilled Crew' },
  { mult: 0.85, cost: 18000, name: 'Veteran Crew' },
  { mult: 0.78, cost: 60000, name: 'Elite Crew' },
];

/** Reel control: widens the manual timing target (permanent for the run). */
export const REEL_CONTROL_LEVELS = [
  { halfWidth: 0.14, cost: 0, name: 'Bare Hands' },
  { halfWidth: 0.18, cost: 3000, name: 'Padded Grip' },
  { halfWidth: 0.22, cost: 12000, name: 'Machined Reel' },
  { halfWidth: 0.26, cost: 45000, name: 'Mere-Tuned Reel' },
];

export const DEFAULT_SETUP = { locationId: 'loc_pond', rodId: 'rod_bamboo', baitId: 'bait_worms' };

/* ------------------------------------------------------------------ *
 * Tycoon economy (schema v2). All prices and effects live here.        *
 * ------------------------------------------------------------------ */

/** Hire costs indexed by the worker's number: worker 1 and 2 are free, 3..6 cost coins. */
export const HIRE_COSTS = [0, 0, 0, 900, 2600, 7000, 18000];

/** Dock expansions. dockLevel i allows capacity CAPACITIES[i]; level 0 fits two workers. */
export const DOCK_LEVELS = [
  { capacity: 2, cost: 0, name: 'Old Jetty' },
  { capacity: 3, cost: 1500, name: 'Reinforced Jetty' },
  { capacity: 4, cost: 6000, name: 'Wooden Dock' },
  { capacity: 5, cost: 16000, name: 'Long Dock' },
  { capacity: 6, cost: 40000, name: 'Fishing Wharf' },
];

/** Fish stall levels: finite, modest sale-value improvements on every catch. */
export const STALL_LEVELS = [
  { mult: 1, cost: 0, name: 'Crate on a Barrel' },
  { mult: 1.1, cost: 1200, name: 'Proper Fish Stall' },
  { mult: 1.2, cost: 5000, name: 'Iced Display Stall' },
  { mult: 1.3, cost: 15000, name: 'Dockside Market' },
  { mult: 1.45, cost: 80000, name: 'Lakeside Emporium' },
];

/** Player fishing: marker sweep per reel stage and the quality bonus curves. */
export const PLAYER_CAST = {
  stages: 3,
  sweepMs: 1700,
  center: 0.5, // target-zone centre on the marker track (fraction)
  halfWidth: 0.14, // half-width of the target zone; inside = hit
  /** Sale-value multiplier from average input quality, 0 (all misses) .. 1 (all perfect). */
  valueBonus: (q) => 1 + 0.6 * q,
  /** Size multiplier from average input quality (feeds records and trophies). */
  sizeBonus: (q) => 1 + 0.35 * q,
  /** Hard cap on a player catch's stall value, in worker-average catches at the pond.
   *  Keeps hands-on play a strong boost (≈2 workers' worth per attempt) without making
   *  hired workers irrelevant at endgame. */
  valueCapWorkerCasts: 2,
  /** Quality credited when the player never taps (accessible route / abandoned). */
  idleQuality: 0.4,
  /** Marker sweep speed if the game runs on rAF time rather than wall clock. */
  markerLoops: 1,
};

/** Contract templates. A generated contract stores template + concrete params. */
export const CONTRACT_TEMPLATES = [
  { id: 'qty_location', kind: 'qty', label: 'Stock the stall' },
  { id: 'size_location', kind: 'size', label: 'Specimen hunt' },
  { id: 'rarity_any', kind: 'rarity', label: 'Quality order' },
];

export const CONTRACT_REWARD_MULT = 9; // reward ≈ 9× a typical catch's value, scaled by effort

const SPECIES_BY_ID = new Map(SPECIES.map((s) => [s.id, s]));
const ROD_BY_ID = new Map(RODS.map((r) => [r.id, r]));
const BAIT_BY_ID = new Map(BAITS.map((b) => [b.id, b]));
const LOCATION_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));

export const getSpecies = (id) => SPECIES_BY_ID.get(id) || null;
export const getRod = (id) => ROD_BY_ID.get(id) || null;
export const getBait = (id) => BAIT_BY_ID.get(id) || null;
export const getLocation = (id) => LOCATION_BY_ID.get(id) || null;

export function speciesByLocation(locationId) {
  return SPECIES.filter((s) => s.locationId === locationId);
}

/** Fraction of the species size range that a weight occupies, clamped to [0,1]. */
export function sizeRatio(species, weight) {
  const span = species.maxWeight - species.minWeight;
  if (!(span > 0)) return 0;
  const r = (weight - species.minWeight) / span;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

export function trophyThreshold(species) {
  return species.minWeight + TROPHY_RATIO * (species.maxWeight - species.minWeight);
}

export function isTrophy(species, weight) {
  return weight >= trophyThreshold(species);
}

/** Integer coin value of a catch: average fish = baseValue, biggest fish = 2.2x baseValue. */
export function coinsForCatch(species, weight) {
  const value = species.baseValue * (1 + 1.2 * sizeRatio(species, weight));
  return Math.max(1, Math.round(value));
}

/** Normalized rarity probabilities for a species list under a given bait. */
export function rarityDistribution(speciesList, bait) {
  const mult = (bait && bait.rarity) || null;
  const out = [];
  let total = 0;
  for (const rarity of RARITY_ORDER) {
    const raw = (BASE_RARITY_WEIGHTS[rarity] || 0) * (mult ? (mult[rarity] || 0) : 1);
    out.push({ rarity, weight: raw });
    total += raw;
  }
  if (!(total > 0)) return out.map((o) => ({ rarity: o.rarity, probability: 0 }));
  return out.map((o) => ({ rarity: o.rarity, probability: o.weight / total }));
}

/** Per-species probability table for a location under a bait. */
export function speciesDistribution(speciesList, bait) {
  const dist = rarityDistribution(speciesList, bait);
  const byRarity = new Map(dist.map((d) => [d.rarity, d.probability]));
  const rows = [];
  let total = 0;
  for (const species of speciesList) {
    const inRarity = speciesList.filter((s) => s.rarity === species.rarity).length || 1;
    const p = (byRarity.get(species.rarity) || 0) / inRarity;
    rows.push({ species, probability: p });
    total += p;
  }
  if (total > 0) for (const row of rows) row.probability /= total;
  return rows;
}

/** The uniform size roll is u ** (1 / sizeBias); report where the median lands. */
export function medianSizeFraction(bait) {
  const bias = (bait && bait.sizeBias) || 1;
  if (bias === 1) return 0.5;
  return Math.pow(0.5, 1 / bias);
}

export function castDurationMs(rod, bait) {
  const seconds = (rod ? rod.castSeconds : 20) * ((bait && bait.castMult) || 1);
  return Math.round(seconds * 1000);
}

/** Roll a weight (lb) for a species from a uniform draw. */
export function rollWeight(species, uni, bias) {
  const b = bias || 1;
  const t = b === 1 ? uni : Math.pow(uni, 1 / b);
  return species.minWeight + (species.maxWeight - species.minWeight) * t;
}