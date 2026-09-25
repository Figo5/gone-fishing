/**
 * Gone Fishing — DOM helpers, header, recent feed, away summary.
 * Rendering is event-driven; the once-per-frame work is limited to the player's
 * reel marker so focus and scroll are never disturbed.
 */

import {
  AWAY_CAP_HOURS,
  RARITY_LABEL,
  SPECIES,
  conditionAt,
  getLocation,
  getRod,
  getSpecies,
} from './data.js';
import {
  discoveredCount,
  dockName,
  stallMultiplier,
  stallName,
  trophyTotal,
} from './engine.js';
import { sceneSvg } from './scene.js';

const $ = (id) => document.getElementById(id);

export const els = {
  coins: $('stat-coins'),
  income: $('stat-income'),
  collection: $('stat-collection'),
  trophies: $('stat-trophies'),
  banners: $('banners'),
  scene: $('scene'),
  sceneCaption: $('scene-caption'),
  controlLocation: $('control-location'),
  controlSetup: $('control-setup'),
  toggle: $('toggle-fishing'),
  miniCasts: $('mini-casts'),
  miniCatches: $('mini-catches'),
  miniEarned: $('mini-earned'),
  miniTime: $('mini-time'),
  recentList: $('recent-list'),
  collectionBody: $('collection-body'),
  collectionSummary: $('collection-summary'),
  tackleBody: $('tackle-body'),
  dockBody: $('dock-body'),
  fishBody: $('fish-body'),
  prestigeBody: $('prestige-body'),
  awayShell: $('away-shell'),
  awayBody: $('away-body'),
  settingsShell: $('settings-shell'),
  storageStatus: $('storage-status'),
  importStatus: $('import-status'),
};

export const nf = new Intl.NumberFormat('en-US');

export function formatCoins(n) { return nf.format(Math.round(n)); }

export function formatWeight(lb) {
  if (lb >= 10) return `${lb.toFixed(1)} lb`;
  return `${lb.toFixed(2)} lb`;
}

export function formatDuration(ms) {
  if (ms < 1000) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatClock(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function banner(message, level = 'warn', key = null) {
  const id = key ? `banner-${key}` : null;
  if (id && document.getElementById(id)) return;
  const div = document.createElement('div');
  div.className = `banner banner-${level}`;
  if (id) div.id = id;
  div.innerHTML = message;
  els.banners.appendChild(div);
}

export function clearBanner(key) {
  const node = document.getElementById(`banner-${key}`);
  if (node) node.remove();
}

/* ------------------------------------------------------------------ header */

export function renderHeader(state, workerIncome = null) {
  els.coins.textContent = formatCoins(state.coins);
  els.collection.textContent = `${discoveredCount(state)}/${SPECIES.length}`;
  els.trophies.textContent = nf.format(trophyTotal(state));
  if (els.income) {
    els.income.textContent = workerIncome === null ? '—' : `≈ ${formatCoins(workerIncome)}/h`;
    els.income.setAttribute('title', workerIncome === null
      ? 'Estimated earnings of your workers while the business runs'
      : `Rough estimate of what your ${state.workers.length} worker${state.workers.length === 1 ? '' : 's'} earn per hour while the business runs. Luck moves this up and down.`);
  }
}

/* ------------------------------------------------------- scene and controls */

let sceneKey = null;

function shortLocation(id) {
  return ({ loc_pond: 'Pond', loc_river: 'River', loc_lake: 'Lake', loc_cedar: 'Cedar', loc_frost: 'Frostwater', loc_mere: 'Starlight' })[id] || getLocation(id)?.name || 'water';
}

function sceneDescription(state, shownLocationId) {
  const parts = state.unlockedLocations
    .map((id) => {
      const count = state.workers.filter((w) => w.locationId === id).length;
      return count ? `${count} at ${shortLocation(id)}` : null;
    })
    .filter(Boolean);
  return `Dock scene: ${dockName(state)}, ${state.workers.length} fishing station${state.workers.length === 1 ? '' : 's'} (${parts.join(', ')}), fish stall level ${state.stallLevel}.`;
}

const LOCATION_SCENE = { loc_pond: 'pond', loc_river: 'river', loc_lake: 'lake', loc_cedar: 'cedar', loc_frost: 'frost', loc_mere: 'mere' };

export function renderScene(state) {
  // The scene shows the dock: the location the player is fishing at, or the
  // busiest worker location if the player is somewhere unstarted.
  const shown = state.player.locationId || state.unlockedLocations[0];
  const condition = conditionAt(shown, state.processedAt).id;
  const awayWorkers = state.workers
    .filter((w) => w.locationId !== shown)
    .map((w) => ({ label: shortLocation(w.locationId) }));
  const key = [
    shown, condition, state.dockLevel, state.stallLevel, state.workers.length,
    state.workers.map((w) => w.locationId).join(','),
  ].join('|');
  if (key === sceneKey) return;
  sceneKey = key;
  els.scene.className = `scene weather-${condition}`;

  const sceneLocation = { scene: LOCATION_SCENE[shown] || 'pond' };
  els.scene.innerHTML = sceneSvg(sceneLocation, {
    workers: state.workers.length,
    dockLevel: state.dockLevel,
    stallLevel: state.stallLevel,
    awayWorkers,
  });
  els.scene.setAttribute('aria-label', sceneDescription(state, shown));

  const stallNote = stallMultiplier(state) > 1
    ? ` Sales ×${stallMultiplier(state).toFixed(1)} at the ${stallName(state)}.`
    : '';
  els.sceneCaption.textContent =
    `${dockName(state)}: ${state.workers.length} worker${state.workers.length === 1 ? '' : 's'} fishing` +
    (awayWorkers.length ? ` (${awayWorkers.map((w) => `1 → ${w.label}`).join(', ')} by boat)` : '') + '.' + stallNote;
}

export function renderControls(state) {
  const rod = getRod(state.rodId);
  els.controlLocation.textContent = `${dockName(state)} — ${state.workers.length} worker${state.workers.length === 1 ? '' : 's'}`;
  els.controlSetup.innerHTML =
    `Shared rod: ${escapeHtml(rod.name)} (${rod.castSeconds}s base casts; water and crew change pace) · ` +
    `stall ×${stallMultiplier(state).toFixed(1)} · <strong>${state.paused ? 'Paused — nothing is earning' : 'Business running'}</strong>`;
  els.toggle.textContent = state.paused ? 'Resume business' : 'Pause business';
  els.toggle.setAttribute('aria-pressed', String(state.paused));

  els.miniCasts.textContent = nf.format(state.castCount);
  els.miniCatches.textContent = nf.format(state.lifetimeCatches);
  els.miniEarned.textContent = formatCoins(state.lifetimeCoins);
  els.miniTime.textContent = formatClock(state.playTimeMs);
}

/* ------------------------------------------------------------------ recent */

export function recordToHtml(record) {
  const species = getSpecies(record.speciesId);
  const tags = [];
  if (record.isNewSpecies) tags.push('<span class="tag tag-new">New species</span>');
  if (record.isRecord) tags.push('<span class="tag tag-record">Personal best</span>');
  if (record.trophy) tags.push('<span class="tag tag-trophy">Trophy</span>');
  const who = record.source === 'player' ? '<span class="tag tag-you">You</span>' : '';
  return `<li class="rarity-${species.rarity}${record.isNewSpecies || record.isRecord ? ' flash' : ''}">
    <span class="fish">${escapeHtml(species.name)}</span>
    <span class="rarity-label">${RARITY_LABEL[species.rarity]}</span>
    <span class="weight">${formatWeight(record.weight)}</span>
    ${who}${tags.join(' ')}
    <span class="value">+${formatCoins(record.coins)}</span>
  </li>`;
}

export function renderRecent(state, { animate = false } = {}) {
  if (!state.recent.length) {
    els.recentList.innerHTML = '<li class="empty">No catches yet. Your worker is on it — or cast yourself.</li>';
    return;
  }
  els.recentList.innerHTML = state.recent.map(recordToHtml).join('');
  if (animate && state.recent[0]) {
    const first = els.recentList.firstElementChild;
    if (first) first.classList.add('flash');
  }
}

/* ------------------------------------------------------------- away summary */

export function renderAwaySummary(summary, state) {
  if (!summary.creditedMs) return;
  const speciesCounts = new Map();
  for (const record of summary.catches) {
    speciesCounts.set(record.speciesId, (speciesCounts.get(record.speciesId) || 0) + 1);
  }
  const top = [...speciesCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const bits = [
    `<div><dt>Time credited</dt><dd>${formatClock(summary.creditedMs)}</dd></div>`,
    `<div><dt>Fish caught</dt><dd>${nf.format(summary.catches.length)}</dd></div>`,
    `<div><dt>Coins earned</dt><dd>${formatCoins(summary.coins)}</dd></div>`,
    `<div><dt>Crew at work</dt><dd>${state.workers.length}</dd></div>`,
  ];

  const highlights = [];
  const newSpecies = summary.catches.filter((catchResult) => catchResult.isNewSpecies).map((catchResult) => catchResult.speciesId);
  const records = summary.catches.filter((catchResult) => catchResult.isRecord);
  if (newSpecies.length) {
    const names = [...new Set(newSpecies)].map((id) => getSpecies(id).name);
    highlights.push(`<li><strong>New species:</strong> ${names.map(escapeHtml).join(', ')}</li>`);
  }
  if (records.length) {
    const best = records
      .map((r) => ({ ...r, species: getSpecies(r.speciesId) }))
      .sort((a, b) => b.weight / b.species.maxWeight - a.weight / a.species.maxWeight)[0];
    highlights.push(`<li><strong>New personal best:</strong> ${escapeHtml(best.species.name)} at ${formatWeight(best.weight)}</li>`);
  }
  if (top.length) {
    const list = top.map(([id, count]) => `${escapeHtml(getSpecies(id).name)} ×${count}`).join(', ');
    highlights.push(`<li><strong>Mostly caught:</strong> ${list}</li>`);
  }

  els.awayBody.innerHTML = `
    <p class="muted">Earnings have already been added and saved. Closing this panel changes nothing.</p>
    <dl class="summary-grid">${bits.join('')}</dl>
    ${highlights.length ? `<ul class="summary-list">${highlights.join('')}</ul>` : ''}
    ${summary.discardedMs > 0
      ? `<p class="muted">Absences credit up to ${AWAY_CAP_HOURS} hours. ${formatClock(summary.discardedMs)} beyond the cap was discarded.</p>`
      : ''}
  `;
  els.awayShell.hidden = false;
  $('away-close').focus();
}

export function renderStorageStatus(storageAvailable, extra = '') {
  const text = storageAvailable
    ? 'Saving to this browser is working. Progress is stored locally only — export a backup now and then.'
    : 'This browser is not allowing local storage, so progress will NOT be kept after you close the tab. Export a backup if you can.';
  els.storageStatus.innerHTML = `${escapeHtml(text)}${extra}`;
}
