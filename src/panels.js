/**
 * Gone Fishing — Collection and Tackle panels.
 * Tackle now sells shared rod upgrades (they speed up every worker and the player),
 * plus player bait/location choices for hand-fishing.
 */

import {
  BAITS,
  LOCATIONS,
  LOCATION_CAST_MULT,
  REEL_CONTROL_LEVELS,
  TRAINING_LEVELS,
  RARITY_LABEL,
  RODS,
  SPECIES,
  castDurationMs,
  conditionAt,
  getBait,
  getSpecies,
  speciesByLocation,
  trophyThreshold,
} from './data.js';
import {
  collectionEntry,
  currentCastDurationMs,
  discoveredCountFor,
  locationMastery,
  stallValue,
} from './engine.js';
import { els, formatCoins, formatWeight, formatDuration, nf } from './ui.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FISH_ART = { common: '🐟', uncommon: '🐠', rare: '🐡', epic: '🦈', legendary: '✦' };

/* ------------------------------------------------------------- collection */

export function renderCollection(state) {
  const found = Object.keys(state.collection).filter((id) => state.collection[id].catches > 0).length;
  const trophies = Object.values(state.collection).reduce((sum, e) => sum + (e.trophies || 0), 0);
  els.collectionSummary.textContent = `${found}/${SPECIES.length} species discovered · ${nf.format(trophies)} ${trophies === 1 ? 'trophy' : 'trophies'} landed`;

  els.collectionBody.innerHTML = LOCATIONS.map((location) => {
    const species = speciesByLocation(location.id);
    const unlocked = state.unlockedLocations.includes(location.id);
    const foundHere = discoveredCountFor(state, location.id);
    const mastery = locationMastery(state, location.id);
    const cards = species.map((fish) => {
      const entry = collectionEntry(state, fish.id);
      const known = entry.catches > 0;
      const threshold = trophyThreshold(fish);
      const name = known ? escape(fish.name) : '???';
      const hint = known
        ? `Range ${formatWeight(fish.minWeight)} – ${formatWeight(fish.maxWeight)} · Trophies from ${formatWeight(threshold)}`
        : escape(fish.hint);
      return `
        <article class="card rarity-${fish.rarity}${known ? '' : ' unknown'}">
          <div class="card-title">
            <span class="card-name">${name}</span>
            ${known ? `<span class="fish-art" aria-hidden="true">${FISH_ART[fish.rarity]}</span>` : ''}
          </div>
          <span class="rarity-label">${RARITY_LABEL[fish.rarity]}</span>
          ${known
            ? `<dl>
                 <dt>Caught</dt><dd>${nf.format(entry.catches)}</dd>
                 <dt>Best</dt><dd>${formatWeight(entry.bestWeight)}</dd>
                 <dt>Best sale</dt><dd>${entry.bestValue ? `${formatCoins(entry.bestValue)} coins` : 'Awaiting a new record'}</dd>
                 <dt>Trophies</dt><dd>${nf.format(entry.trophies)}</dd>
               </dl>
               <p class="hint">Best bait: ${escape(getBait(fish.preferredBaitId).name)} · best in ${escape(fish.preferredCondition)}</p>
               <p class="hint">${hint}</p>`
            : `<dl><dt>Status</dt><dd>Undiscovered</dd></dl>
               <p class="hint">${hint}</p>`}
        </article>`;
    }).join('');
    const lockNote = unlocked
      ? ''
      : location.prestige
        ? ` — opens at prestige ${location.prestige}`
        : ` — locked, unlock for ${formatCoins(location.cost)} coins in Tackle &amp; Upgrades`;
    return `
      <section class="location-group">
        <h4>${escape(location.name)} <span class="progress">${foundHere}/${species.length}</span>${lockNote}</h4>
        <p class="muted">Discovery ${mastery.caught}/${mastery.total}${mastery.discovered ? ' ✓ local sales +8%' : ''} · trophy species ${mastery.trophies}/${mastery.total}${mastery.trophy ? ' ✓ larger catches here' : ''}</p>
        <div class="cards">${cards}</div>
      </section>`;
  }).join('');
}

/* ----------------------------------------------------------------- tackle */

function modifierRows(rod, bait, locationId, state) {
  const rows = [];
  const baseMs = castDurationMs(rod, getBait('bait_worms'));
  const thisMs = castDurationMs(rod, bait);
  if (thisMs === baseMs) {
    rows.push(['Cast time', `${(thisMs / 1000).toFixed(0)}s with this rod (unchanged)`, '']);
  } else {
    const pct = Math.round(((thisMs - baseMs) / baseMs) * 100);
    rows.push(['Cast time', `${(baseMs / 1000).toFixed(0)}s → ${(thisMs / 1000).toFixed(0)}s (${pct > 0 ? '+' : ''}${pct}% ${pct > 0 ? 'slower' : 'faster'})`, pct > 0 ? 'down' : 'up']);
  }

  const median = bait.sizeBias === 1 ? 0.5 : Math.pow(0.5, 1 / bait.sizeBias);
  if (bait.sizeBias === 1) {
    rows.push(['Fish size', 'Even spread across each species range (median 50%)', '']);
  } else {
    const dirWord = median > 0.5 ? 'bigger' : 'smaller';
    rows.push(['Fish size', `Median catch at ${Math.round(median * 100)}% of the size range — ${dirWord} than Worms`, median > 0.5 ? 'up' : 'down']);
  }

  const species = speciesByLocation(locationId);
  const changes = [];
  const baseWeights = { common: 0.58, uncommon: 0.28, rare: 0.1, epic: 0.035, legendary: 0.005 };
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const mult = bait.rarity;
  if (mult) {
    const withBait = order.map((r) => {
      const raw = order.map((x) => baseWeights[x] * (mult[x] || 0));
      const sum = raw.reduce((a, b) => a + b, 0);
      const idx = order.indexOf(r);
      return { rarity: r, to: raw[idx] / sum };
    });
    const sum = order.reduce((acc, r) => acc + baseWeights[r], 0);
    for (const row of withBait) {
      const from = baseWeights[row.rarity] / sum;
      if (Math.abs(row.to - from) > 0.0005) {
        changes.push(`${RARITY_LABEL[row.rarity]} ${Math.round(from * 1000) / 10}% → ${Math.round(row.to * 1000) / 10}%`);
      }
    }
    const up = order.slice(2).some((r) => (mult[r] || 0) > 1);
    rows.push(['Species odds', changes.join(' · '), up ? 'up' : 'down']);
  } else {
    rows.push(['Species odds', 'Same species odds as Worms', '']);
  }
  return rows;
}

export function renderTackle(state) {
  const workerCount = state.workers.length;

  const rodItem = (rod) => {
    const owned = state.ownedRods.includes(rod.id);
    const selected = state.rodId === rod.id;
    const affordable = state.coins >= rod.cost;
    const tier = rod.prestige || 0;
    const tierMet = (state.prestige?.count || 0) >= tier;
    const action = selected
      ? '<button type="button" class="btn" disabled>In use</button>'
      : owned
        ? `<button type="button" class="btn" data-select-rod="${rod.id}" data-focus="sel-${rod.id}">Switch</button>`
        : !tierMet
          ? `<button type="button" class="btn" disabled>Needs prestige ${tier}</button>`
          : `<button type="button" class="btn btn-primary" data-buy-rod="${rod.id}" data-focus="buy-${rod.id}"${affordable ? '' : ' disabled'}>
               Buy for ${formatCoins(rod.cost)}</button>`;
    return `
      <article class="shop-item${owned ? ' owned' : ''}${selected ? ' selected' : ''}">
        <div class="item-head">
          <span class="item-name">${escape(rod.name)}</span>
          <span class="item-cost${affordable || owned ? '' : ' cant-afford'}">${owned ? 'Owned' : `${formatCoins(rod.cost)} coins`}</span>
        </div>
        <p class="muted" style="margin:0">${escape(rod.blurb)}</p>
        <ul class="modifiers">
          <li><span class="mod-label">Worker cast</span><span class="mod-value">${rod.castSeconds}s base (${workerCount} worker${workerCount === 1 ? '' : 's'})</span></li>
          ${rod.rareMult ? `<li><span class="mod-label">Rare odds</span><span class="mod-value">×${rod.rareMult}</span></li>` : ''}
          ${rod.sizeBias ? `<li><span class="mod-label">Size roll</span><span class="mod-value">×${rod.sizeBias} bias</span></li>` : ''}
          ${rod.favoredLocations ? `<li><span class="mod-label">Specialty</span><span class="mod-value">${rod.favoredLocations.map((id) => LOCATIONS.find((l) => l.id === id).name).join(', ')} · ${Math.round((1 - rod.locationSpeed) * 100)}% faster</span></li>` : ''}
          ${tier ? `<li><span class="mod-label">Unlock</span><span class="mod-value">${tierMet ? 'unlocked' : `requires prestige ${tier}`}</span></li>` : ''}
        </ul>
        <div class="row">${action}</div>
      </article>`;
  };

  const baitItem = (bait) => {
    const owned = state.ownedBaits.includes(bait.id);
    const selected = state.player.baitId === bait.id;
    const affordable = state.coins >= bait.cost;
    const mods = [['Worker pace', bait.castMult === 1 ? 'Full speed when assigned' : `×${bait.castMult} cast time when assigned`, bait.castMult === 1 ? '' : 'down']];
    const median = bait.sizeBias === 1 ? 0.5 : Math.pow(0.5, 1 / bait.sizeBias);
    mods.push(['Fish size', bait.sizeBias === 1 ? 'Even spread' : `Median at ${Math.round(median * 100)}% of the range`, median > 0.5 ? 'up' : 'down']);
    const tier = bait.prestige || 0;
    const tierMet = (state.prestige?.count || 0) >= tier;
    const action = selected
      ? '<button type="button" class="btn" disabled>Using</button>'
      : owned
        ? `<button type="button" class="btn" data-player-bait="${bait.id}" data-focus="pb-${bait.id}">Use</button>`
        : !tierMet
          ? `<button type="button" class="btn" disabled>Needs prestige ${tier}</button>`
          : `<button type="button" class="btn btn-primary" data-buy-bait="${bait.id}" data-focus="bb-${bait.id}"${affordable ? '' : ' disabled'}>
               Buy for ${formatCoins(bait.cost)}</button>`;
    return `
      <article class="shop-item${owned ? ' owned' : ''}${selected ? ' selected' : ''}">
        <div class="item-head">
          <span class="item-name">${escape(bait.name)}</span>
          <span class="item-cost${affordable || owned ? '' : ' cant-afford'}">${owned ? 'Owned' : `${formatCoins(bait.cost)} coins`}</span>
        </div>
        <p class="muted" style="margin:0">${escape(bait.blurb)}</p>
        ${modifierRowsShared(bait, mods)}
        <div class="row">${action}</div>
      </article>`;
  };

  const locationItem = (location) => {
    const unlocked = state.unlockedLocations.includes(location.id);
    const here = state.player.locationId === location.id;
    const workersHere = state.workers.filter((w) => w.locationId === location.id).length;
    const species = speciesByLocation(location.id);
    const biggest = species.reduce((a, b) => (a.maxWeight >= b.maxWeight ? a : b));
    const action = here
      ? '<button type="button" class="btn" disabled>You are here</button>'
      : unlocked
        ? `<button type="button" class="btn" data-player-location="${location.id}" data-focus="pl-${location.id}">Go fish here</button>`
        : (() => {
            const affordable = state.coins >= location.cost;
            return `<button type="button" class="btn btn-primary" data-buy-location="${location.id}" data-focus="bl-${location.id}"${affordable ? '' : ' disabled'}>
              Unlock for ${formatCoins(location.cost)}</button>`;
          })();
    return `
      <article class="shop-item${unlocked ? ' owned' : ''}${here ? ' selected' : ''}">
        <div class="item-head">
          <span class="item-name">${escape(location.name)}</span>
          <span class="item-cost">${unlocked ? `${workersHere} worker${workersHere === 1 ? '' : 's'} here` : `${formatCoins(location.cost)} coins`}</span>
        </div>
        <p class="muted" style="margin:0">${escape(location.blurb)}</p>
        <ul class="modifiers">
          <li><span class="mod-label">Species</span><span class="mod-value">${species.filter((s) => (state.collection[s.id]?.catches || 0) > 0).length}/${species.length} discovered · new names appear in the Collection</span></li>
          <li><span class="mod-label">Size record</span><span class="mod-value">Up to ${formatWeight(biggest.maxWeight)} — discover the species to reveal its name</span></li>
          <li><span class="mod-label">Conditions</span><span class="mod-value">${escape(conditionAt(location.id, state.processedAt).name)} now · cast pace ×${LOCATION_CAST_MULT[location.id]}</span></li>
        </ul>
        <div class="row">${action}</div>
      </article>`;
  };

  els.tackleBody.innerHTML = `
    <section class="shop-group">
      <h4>Rods — one purchase speeds the whole operation</h4>
      <p class="muted">The selected rod changes worker pace and can improve size or rare odds for everyone. Hand fishing still uses the reel game.</p>
      <div class="shop-list">${RODS.map(rodItem).join('')}</div>
    </section>
    <section class="shop-group">
      <h4>Your bait — for hand-fishing (workers choose their own on the Dock)</h4>
      <div class="shop-list">${BAITS.map(baitItem).join('')}</div>
    </section>
    <section class="shop-group">
      <h4>Locations — unlock once; then assign any worker or visit yourself</h4>
      <div class="shop-list">${LOCATIONS.filter((l) => !l.prestige || state.unlockedLocations.includes(l.id) || (state.prestige?.count || 0) >= l.prestige).map(locationItem).join('')}</div>
      <p class="muted">Further ponds open through prestige — see the New Pond tab.</p>
    </section>
    <section class="shop-group">
      <h4>Crew training — automatic casts, faster each level</h4>
      <div class="shop-list">${trainingItem(state)}</div>
    </section>
    <section class="shop-group">
      <h4>Reel control — a wider timing target for hand-fishing</h4>
      <div class="shop-list">${reelItem(state)}</div>
    </section>
    <p class="muted">Base worker cast time: ${formatDuration(currentCastDurationMs(state))} before pond, role and bait effects.</p>
  `;
}

function trainingItem(state) {
  const level = TRAINING_LEVELS[state.trainingLevel];
  const next = TRAINING_LEVELS[state.trainingLevel + 1];
  const affordable = next && state.coins >= next.cost;
  const action = !next
    ? '<button type="button" class="btn" disabled>Fully trained</button>'
    : `<button type="button" class="btn btn-primary" data-buy-training data-focus="buy-training"${affordable ? '' : ' disabled'}>
         Train for ${formatCoins(next.cost)}</button>`;
  return `
    <article class="shop-item${state.trainingLevel ? ' owned' : ''}">
      <div class="item-head">
        <span class="item-name">${escape(level.name)}</span>
        <span class="item-cost">Level ${state.trainingLevel + 1} of ${TRAINING_LEVELS.length}</span>
      </div>
      <p class="muted" style="margin:0">Crew training shortens automatic casts. Your hand-fishing uses the reel minigame. Current effect: ×${level.mult} worker cast time.</p>
      <ul class="modifiers">
        <li><span class="mod-label">Current</span><span class="mod-value">×${level.mult} cast time (min 5s)</span></li>
        ${next ? `<li><span class="mod-label">Next</span><span class="mod-value">×${next.mult} cast time — ${formatCoins(next.cost)} coins</span></li>` : ''}
      </ul>
      <div class="row">${action}</div>
    </article>`;
}

function reelItem(state) {
  const level = REEL_CONTROL_LEVELS[state.reelControlLevel];
  const next = REEL_CONTROL_LEVELS[state.reelControlLevel + 1];
  const affordable = next && state.coins >= next.cost;
  const action = !next
    ? '<button type="button" class="btn" disabled>Fully upgraded</button>'
    : `<button type="button" class="btn btn-primary" data-buy-reel data-focus="buy-reel"${affordable ? '' : ' disabled'}>
         Upgrade for ${formatCoins(next.cost)}</button>`;
  return `
    <article class="shop-item${state.reelControlLevel ? ' owned' : ''}">
      <div class="item-head">
        <span class="item-name">${escape(level.name)}</span>
        <span class="item-cost">Level ${state.reelControlLevel + 1} of ${REEL_CONTROL_LEVELS.length}</span>
      </div>
      <p class="muted" style="margin:0">Reel control widens the manual timing target — the "Fish Yourself" taps get easier. Current target is ${Math.round(level.halfWidth * 200)}% of the track wide.</p>
      <ul class="modifiers">
        <li><span class="mod-label">Current</span><span class="mod-value">target ${Math.round(level.halfWidth * 200)}% wide</span></li>
        ${next ? `<li><span class="mod-label">Next</span><span class="mod-value">target ${Math.round(next.halfWidth * 200)}% wide — ${formatCoins(next.cost)} coins</span></li>` : ''}
      </ul>
      <div class="row">${action}</div>
    </article>`;
}

function modifierRowsShared(bait, rows) {
  return `<ul class="modifiers">${rows.map(([label, value, dir]) => `
    <li><span class="mod-label">${label}</span><span class="mod-value${dir ? ` mod-${dir}` : ''}">${escape(value)}</span></li>`).join('')}
  </ul>`;
}
