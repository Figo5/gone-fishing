# Gone Fishing

A small, cozy idle fishing **tycoon with hands-on play**. Plain HTML, CSS and JavaScript with
ES modules — no dependencies, no build step, no backend, no accounts. Saves live in
`localStorage`; the business keeps earning for up to 8 hours while you are away, and you can
pick up a rod yourself whenever you feel like a 3–5 minute session.

![Gone Fishing at Willow River](docs/preview.png)

```
Hire workers for the dock → they fish their assigned waters automatically → fish the waters
yourself when you want to play → accept contracts that shape where everyone fishes → invest
the profits in more workers, a bigger dock, a better stall and faster rods.
```

## Run it

Start any static server from the project root (ES modules will not load over `file://`):

```bash
cd gone-fishing
python3 -m http.server 8080        # or: npm start
```

Then open <http://127.0.0.1:8080/>.

Any other static server works the same way, e.g. `npx serve .` or `php -S localhost:8080`.

## Test it

Pure game-logic tests on Node's built-in test runner (Node 24; no test framework installed):

```bash
npm test                           # same as: node --test test/*.test.js
```

## Look at the balance numbers (development only)

```bash
npm run simulate
```

Runs a greedy purchase policy against fixed seeds and prints coins per hour, expected value
per cast, the time to afford each upgrade, and a comparison of the three baits measured by
actually running the engine.

## Project layout

```
index.html          markup and panel containers (Dock, Fish Yourself, Collection, Tackle)
styles.css          palette, layout, scene styling, reel minigame, reduced-motion rules
src/data.js         all content and tuning: species, odds, weights, values, prices,
                    worker/dock/stall tables, player-cast curves, contract templates
src/rng.js          seedable RNG with a serializable uint32 state
src/engine.js       the simulation: per-worker cast loops, business investments,
                    player minigame, contracts, offline cap — all through advanceState
src/save.js         serialization, v1→v2 migration, strict validation, localStorage access
src/scene.js        inline SVG dock scene that grows with the business
src/ui.js           DOM helpers, header, recent feed, away summary
src/panels.js       Collection and Tackle panels
src/dock.js         Dock panel: workers, investments, contract board
src/fishing.js      Fish Yourself panel and reel-timing quality math
src/main.js         wiring: ticker, tabs, actions, settings, single-writer lock
test/*.test.js      deterministic tests (engine, save/migration, content invariants)
tools/simulate.mjs  fixed-seed balance simulation, idle vs active policies
```

## How the game plays

**The business (Dock tab).** You start with one worker at the pond and room for a second
(free). Every worker runs their own cast loop at their own assigned location and bait —
different workers can fish different waters at the same time. Investments compete for the same
coins: hire workers (worker 2 is free, 3–6 cost more), expand the dock (2→6 berths across four
expansions), upgrade the fish stall (three levels, up to ×1.3 on every sale), and buy rod
upgrades that are **shared across the whole operation** — one purchase speeds up every worker
*and* your own hand-fishing. Each worker shows an income estimate (labeled as an estimate;
luck moves it).

**Fish Yourself (tab two).** A short optional timing game, available immediately: cast, then
land three quick taps while a marker crosses a bright target zone. Better timing means a
heavier fish and a better price (capped so hired workers stay relevant). Miss the taps or press
"Take an ordinary fish" and you still sell a normal catch — dexterity never gates progression,
there is no bait cost and no limit. Every hand catch feeds the collection and contracts.
An 8–12 second attempt yields roughly a worker's catch value; a 3–5 minute session is a
meaningful boost without making the business pointless.

**Contracts (on the Dock).** The board shows three offers built only from content you have
unlocked — pond quantity orders, "specimen above X lb" hunts on easy fish, and Uncommon/
Rare-or-better orders. One accepted at a time; only catches made *after* accepting count;
workers and hand catches both fill it; normal sales still happen — the listed reward is an
**extra completion bonus paid once**. Abandon any time without penalty; a fresh board appears
when you want one, never automatically while away.

**Pause.** The header button pauses the business: workers stop, any in-progress hand cast is
canceled without penalty, and nothing earns until you resume. Contract offers and progress are
untouched. (Paused time earns nothing, and the 8-hour offline window only counts running time.)

**Collection and Tackle** remain fully available on their own tabs. Tackle explains who
benefits from each purchase.

- **Casting by workers is automatic.** One catch per cast cycle per worker. Catches sell
  themselves; there is no inventory, no reeling for workers, no wages, hunger, energy or
  repairs, and nothing to maintain.
- **Three locations, fifteen species.** Stillwater Pond (free) → Willow River → Moonlit Lake.
  Five species per location, always in the order Common, Uncommon, Rare, Epic, Legendary
  (58% / 28% / 10% / 3.5% / 0.5% base odds).
- **Trophies** are fish at or above 90% of their species size range, not separate species.
  The collection permanently keeps catch counts, best weights and trophy counts, and shows a
  useful hint for fish you have not met yet.

## Save, offline progress and recovery

- **Saves are schema-versioned.** Version 2 stores the business: coins, owned gear, unlocks,
  workers (each with its own location, bait, RNG stream and fractional cast progress), dock and
  stall levels, the player block, contracts, collection, lifetime records, the processed-time
  watermark, and a global pause flag.
- **Old saves migrate.** A v1 save is upgraded in place: coins, gear, unlocks, collection and
  lifetime records are preserved exactly; the old automatic fisher becomes Worker 1 on the same
  water with the same bait, continuing its saved RNG stream and fractional progress; the old
  `fishing` flag maps to the pause state; the player block and contracts start fresh (no
  invented history). A backup of the original save is written once, and migration is idempotent —
  importing a migrated save changes nothing. Invalid saves are rejected without touching the
  live game, and this holds for imports of old saves too.
- **One simulation for live and offline play.** Everything goes through `advanceState(state, now)`,
  which only uses timestamps — no DOM, no wall-clock waits. Every random consumer (each worker,
  the player, the contract board) has its own persisted RNG stream, and each worker persists
  fractional cast progress, so the same starting state and actions resolve identically whether
  elapsed time is processed in one batch or a hundred.
- **Up to 8 hours of absence is credited per absence, across all workers.** Anything beyond that
  is discarded and the watermark advances past it, so a second reload cannot replay the capped
  time. Nothing is ever awarded twice for the same timestamp, paused time is never credited, and
  a backward clock awards nothing and cannot move the watermark backward.
- **"While you were away"** appears after absences of a minute or more: time credited, fish
  caught, coins earned, new species and notable personal bests. Earnings are already applied and
  saved before it opens; closing or reopening it grants nothing. Player minigames are never
  simulated offline — an unfinished hand cast is simply dropped.
- Saves happen after resolved catches (at most once per second), after every purchase,
  assignment or contract action, when the page is hidden and on `pagehide`.
- **Hidden tabs do no work.** The animation loop stops when the page is hidden; the game
  settles what was earned, cancels any in-progress hand cast without penalty, and catches up
  when the page returns.
- **Settings → Export Save** downloads a pretty-printed JSON backup; **Import Save** asks for
  confirmation before replacing progress, and **Reset Game** asks for confirmation with a
  working Cancel (Escape also cancels).
- **Imports are validated before anything changes** — wrong schema version, unknown ids,
  non-finite numbers, negative balances, six-worker limit, contract shape, and more. An import
  replaces progress; it never adds to it.
- **Broken storage is handled without crashing.** A corrupt save is never silently erased: the
  raw text is copied to a `gone-fishing.corrupt.<time>` key, the game explains what happened and
  offers to download the unreadable file. If storage is unavailable, a banner says progress is
  not being saved.
- **One active tab.** Where the Web Locks API exists the first tab holds an exclusive write
  lock; other tabs open read-only with a warning. Without Web Locks the game falls back to a
  `localStorage` heartbeat, which is best-effort and documented as such.

## Accessibility and comfort

Keyboard focus is always visible, every control has a readable name, the cast bar is a real
`progressbar` with live values, the tab buttons expose `aria-selected`, and rarity is written
out as text as well as colour-coded. `prefers-reduced-motion` turns off the bobber, ripple and
cloud motion. There is no sound and no popups that block play. The layout is usable at 375px
wide and uses the space well on desktop without stretching.

## Deliberately not included

No multiplayer, leaderboards, accounts, premium shop, real-money economy, daily rewards,
streaks, quests, weather, prestige, skill trees, aquariums, service worker/PWA, analytics,
deployment or any runtime AI call.
