> Historical implementation notes. See the [current README](../../README.md) for gameplay, content counts and the live game.

# HANDOFF — Gone Fishing (prestige + new ponds update)

Branch `gameplay/tycoon-active-fishing` (commit `9c4d82c` was the tycoon baseline; this update
sits on top). Not merged to `main`, not deployed to production; the update is pushed only to
update the open PR #1 preview.

## What changed

- **Prestige (schema v3).** Voluntary "move to a new pond" on its own tab. Requirements:
  run earnings ≥ threshold (250,000 base, +350,000 per prestige) **and** ≥ 4 workers. Reward:
  permanent multiplier `1 + 0.25 × prestigeCount`, applied exactly once to worker sales, manual
  sales and contract bonuses (contract rewards are stored unboosted; settlement applies the
  multiplier once). Unlocks Cedar Hollow (P1), Frostwater Basin (P2), Starlight Mere (P3); later
  prestiges settle on an unlocked pond and grant the next multiplier. Preserved: collection,
  lifetime records, unlocked waters, prestige count, tier access, pause flag. Reset: coins → 0,
  crew → one free worker at the destination pond, dock/stall/training/reels → level 1, rods/bait
  → starters, contract cleared. The transition is atomic (`performPrestige`), rechecks
  eligibility at confirm time, voids any unfinished hand cast without penalty, resets
  `processedAt` so no old absence can be replayed at the new multiplier, and starts the new run
  from a different RNG seed (no identical early sequence each run).
- **Three new ponds, fifteen new fish** (thirty total): Cedar Hollow (Pumpkinseed → Ember Pike),
  Frostwater Basin (Arctic Char → Aurora Trout), Starlight Mere (Glimmerdace → Mere Avatar).
  New scene palettes in the existing SVG system. Immediately playable with starter gear.
- **More upgrades:** 8 rods (4 prestige-tier), 5 stall levels (to ×1.45), 5 baits (Cedar
  Berries: bigger fish, near-full speed, flat rarity odds; Moonmote: best rarity odds, ×1.3
  cast), 3 crew-training levels (×0.92/×0.85/×0.78 cast time, floor 5s), 3 reel-control levels
  (target half-width 0.14→0.26). Prestige tiers gate availability; purchases stay in-run.
  The manual payout cap now scales with the water being fished, not always the pond.
- **Migration v2→v3** (and v1→v3): prestigeCount 0, multiplier 1, training/reel level 0;
  run earnings seeded from lifetimeCoins (the only trustworthy counter — never fabricated from
  wallet or purchases). Repeat-safe; imports replace state.

## Files

`src/data.js` (content + tuning), `src/engine.js` (simulation + prestige), `src/save.js`
(v3 validation + v2→v3), `src/prestige.js` (New Pond panel), `src/scene.js` (six palettes),
`src/panels.js` (gear gating + training/reel), plus prior files. Tests: `test/prestige.test.js`
(new), updated `test/{content,engine,save}.test.js`.

## Tests and results

```
npm test   # node --test test/*.test.js → tests 54, pass 54, fail 0
npm run simulate
```

New coverage: eligibility (both milestones, live state), spending does not undo run earnings,
threshold scaling, exact reset/preserve lists, unlock-once, duplicate-claim prevention,
additive multiplier across all three reward paths, no retroactive offline earnings after
prestige, manual-cast voiding, contract eligibility never references locked ponds, training/
reel purchases, post-prestige import, malformed v3 rejection, multi-worker determinism with
training + multiplier, v2→v3 migration and idempotency.

## Simulation (fixed seeds 1/42/90210, 24h horizon, 5-min check-ins)

- Idle-only (hire → dock → stall → training → rod → bait → river; no contracts, no hand casts):
  prestige 1 at ~115 min, prestige 2 at ~200 min, prestige 3 at ~260 min.
- Idle + contracts: ~110/195/250 min.
- Active (12 hand casts/h, quality 0.8) + contracts: ~110/190/240 min (48–49 casts).
- Assumptions: check-ins spend greedily but never prestige early; hand casts at 0.8 quality;
  no multi-tab or offline catch-up modeled. Earlier thresholds (150k/+125k) allowed reset chains
  within minutes and were rejected; 250k/+350k gives a first prestige in about two hours of
  ordinary play, with later runs still shorter in feel because the multiplier compounds.

## Browser verification (Chromium 153 headless over CDP)

Injected a played v2 save → migrated in place (coins/crew/dock/stall intact, prestige 0,
training/reel 0, run earnings seeded). Prestige panel shows destination, both requirement
progress bars, multiplier 1.00× → 1.25×, and the full reset/preserve disclosure. Confirm
disabled until eligible; with an eligibility fixture the dialog opens, **Cancel leaves the
game untouched**, and confirming performs prestige 1: coins 0, one worker at Cedar Hollow,
dock/stall reset, Cedar Hollow unlocked, collection and lifetime records kept, success banner.
A manual catch at the new pond (Redbreast Sunfish, new species) and tackle purchases work;
rebuild items are affordable again while prestige-tier gear shows "Needs prestige N". Reload
persists prestige 1; mobile 375px has no overflow with five tabs; no console errors.

Not verified: real background-tab throttling and Safari/Firefox (headless-only, same caveat as
before); the success banner copy was checked via DOM, not visually proofread at length.

## Known limitations / notes

- The fixture used in browser checks (topped-up run earnings + 4 workers) is test-side only;
  no debug panel ships.
- Later prestige cycles were modeled to prestige 3; the multiplier beyond x2.75 is untested
  territory for balance.
- Run-earnings seeding from lifetimeCoins may make a migrated veteran save prestige-ready
  almost immediately on first load; the 4-worker requirement is the throttle there. Players
  can simply not click the button.

## For the next agent

Prestige thresholds/prices live in `PRESTIGE`, `DOCK_LEVELS`, `STALL_LEVELS`, `TRAINING_LEVELS`,
`REEL_CONTROL_LEVELS`, `RODS`, `BAITS` in `src/data.js` — tune there, then `npm run simulate`.
`performPrestige` mutates the state object in place (single identity); keep that property if
you refactor. Save-id sets derive from content arrays, so new species/locations validate
automatically. Keep `advanceState` the only time path.
