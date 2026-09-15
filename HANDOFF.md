# HANDOFF — Gone Fishing (tycoon + active fishing update)

Branch `gameplay/tycoon-active-fishing` on top of `main` (`caecef0`). Not pushed, merged or
deployed. The previous release is the Netlify-deployed idle loop; this update adds a worker
business, an optional hands-on minigame, and contracts, in response to "all I can do is let
it sit."

## What changed

- **Business (schema v2).** Up to 6 workers, each with its own location, bait, RNG stream and
  fractional cast progress. Dock levels gate capacity (2→6); stall levels multiply all sales
  (1.0→1.3, three paid levels); rod upgrades are shared by every worker and the player. Worker 2
  is free; 3–6 cost coins. All prices/effects live in `src/data.js` (`HIRE_COSTS`, `DOCK_LEVELS`,
  `STALL_LEVELS`). The scene grows: extra stations per worker, longer dock, bigger stall, and
  labeled boats for workers fishing other waters.
- **Fish Yourself.** Cast → up to three reel-timing taps against a moving marker → catch settles
  once. Quality 0..1 per tap; missed taps or the "Take an ordinary fish" button settle at a fixed
  0.4 quality. Payouts are capped at 2× a worker's average catch (`PLAYER_CAST.valueCapWorkerCasts`)
  so perfect play ≈1.3× a worker per attempt and auto ≈0.9× — a boost, not a takeover. Separate
  player RNG stream; canceled casts (hide/pause/tab switch) drop safely with no penalty and no
  offline simulation of hand catches.
- **Contracts.** Board of three offers from unlocked content only (pond quantities, size hunts on
  common/uncommon fish, Uncommon/Rare-or-better). One accepted at a time, progress only from
  post-acceptance catches (workers or hand), bonus paid exactly once on top of normal sales,
  abandon without penalty, fresh board on demand — never auto-accepted while away.

## Files

`src/engine.js` (all simulation), `src/data.js` (all tuning), `src/save.js` (v1→v2 migration +
validation), `src/dock.js`, `src/fishing.js`, `src/scene.js` (growing dock), `src/ui.js`,
`src/panels.js`, `src/main.js`. Tests: `test/engine.test.js`, `test/save.test.js`,
`test/content.test.js`. Simulation: `tools/simulate.mjs`.

## Tests and results

```
npm test          # node --test test/*.test.js → tests 39, pass 39, fail 0
npm run simulate  # idle vs active policies over five seeds
```

New coverage: v1→v2 migration (coins/gear/collection preserved; fisher becomes worker 1 with the
same stream and fractional progress; `fishing` → pause; player/contracts start fresh; idempotent
re-import; backup written once; invalid v1 rejected), hire/capacity/affordability, assignments
across locations, no retroactive earnings on any purchase or assignment, batched vs incremental
multi-worker determinism (identical coins, per-worker catches/progress/streams), 8h cap across
workers, pause, backward clock, player settle exactly once + cancel safety + auto-settle floor,
contract eligibility/post-acceptance counting/one-time bonus, save/reload of contracts.

## Balance (measured, `npm run simulate`, 3h, five seeds)

Idle-only (policy: hire → dock → stall as affordable): reaches 6 workers/dock 4/stall 3 within
~1.5h, then ≈128k coins banked. Active 12 casts/h (perfect play) on top: ≈310k banked with
earlier bait/rod/location purchases. Active + contracts: ≈325k and contract 1 accepted in the
first seconds. So active play roughly doubles early income and speeds every purchase; idle-only
still completes the whole progression — nothing requires hand play. First purchase within
~2–4 min of active play; several choices and a visible dock change within 10–15 min.

## Verified in a real browser (Chromium 153 headless over CDP)

Five-minute fresh session: cast → reel ×3 → trophy Largemouth Bass 6.56 lb (new species) →
cast again → contract offers shown → accepted "0/8 · bonus 858" → purchased Hire worker 2
(free) → 90s of business income → pause froze coins exactly → reload restored 2 workers/
contract state. Screenshots in `.browser-check/`. Worker assignment change requires a second
location (correct on a fresh game; the select disables nothing but shows one option). Mobile
375px: no horizontal overflow. Reduced motion: marker hidden, every tap scores a fair hit.
Console: no errors in any run.

## Not verified / known issues

- Real background-tab throttling (headless Chrome does not background non-active targets; the
  visibility handler was exercised via a genuine `visibilitychange` event with `document.hidden`
  stubbed). Safari/Firefox untested.
- `window.__gfState`-style test hooks are not shipped; the browser harness mirrors saves via a
  `setItem` interceptor (test-side only).
- Player value cap scales from the pond's average even when fishing richer water — intentional
  (keeps early river trips strong but bounded), worth revisiting if hand-fishing the lake feels
  weak late-game.
- Contract "rarity" offers accept any location by design; the UI says so.

## For the next agent

Keep every random consumer on its own persisted stream (`worker.rngState`, `player.rngState`,
`contract.rngState`) and keep `advanceState` the only time path — batching determinism and the
offline cap are asserted by tests. Migrate schemas by adding a `validateV<n>` + `migrateV(n-1)→n`
pair in `save.js` and bumping `CURRENT_SCHEMA_VERSION`; the backup-once flag lives under
`gone-fishing.migrated.v3` style keys. Simulate before tuning prices: `npm run simulate`.
