/**
 * Serializable pseudo-random generator (mulberry32).
 * State is a single uint32 so it round-trips through JSON exactly, which is what
 * makes batched and incremental simulation produce identical catches.
 */

export const RNG_MAX = 0xffffffff;

export function createRngState(seed) {
  const s = Number.isFinite(seed) ? Math.floor(seed) : 0;
  return (s >>> 0) || 1;
}

/** Advance one step: returns { state, value } where value is a float in [0, 1). */
export function rngStep(state) {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: next, value };
}

export function isValidRngState(value) {
  return Number.isInteger(value) && value >= 0 && value <= RNG_MAX;
}

export function seedFromTime(now) {
  return createRngState(Math.floor(now) ^ 0x9e3779b9);
}