# HANDOFF — Gone Fishing

`~/gone-fishing` (isolated; the home directory is not a git repo and nothing else was touched).
Status: complete and playable. Nothing was committed, pushed or deployed.

## Implemented

Everything in the brief: one-button automatic fishing that sells catches itself; 3 locations
× 5 species in Common→Legendary order (base 58/28/10/3.5/0.5, renormalized after bait
modifiers); 4 rods (20/16/12/9s); 3 one-time baits with printed tradeoffs; permanent collection
with catch counts, best weights, trophy counts (≥90% of range) and hints for undiscovered fish;
coins only; pause/resume; "While you were away" summary; JSON export/import with strict
validation; reset with a working Cancel; corrupt-save preservation; single-writer tab lock.
Live and offline play share one DOM-free path, `advanceState(state, now)` in `src/engine.js`, so
batched and incremental time produce identical catches.

## File map

`index.html`, `styles.css` · `src/data.js` (all tuning) · `src/rng.js` · `src/engine.js` ·
`src/save.js` · `src/scene.js` · `src/ui.js` · `src/panels.js` · `src/main.js` ·
`test/{engine,save,content}.test.js` · `tools/simulate.mjs`

## Tests and results

```
cd ~/gone-fishing && npm test     # node --test test/*.test.js  →  tests 29, pass 29, fail 0
npm run simulate                  # fixed-seed balance table
```

Covers: correct coin value per catch; partial progress survives serialization; the same timestamp
twice awards nothing; batched vs incremental agreement (120 steps vs one batch: identical coins,
RNG, progress, recent feed); a 20h absence credits exactly 8h once and never replays; paused time
earns nothing; backward clock awards nothing; setup changes never apply retroactively;
affordability, ownership and auto-equip; species rolls stay inside the selected location under all
baits; collection totals, bests and trophies match the catch log; trophy ⇒ best ≥ threshold;
16 malformed imports leave the live state unchanged; corrupt saves are preserved, not erased.

## Balance and observations

Time to afford (cheapest-first greedy policy, 5 seeds): Fiberglass Rod (900) 2m20s–9m;
Willow River (3500) 18m–37m; Moonlit Lake (60000) 1h20m–1h44m — targets 3–5 min, 20–40 min,
1–3 h. Bait tradeoffs, measured by running the engine 3h at the pond: Worms 10,271 coins/h with
10.7% of casts trophies; Minnows 9,929 coins/h, 20.5% trophies, median catch at 68% of the range
(records bait, ≈3% income cost); Glow Lure 13,808 coins/h, 8.8% trophies, ~2.9× legendary odds
(faster collection, worse records, 40% fewer casts). Simulation forced two fixes: the Glow Lure
originally doubled Worms' income (now milder rarity multipliers plus a downward size bias), and
Minnows originally cost ~11% income.

Caveat: species *discovery* is faster than "several sessions" — 14–15/15 appear within ~3h of
play; the long tail is trophies and best weights. Left deliberately, since tightening it means
altering the 0.5% legendary odds the brief specified.

## Verified in a real browser

Chromium 153 headless over CDP (the Hermes browser tool blocks loopback URLs); screenshots in
`.browser-check/`. A new player starts at 0 coins, 0/15, "Start Fishing", Bamboo Pole · Worms ·
20s cast, and gets a first catch ~20s after one click with no repeat clicking. Pause freezes
coins and progress; resume earns. Shops gate by affordability and auto-equip; a location unlock
switches scene and keeps old records. A 3h absence credited 540 fish / 33,012 coins, listing new
species and records; a 20h absence credited exactly 8h / 1,440 fish and reported 12h discarded;
immediate reload after either credits nothing more; paused absence credits nothing. Export wrote
a real JSON file; an invalid import was rejected with no state change; a valid import asked
first, with Cancel, Escape and Confirm all correct; reset Cancel/Confirm both correct. A second
tab opened read-only with a warning while the first kept writing. Zero animation frames while
the page reported hidden, with the gap credited on return. 375px has no horizontal overflow;
desktop caps at 960px in two columns; contrast 9.0:1 (hints) to 13.4:1 (names); no console
errors in any run.

Unverified: real background-tab throttling (headless Chrome does not background non-active
targets, so the handler was exercised by dispatching a genuine `visibilitychange` with
`document.hidden` stubbed); a hand-driven file picker (driven via `DOM.setFileInputFiles`);
Safari/Firefox rendering; the `localStorage` heartbeat fallback.

## Known rough edges

- Minnows and the Glow Lure equip the moment they are bought, so cast time changes immediately —
  old-rate time is always settled first, so nothing is retroactive.
- Weights and thresholds are displayed rounded: a best exactly at the bar can render as 20.1 lb
  beside a 20.1 lb threshold (equal internally).
- `.browser-check/` holds validation screenshots and is disposable.

## For the next agent

Keep `advanceState` DOM-free and timestamp-driven; the offline guarantee and several tests
depend on it. Never persist time without moving `processedAt` forward. When testing offline
behavior over CDP, block the live tab's `localStorage.setItem` first — otherwise it overwrites
an injected save within a second and again on `pagehide`.
