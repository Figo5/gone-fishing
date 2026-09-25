/**
 * Gone Fishing — Prestige panel: move the business to a new pond.
 * Purely informational until the player confirms; nothing here triggers automatically.
 */

import {
  PRESTIGE,
  LEGACY_PERKS,
  getLocation,
} from './data.js';
import {
  earningsMultiplier,
  prestigeEligibility,
  prestigeThreshold,
  prestigeThresholdForCount,
} from './engine.js';
import { formatCoins, nf } from './ui.js';

const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function requirementRow(label, current, needed, met) {
  return `<li class="${met ? 'req-met' : 'req-unmet'}">
    <span class="req-label">${label}</span>
    <span class="req-value">${current} / ${needed}</span>
    <span class="req-check" aria-hidden="true">${met ? '✓' : '—'}</span>
  </li>`;
}

export function renderPrestige(state) {
  const el = prestigeEligibility(state);
  const count = state.prestige.count;
  const dest = el.destination;
  const destLocation = getLocation(dest.locationId);

  const destText = dest.kind === 'new_pond'
    ? `<strong>${escape(destLocation.name)}</strong> — ${escape(destLocation.blurb)} Five new fish live there.`
    : `<strong>${escape(destLocation.name)}</strong> — every pond is already unlocked, so you settle the same water.
       The reward is the next <strong>earnings multiplier</strong>, not a new pond.`;

  const progress = `
    <section class="prestige-section">
      <h4>Requirements for the next move</h4>
      <ul class="prestige-reqs">
        ${requirementRow('Run earnings (spending does not reduce this)',
          formatCoins(el.earnings), formatCoins(el.threshold), el.earningsMet)}
        ${requirementRow('Workers on the payroll', state.workers.length, PRESTIGE.minWorkers, el.workersMet)}
        ${requirementRow('Distinct species discovered', el.discovered, el.discoveriesNeeded, el.discoveriesMet)}
        ${requirementRow('Species with a trophy catch', el.trophySpecies, el.trophySpeciesNeeded, el.trophySpeciesMet)}
      </ul>
      <p class="muted">Run earnings count every coin this run has earned — wallet spending never
      reduces them. The next threshold is ${formatCoins(prestigeThresholdForCount(count + 1))}.</p>
    </section>`;

  const reward = `
    <section class="prestige-section">
      <h4>The reward</h4>
      <p>Permanent earnings multiplier:
        <strong>${el.multiplier.toFixed(2)}× today</strong> →
        <strong class="prestige-next">${el.nextMultiplier.toFixed(2)}×</strong> after the move.
        It applies to every sale and contract bonus, forever, and grows by
        ${PRESTIGE.multCoefficient.toFixed(2)}× per prestige.</p>
      <p>Prestiges so far: <strong>${nf.format(count)}</strong></p>
      <p>Legacy points to spend: <strong>${nf.format(state.legacy.points)}</strong> · one new point each move.</p>
      <div class="legacy-grid">${LEGACY_PERKS.map((perk) => {
        const owned = state.legacy.perks.includes(perk.id);
        return `<article class="contract-offer"><strong>${escape(perk.name)}</strong><p class="muted">${escape(perk.blurb)}</p>
          <button type="button" class="btn" data-legacy-perk="${perk.id}" data-focus="perk-${perk.id}" ${owned || !state.legacy.points ? 'disabled' : ''}>${owned ? 'Owned' : 'Spend 1 point'}</button></article>`;
      }).join('')}</div>
    </section>`;

  const effects = `
    <section class="prestige-section">
      <h4>What happens on confirmation</h4>
      <div class="prestige-columns">
        <div>
          <h5>Preserved</h5>
          <ul class="prestige-list preserve">
            <li>Fish discoveries, counts, trophies, personal bests</li>
            <li>Lifetime statistics</li>
            <li>Every unlocked fishing location — old waters stay open</li>
            <li>Prestige count and the permanent multiplier</li>
            <li>Legacy points and purchased perks</li>
            <li>Access to prestige-tier equipment (buy it again to use it)</li>
            <li>Your pause setting and settings</li>
          </ul>
        </div>
        <div>
          <h5>Reset</h5>
          <ul class="prestige-list reset">
            <li>Coins → 0</li>
            <li>Crew → ${state.legacy.perks.includes('starterCrew') ? 'two starting workers (Trusted Deckhand)' : 'one free worker'}, at the new pond</li>
            <li>Dock → the original two berths; stall, training and reel control → level 1</li>
            <li>Rods → Bamboo Pole; bait → Worms</li>
            <li>The current contract and its offers</li>
            <li>Contract office and today's event</li>
          </ul>
        </div>
      </div>
    </section>`;

  const confirm = el.eligible
    ? `<button type="button" class="btn btn-primary" data-prestige-open data-focus="prestige-open">
         Move to ${escape(destLocation.name)} at ${el.nextMultiplier.toFixed(2)}×</button>
       <p class="muted">A confirmation step follows. A pre-move save is kept in this browser when storage is available.</p>`
    : `<button type="button" class="btn" disabled>Keep fishing — requirements not met yet</button>
       <p class="muted">Nothing happens automatically; the move stays available once the
       requirements above are met.</p>`;

  return `
    <div class="prestige-hero">
      <p>${destText}</p>
      ${progress}
      ${reward}
      ${effects}
      <div class="prestige-confirm">${confirm}</div>
    </div>`;
}

/** The confirmation dialog body (kept separate so the dialog can be prebuilt). */
export function prestigeConfirmBody(state) {
  const el = prestigeEligibility(state);
  const destLocation = getLocation(el.destination.locationId);
  return `
    <p>You are moving the business to <strong>${escape(destLocation.name)}</strong>.</p>
    <p>Earnings multiplier: <strong>${el.multiplier.toFixed(2)}×</strong> →
       <strong class="prestige-next">${el.nextMultiplier.toFixed(2)}×</strong> permanently.</p>
    <p class="muted">Preserved: collection, records, unlocked waters, prestige count and legacy perks.
    Reset: coins, crew, dock, stall, training, reels, rods, bait, contract office and contracts.
    A backup of this save is kept before the move.</p>`;
}
