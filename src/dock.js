/**
 * Gone Fishing — Dock panel: workers, business investments, contract board.
 */

import {
  DOCK_LEVELS,
  HIRE_COSTS,
  PLAYER_CAST,
  RARITY_LABEL,
  RARITY_ORDER,
  SPECIES,
  STALL_LEVELS,
  getBait,
  getLocation,
  getRod,
  getSpecies,
} from './data.js';
import {
  dockCapacity,
  dockName,
  hireCost,
  nextDockLevel,
  nextStallLevel,
  stallName,
  workerEstimate,
} from './engine.js';
import { els, formatCoins, formatDuration, formatWeight, nf } from './ui.js';

const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const RARITY_INDEX = Object.fromEntries(RARITY_ORDER.map((r, i) => [r, i]));

function baitOptions(state, worker) {
  return state.ownedBaits
    .map((id) => `<option value="${id}"${id === worker.baitId ? ' selected' : ''}>${escape(getBait(id).name)}</option>`)
    .join('');
}

function locationOptions(state, worker) {
  return state.unlockedLocations
    .map((id) => `<option value="${id}"${id === worker.locationId ? ' selected' : ''}>${escape(getLocation(id).name)}</option>`)
    .join('');
}

export function renderWorkers(state) {
  const capacity = dockCapacity(state);
  const hire = state.ownedWorkers < 6 ? hireCost(state) : null;

  const rows = state.workers.map((worker) => {
    const est = workerEstimate(state, worker);
    const baitNote = getBait(worker.baitId).castMult > 1
      ? ` · casts every ${formatDuration(Math.max(1, est.perCatch ? 1 : 1) * 1)}` : '';
    void baitNote;
    return `
      <article class="worker" data-worker="${worker.id}">
        <div class="worker-head">
          <span class="worker-name">${escape(worker.name)}</span>
          <span class="worker-est muted" title="Estimate from this location's fish and bait — actual results vary">
            ≈ ${formatCoins(est.perHour)}/h
          </span>
        </div>
        <div class="worker-controls">
          <label>At
            <select data-assign-location="${worker.id}" aria-label="Location for ${escape(worker.name)}">
              ${locationOptions(state, worker)}
            </select>
          </label>
          <label>Bait
            <select data-assign-bait="${worker.id}" aria-label="Bait for ${escape(worker.name)}">
              ${baitOptions(state, worker)}
            </select>
          </label>
          <span class="worker-stats muted">${nf.format(worker.catches)} caught</span>
        </div>
      </article>`;
  }).join('');

  const hireHtml = state.ownedWorkers >= 6
    ? '<p class="muted">The dock can hold six workers at most.</p>'
    : (state.ownedWorkers >= capacity
      ? `<button type="button" class="btn" data-invest="dock" data-focus="inv-dock" disabled>
           Hire worker ${state.ownedWorkers + 1} — needs a bigger dock</button>`
      : `<button type="button" class="btn btn-primary" data-invest="hire" data-focus="inv-hire"
           ${state.coins >= hire ? '' : ' disabled'}>
           Hire worker ${state.ownedWorkers + 1} — ${formatCoins(hire)} coins</button>`);

  return `
    <div class="dock-summary muted">
      <span>${escape(dockName(state))}</span>
      <span>${state.ownedWorkers}/${capacity} berths</span>
      <span>${escape(stallName(state))}</span>
      <span>Rod: ${escape(getRod(state.rodId).name)} — shared by every worker and by you</span>
    </div>
    <div class="worker-list">${rows}</div>
    <div class="hire-row">${hireHtml}</div>`;
}

export function renderInvestments(state) {
  const dock = nextDockLevel(state);
  const stall = nextStallLevel(state);
  const currentDock = DOCK_LEVELS[state.dockLevel];
  const currentStall = STALL_LEVELS[state.stallLevel];
  const canPay = (cost) => (state.coins >= cost ? '' : ' disabled');

  const dockHtml = dock
    ? `<button type="button" class="btn" data-invest="dock" data-focus="inv-dock" ${canPay(dock.cost)}>
         Expand dock → ${escape(dock.name)}: ${dock.capacity} berths — ${formatCoins(dock.cost)}</button>`
    : `<span class="owned-note">${escape(currentDock.name)} — the dock is at its largest (${currentDock.capacity} berths).</span>`;

  const stallHtml = stall
    ? `<button type="button" class="btn" data-invest="stall" data-focus="inv-stall" ${canPay(stall.cost)}>
         Upgrade stall → ${escape(stall.name)}: all sales ×${stall.mult.toFixed(1)} — ${formatCoins(stall.cost)}</button>`
    : `<span class="owned-note">${escape(currentStall.name)} — sales ×${currentStall.mult.toFixed(1)}; the stall is fully upgraded.</span>`;

  return `
    <div class="invest-row">${dockHtml}</div>
    <div class="invest-row">${stallHtml}</div>
    <p class="muted">Rod upgrades (Tackle &amp; Upgrades) shorten every worker's cast as well as yours —
    one purchase speeds up the whole operation. Estimates are only estimates: luck moves each
    worker up or down.</p>`;
}

/* ------------------------------------------------------------------ *
 * Contract board                                                      *
 * ------------------------------------------------------------------ */

function contractText(c) {
  if (c.kind === 'qty') {
    return `${c.qty} fish from ${escape(getLocation(c.locationId).name)}`;
  }
  if (c.kind === 'size') {
    const species = getSpecies(c.speciesId);
    return `${c.qty} ${escape(species.name)} at ${formatWeight(c.threshold)} or heavier`;
  }
  return `${c.qty} fish of ${escape(RARITY_LABEL[c.rarity])} rarity or better (any location)`;
}

function contractProgress(c) {
  return `${Math.min(c.count, c.qty)}/${c.qty}`;
}

function offerCard(offer) {
  return `
    <article class="contract-offer">
      <p class="contract-goal">${contractText(offer)}</p>
      <p class="contract-reward">Bonus: <strong>${formatCoins(offer.reward)}</strong> coins
        <span class="muted">(on top of the normal sale price of every fish)</span></p>
      <button type="button" class="btn" data-accept="${offer.id}" data-focus="contract-${offer.id}">Accept</button>
    </article>`;
}

export function renderContract(state) {
  const c = state.contract;
  if (c.accepted) {
    const a = c.accepted;
    const done = a.count >= a.qty;
    return `
      <div class="contract-active${done ? ' complete' : ''}">
        <p class="contract-goal">${contractText(a)}</p>
        <div class="contract-progressbar" role="progressbar" aria-valuemin="0" aria-valuemax="${a.qty}"
             aria-valuenow="${Math.min(a.count, a.qty)}" aria-label="Contract progress">
          <div class="contract-progressfill" style="width:${Math.min(100, (a.count / a.qty) * 100).toFixed(1)}%"></div>
        </div>
        <p class="contract-count">${contractProgress(a)} · bonus <strong>${formatCoins(a.reward)}</strong> coins
          ${done ? ' — paid!' : ' on completion'}</p>
        <div class="row">
          <button type="button" class="btn" data-refresh-board ${c.available.length ? '' : 'hidden'}>Back to the board</button>
          <button type="button" class="btn btn-danger" data-abandon data-focus="abandon">Abandon (no penalty)</button>
        </div>
      </div>`;
  }
  if (!c.available.length) {
    return `
      <p class="muted">Three standing offers appear here. Choose one; only fish caught after
      accepting count, and both you and your workers can fill it.</p>
      <button type="button" class="btn btn-primary" data-refresh-board data-focus="refresh-board">Show offers</button>`;
  }
  return `<div class="contract-offers">${c.available.map(offerCard).join('')}</div>`;
}

export function renderDockPanel(state) {
  return `
    <section class="dock-section">
      <h4>Your crew</h4>
      ${renderWorkers(state)}
    </section>
    <section class="dock-section">
      <h4>Business investments</h4>
      ${renderInvestments(state)}
    </section>
    <section class="dock-section">
      <h4>Contract board</h4>
      ${renderContract(state)}
    </section>`;
}
