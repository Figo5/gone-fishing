/**
 * Gone Fishing — Collection and Tackle panels.
 */

import {
  BAITS,
  LOCATIONS,
  RARITY_LABEL,
  RODS,
  castDurationMs,
  getBait,
  getRod,
  medianSizeFraction,
  rarityDistribution,
  speciesByLocation,
  trophyThreshold,
} from './data.js';
import { collectionEntry, currentCastDurationMs, discoveredCountFor, ownsItem } from './engine.js';
import { els, formatCoins, formatWeight, formatDuration, nf } from './ui.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FISH_ART = { common: '🐟', uncommon: '🐠', rare: '🐡', epic: '🦈', legendary: '✦' };

// ------------------------------------------------------------- collection

export function renderCollection(state) {
  const found = Object.keys(state.collection).filter((id) => state.collection[id].catches > 0).length;
  const trophies = Object.values(state.collection).reduce((sum, e) => sum + (e.trophies || 0), 0);
  els.collectionSummary.textContent = `${found}/15 species discovered · ${nf.format(trophies)} trophies landed`;

  els.collectionBody.innerHTML = LOCATIONS.map((location) => {
    const species = speciesByLocation(location.id);
    const unlocked = state.unlockedLocations.includes(location.id);
    const foundHere = discoveredCountFor(state, location.id);
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
                 <dt>Trophies</dt><dd>${nf.format(entry.trophies)}</dd>
               </dl>
               <p class="hint">${hint}</p>`
            : `<dl><dt>Status</dt><dd>Undiscovered</dd></dl>
               <p class="hint">${hint}</p>`}
        </article>`;
    }).join('');
    const lockNote = unlocked
      ? ''
      : ` — locked, unlock for ${formatCoins(location.cost)} coins in Tackle &amp; Upgrades`;
    return `
      <section class="location-group">
        <h4>${escape(location.name)} <span class="progress">${foundHere}/5</span>${lockNote}</h4>
        <div class="cards">${cards}</div>
      </section>`;
  }).join('');
}

// ----------------------------------------------------------------- tackle

function modifierRows(rod, bait, locationId) {
  const rows = [];
  const baseMs = castDurationMs(rod, getBait('bait_worms'));
  const thisMs = castDurationMs(rod, bait);
  if (thisMs === baseMs) {
    rows.push(['Cast time', `${(thisMs / 1000).toFixed(0)}s with this rod (unchanged)`, '']);
  } else {
    const pct = Math.round(((thisMs - baseMs) / baseMs) * 100);
    rows.push(['Cast time', `${(baseMs / 1000).toFixed(0)}s → ${(thisMs / 1000).toFixed(0)}s (${pct > 0 ? '+' : ''}${pct}% ${pct > 0 ? 'slower' : 'faster'})`, pct > 0 ? 'down' : 'up']);
  }

  const median = medianSizeFraction(bait);
  const medianPct = Math.round(median * 100);
  if (bait.sizeBias === 1) {
    rows.push(['Fish size', 'Even spread across each species range (median 50% of range)', '']);
  } else {
    const dirWord = median > 0.5 ? 'bigger' : 'smaller';
    rows.push(['Fish size', `Median catch at ${medianPct}% of the size range — ${dirWord} than Worms (50%)`, median > 0.5 ? 'up' : 'down']);
  }

  const species = speciesByLocation(locationId);
  const base = rarityDistribution(species, getBait('bait_worms'));
  const withBait = rarityDistribution(species, bait);
  const changes = withBait
    .map((row, i) => ({ rarity: row.rarity, from: base[i].probability, to: row.probability }))
    .filter((row) => Math.abs(row.to - row.from) > 0.0005);
  if (!changes.length) {
    rows.push(['Rarity odds', 'Same species odds as Worms', '']);
  } else {
    const text = changes
      .map((row) => `${RARITY_LABEL[row.rarity]} ${Math.round(row.from * 1000) / 10}% → ${Math.round(row.to * 1000) / 10}%`)
      .join(' · ');
    const up = changes.some((row) => row.to > row.from && (row.rarity === 'rare' || row.rarity === 'epic' || row.rarity === 'legendary'));
    rows.push([`Odds at ${escape(getLocationName(locationId))}`, text, up ? 'up' : 'down']);
  }
  return rows;
}

function getLocationName(locationId) {
  const location = LOCATIONS.find((l) => l.id === locationId);
  return location ? location.name : locationId;
}

function modifierList(rows) {
  return `<ul class="modifiers">${rows.map(([label, value, dir]) => `
    <li><span class="mod-label">${label}</span><span class="mod-value${dir ? ` mod-${dir}` : ''}">${value}</span></li>`).join('')}
  </ul>`;
}

export function renderTackle(state) {
  const piece = (item, kind) => {
    const owned = ownsItem(state, item.id);
    const selected = (kind === 'rod' && state.rodId === item.id) || (kind === 'bait' && state.baitId === item.id);
    const affordable = state.coins >= item.cost;
    const mods = kind === 'rod'
      ? [['Cast time', `${item.castSeconds}s per cast with ${escape(getBait(state.baitId).name)}`, '']]
      : modifierRows(getRod(state.rodId), item, state.locationId);

    let action = '';
    if (selected) action = '<button type="button" class="btn" disabled>Equipped</button>';
    else if (owned) {
      action = `<button type="button" class="btn" data-select-${kind}="${item.id}" data-focus="sel-${item.id}">Equip</button>`;
    } else {
      action = `<button type="button" class="btn btn-primary" data-buy="${item.id}" data-focus="buy-${item.id}"${affordable ? '' : ' disabled'}>
        Buy for ${formatCoins(item.cost)}</button>`;
    }

    return `
      <article class="shop-item${owned ? ' owned' : ''}${selected ? ' selected' : ''}">
        <div class="item-head">
          <span class="item-name">${escape(item.name)}</span>
          <span class="item-cost${affordable || owned ? '' : ' cant-afford'}">${owned ? 'Owned' : `${formatCoins(item.cost)} coins`}</span>
        </div>
        <p class="muted" style="margin:0">${escape(item.blurb)}</p>
        ${modifierList(mods)}
        <div class="row">${action}</div>
      </article>`;
  };

  const locationItem = (location) => {
    const unlocked = state.unlockedLocations.includes(location.id);
    const here = state.locationId === location.id;
    const species = speciesByLocation(location.id);
    const biggest = species.reduce((a, b) => (a.maxWeight >= b.maxWeight ? a : b));
    const rows = [
      ['Species', species.map((s) => `${s.name} (${RARITY_LABEL[s.rarity]})`).join(', '), ''],
      ['Biggest species', `${biggest.name}, up to ${formatWeight(biggest.maxWeight)}`, ''],
      ['Typical value', `${formatCoins(Math.min(...species.map((s) => s.baseValue)))}–${formatCoins(Math.max(...species.map((s) => s.baseValue)))} coins per fish`, ''],
    ];
    let action = '';
    if (here) action = '<button type="button" class="btn" disabled>You are here</button>';
    else if (unlocked) action = `<button type="button" class="btn" data-travel="${location.id}" data-focus="travel-${location.id}">Travel here</button>`;
    else {
      const affordable = state.coins >= location.cost;
      action = `<button type="button" class="btn btn-primary" data-buy="${location.id}" data-focus="buy-${location.id}"${affordable ? '' : ' disabled'}>
        Unlock for ${formatCoins(location.cost)}</button>`;
    }
    return `
      <article class="shop-item${unlocked ? ' owned' : ''}${here ? ' selected' : ''}">
        <div class="item-head">
          <span class="item-name">${escape(location.name)}</span>
          <span class="item-cost${unlocked ? '' : ' cant-afford'}">${unlocked ? (here ? 'Fishing here' : 'Unlocked') : `${formatCoins(location.cost)} coins`}</span>
        </div>
        <p class="muted" style="margin:0">${escape(location.blurb)}</p>
        ${modifierList(rows)}
        <div class="row">${action}</div>
      </article>`;
  };

  els.tackleBody.innerHTML = `
    <section class="shop-group">
      <h4>Rods — faster casting</h4>
      <div class="shop-list">${RODS.map((rod) => piece(rod, 'rod')).join('')}</div>
    </section>
    <section class="shop-group">
      <h4>Bait — unlimited use, one-time unlocks</h4>
      <div class="shop-list">${BAITS.map((bait) => piece(bait, 'bait')).join('')}</div>
    </section>
    <section class="shop-group">
      <h4>Locations</h4>
      <div class="shop-list">${LOCATIONS.map(locationItem).join('')}</div>
    </section>
    <p class="muted">Current cast time: ${formatDuration(currentCastDurationMs(state))}. Better rods shorten it;
    Minnows and the Glow Lure lengthen it in exchange for bigger fish or rarer species.</p>
  `;
}
