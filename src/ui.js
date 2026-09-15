/**
 * Gone Fishing — DOM helpers and panel rendering.
 * Rendering is event-driven (catches, purchases, tab changes); the once-per-frame
 * work is limited to the cast progress bar so focus and scroll are never disturbed.
 */

import {
  AWAY_CAP_HOURS,
  RARITY_LABEL,
  getBait,
  getLocation,
  getRod,
  getSpecies,
  speciesByLocation,
  trophyThreshold,
} from './data.js';
import { collectionEntry, currentCastDurationMs, discoveredCount, trophyTotal } from './engine.js';
import { sceneSvg } from './scene.js';

const $ = (id) => document.getElementById(id);

export const els = {
  coins: $('stat-coins'),
  collection: $('stat-collection'),
  trophies: $('stat-trophies'),
  banners: $('banners'),
  scene: $('scene'),
  sceneCaption: $('scene-caption'),
  controlLocation: $('control-location'),
  controlSetup: $('control-setup'),
  castBar: $('cast-bar'),
  castFill: $('cast-fill'),
  castLabel: $('cast-label'),
  toggle: $('toggle-fishing'),
  miniCasts: $('mini-casts'),
  miniCatches: $('mini-catches'),
  miniEarned: $('mini-earned'),
  miniTime: $('mini-time'),
  recentList: $('recent-list'),
  collectionBody: $('collection-body'),
  collectionSummary: $('collection-summary'),
  tackleBody: $('tackle-body'),
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

// ------------------------------------------------------------------ header

export function renderHeader(state) {
  els.coins.textContent = formatCoins(state.coins);
  els.collection.textContent = `${discoveredCount(state)}/15`;
  els.trophies.textContent = nf.format(trophyTotal(state));
}

// ------------------------------------------------------- fishing / controls

let sceneKey = null;

export function renderScene(state) {
  const location = getLocation(state.locationId);
  const key = `${state.locationId}-${state.unlockedLocations.length}`;
  if (key === sceneKey) return;
  sceneKey = key;
  els.scene.innerHTML = sceneSvg(location, String(state.unlockedLocations.length));
  els.scene.setAttribute('aria-label', `Fishing scene at ${location.name}`);
  els.sceneCaption.textContent = location.blurb;
}

export function renderControls(state) {
  const location = getLocation(state.locationId);
  const rod = getRod(state.rodId);
  const bait = getBait(state.baitId);
  const duration = currentCastDurationMs(state);

  els.controlLocation.textContent = location.name;
  els.controlSetup.innerHTML =
    `${escapeHtml(rod.name)} · ${escapeHtml(bait.name)} · ${(duration / 1000).toFixed(0)}s per cast`;

  els.toggle.textContent = state.fishing ? 'Pause' : 'Start Fishing';
  els.toggle.setAttribute('aria-pressed', String(state.fishing));

  els.miniCasts.textContent = nf.format(state.castCount);
  els.miniCatches.textContent = nf.format(state.lifetimeCatches);
  els.miniEarned.textContent = formatCoins(state.lifetimeCoins);
  els.miniTime.textContent = formatClock(state.playTimeMs);
}

/** Once-per-frame, deliberately tiny: only the bar width and one line of text. */
export function renderCastProgress(state, now) {
  const duration = currentCastDurationMs(state);
  if (!state.fishing) {
    const frozen = duration > 0 ? state.castProgressMs / duration : 0;
    els.castFill.style.width = `${(frozen * 100).toFixed(1)}%`;
    els.castBar.setAttribute('aria-valuenow', String(Math.round(frozen * 100)));
    els.castLabel.textContent = state.castProgressMs > 0
      ? `Paused mid-cast (${formatDuration(state.castProgressMs)} of ${formatDuration(duration)}).`
      : 'Paused. Nothing is earning.';
    els.castLabel.classList.remove('is-fishing');
    return;
  }
  const progress = duration > 0 ? Math.min(1, state.castProgressMs / duration) : 0;
  const remaining = Math.max(0, duration - state.castProgressMs);
  els.castFill.style.width = `${(progress * 100).toFixed(1)}%`;
  els.castBar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  els.castLabel.textContent = `Fishing… next catch in ${(remaining / 1000).toFixed(1)}s`;
  els.castLabel.classList.add('is-fishing');
}

// ------------------------------------------------------------------ recent

export function recordToHtml(record) {
  const species = getSpecies(record.speciesId);
  const tags = [];
  if (record.isNewSpecies) tags.push('<span class="tag tag-new">New species</span>');
  if (record.isRecord) tags.push('<span class="tag tag-record">Personal best</span>');
  if (record.trophy) tags.push('<span class="tag tag-trophy">Trophy</span>');
  return `<li class="rarity-${species.rarity}${record.isNewSpecies || record.isRecord ? ' flash' : ''}">
    <span class="fish">${escapeHtml(species.name)}</span>
    <span class="rarity-label">${RARITY_LABEL[species.rarity]}</span>
    <span class="weight">${formatWeight(record.weight)}</span>
    ${tags.join(' ')}
    <span class="value">+${formatCoins(record.coins)}</span>
  </li>`;
}

export function renderRecent(state, { animate = false } = {}) {
  if (!state.recent.length) {
    els.recentList.innerHTML = '<li class="empty">No catches yet. Start fishing and the fish will come to you.</li>';
    return;
  }
  els.recentList.innerHTML = state.recent.map(recordToHtml).join('');
  if (animate && state.recent[0]) {
    const first = els.recentList.firstElementChild;
    if (first) first.classList.add('flash');
  }
}

// ------------------------------------------------------------ away summary

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
    `<div><dt>Trophies</dt><dd>${nf.format(summary.trophies)}</dd></div>`,
  ];

  const highlights = [];
  if (summary.newSpecies.length) {
    const names = [...new Set(summary.newSpecies)].map((id) => getSpecies(id).name);
    highlights.push(`<li><strong>New species:</strong> ${names.map(escapeHtml).join(', ')}</li>`);
  }
  if (summary.records.length) {
    const best = summary.records
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
