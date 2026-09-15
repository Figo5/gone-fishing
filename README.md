# Gone Fishing

A small, cozy idle fishing game. Plain HTML, CSS and JavaScript with ES modules — no
dependencies, no build step, no backend, no accounts. Saves live in `localStorage`;
progress keeps building for up to 8 hours while you are away.

![Gone Fishing at Willow River](docs/preview.png)

```
Choose a location and bait → start fishing → catches earn coins and fill the
collection → buy better tackle and unlock new water → chase rarer fish and bigger
trophies.
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
index.html          markup and panel containers
styles.css          palette, layout, scene styling
src/data.js         all content and tuning: species, rarity odds, weights, values, prices, modifiers
src/rng.js          seedable RNG with a serializable uint32 state
src/engine.js       the simulation: advanceState, catches, purchases, offline cap
src/save.js         serialization, strict import validation, localStorage access
src/scene.js        inline SVG fishing scene (one structure, three palettes)
src/ui.js           DOM helpers, header, cast bar, recent feed, away summary
src/panels.js       Collection and Tackle panels
src/main.js         wiring: ticker, tabs, actions, settings, single-writer lock
test/*.test.js      deterministic tests (engine, save/import, content invariants)
tools/simulate.mjs  fixed-seed balance simulation
```

## How the game plays

- **Casting is automatic.** One catch per cast cycle. Catches sell themselves; there is no
  inventory, no reeling, no missed bites, no bait to buy per cast and nothing to maintain.
- **Pause/Resume.** Paused time earns nothing and freezes cast progress where it stands.
- **Three locations, fifteen species.** Stillwater Pond (free) → Willow River → Moonlit Lake.
  Five species per location, always in the order Common, Uncommon, Rare, Epic, Legendary
  (58% / 28% / 10% / 3.5% / 0.5% base odds).
- **Four rods** (20s, 16s, 12s, 9s casts) and **three permanent baits**, each a one-time
  purchase. The Tackle panel prints the real numbers, for example:
  Minnows — "Cast time 16s → 18s (+15% slower)", "Median catch at 68% of the size range",
  "Same species odds as Worms". The Glow Lure shows its rarity shift per species tier.
  No bait is strictly better than Worms: only Worms keeps full cast speed.
- **Trophies** are fish at or above 90% of their species size range, not separate species.
  The collection permanently keeps catch counts, best weights and trophy counts, and shows a
  useful hint for fish you have not met yet.

## Save, offline progress and recovery

- Everything needed to resume is stored: schema version, coins, owned and selected gear,
  unlocks, fishing/paused state, fractional cast progress, collection records, lifetime
  statistics, the processed-time watermark and the RNG state.
- **One simulation for live and offline play.** Both go through `advanceState(state, now)`,
  which only uses timestamps — no DOM, no wall-clock waits. Because the RNG state is
  persisted, one batch of elapsed time produces exactly the same catches as many smaller
  batches from the same starting state.
- **Fractional cast progress survives saves and reloads.** A 40%-complete cast resumes at 40%.
- **Up to 8 hours of absence is credited per absence.** Anything beyond that is discarded and
  the watermark advances past it, so a second reload cannot replay the capped time. Nothing
  is ever awarded twice for the same timestamp, paused time is never credited, and a
  backward clock awards nothing and cannot move the watermark backward.
- **"While you were away"** appears after absences of a minute or more: time credited, fish
  caught, coins earned, new species and notable personal bests. Earnings are already applied
  and saved before it opens; closing or reopening it grants nothing.
- Saves happen after resolved catches (at most once per second), after every purchase or
  selection change, when the page is hidden and on `pagehide`.
- **Hidden tabs do no work.** The animation loop stops when the page is hidden; the game
  settles what was earned and saves, then catches up when the page returns.
- **Settings → Export Save** downloads a pretty-printed JSON backup; **Import Save** asks for
  confirmation before replacing progress, and **Reset Game** asks for confirmation with a
  working Cancel (Escape also cancels).
- **Imports are validated before anything changes.** Wrong schema version, unknown ids,
  non-finite numbers, negative balances, invalid equipment selections or a trophy count above
  the catch count are all rejected with a reason, leaving the current game untouched. An
  import replaces progress; it never adds to it.
- **Broken storage is handled without crashing.** A corrupt save is never silently erased: the
  raw text is copied to a `gone-fishing.corrupt.<time>` key, the game explains what happened and
  offers to download the unreadable file. If storage is unavailable, a banner says progress is
  not being saved.
- **One active tab.** Where the Web Locks API exists the first tab holds an exclusive write
  lock; other tabs open read-only with a warning instead of fighting over the save. In browsers
  without Web Locks the game falls back to a `localStorage` heartbeat, which is best-effort:
  two tabs opened in the same instant can both believe they are the writer. Sometimes a browser
  denies Web Locks in private windows — that is a limitation of the browser, not a hidden mode.

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
