/**
 * Gone Fishing — Fish Yourself panel: a short cast-and-reel timing game.
 *
 * The marker sweeps a track; tapping (or pressing Space/Enter) inside the target
 * zone scores the stage. Three stages, then the catch resolves. Leaving the marker
 * alone or choosing "Reel it in calmly" resolves at a modest fixed quality — nothing
 * is lost, dexterity never gates progression. The marker position is animation-only:
 * quality is computed from wall-clock stage time, so the game works under reduced
 * motion and the marker is skipped entirely there.
 */

import { PLAYER_CAST, getBait, getLocation } from './data.js';
import { stageTargetWindow } from './engine.js';
import { els, formatCoins, formatWeight } from './ui.js';

const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let reducedMotion = false;
if (typeof window !== 'undefined' && window.matchMedia) {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Quality from a tap at wall-clock offset `elapsed` into the current stage sweep.
 * The marker bounces: it sweeps 0→1→0 over twice the sweep time, so the player can
 * catch it on the way back too.
 */
export function qualityFromElapsed(elapsed, state) {
  if (reducedMotion) return 0.8;
  const { center, halfWidth } = stageTargetWindow(state);
  const loop = PLAYER_CAST.sweepMs * 2;
  const phase = ((elapsed % loop) + loop) % loop;
  const t = phase <= PLAYER_CAST.sweepMs ? phase / PLAYER_CAST.sweepMs : 2 - phase / PLAYER_CAST.sweepMs;
  const distance = Math.abs(t - center);
  if (distance <= halfWidth) {
    return 0.6 + 0.4 * (1 - distance / halfWidth); // inside: 0.6 .. 1
  }
  return Math.max(0, 0.6 * (1 - (distance - halfWidth) / Math.max(0.001, 1 - halfWidth))); // outside: fades to 0
}

/** Render the whole panel for the current player state. */
export function renderFishPanel(state, now, opts = {}) {
  const halfWidth = stageTargetWindow(state).halfWidth;
  const location = state.player.locationId;
  const game = state.player.active;
  const last = state.lastPlayerResult || opts.lastResult || null;

  const header = `
    <div class="fish-header">
      <p>You are fishing at <strong>${escape(locationName(state))}</strong> with
        ${escape(baitName(state))}. Your workers keep fishing while you do.</p>
      <p class="muted">${nf2(state.player.catches)} ${state.player.catches === 1 ? 'catch' : 'catches'} by hand ·
        best ${formatWeight(state.player.bestWeight || 0)}</p>
    </div>`;

  if (state.paused) return `${header}<p class="muted">The business is paused. Resume it on the Dock to fish again.</p>`;

  if (game) {
    const stageNum = game.stage + 1;
    return `${header}
      <div class="reel-game" data-testid="reel-game">
        <p class="reel-stage">Reel! Stage ${stageNum} of ${game.stages}</p>
        <div class="reel-track" aria-hidden="true">
          <div class="reel-target" style="left:${((halfWidth && stageTargetWindow(state).center - halfWidth) * 100).toFixed(1)}%; width:${(halfWidth * 200).toFixed(1)}%"></div>
          ${reducedMotion ? '' : `<div class="reel-marker" style="left:${(opts.markerT * 100).toFixed(1)}%"></div>`}
        </div>
        <p class="reel-hint">${reducedMotion
          ? 'Reduced motion is on: every tap now scores a fair hit; timing is not needed.'
          : 'Tap the button (or press Space) when the marker is in the bright zone.'}</p>
        <p class="muted">Stages scored: ${game.stage}/${game.stages}</p>
        <button type="button" class="btn btn-primary btn-reel" data-reel data-focus="reel-btn">Reel! (Space)</button>
        <button type="button" class="btn" data-cancel-cast data-focus="cancel-cast">Let it go</button>
      </div>`;
  }

  const resultHtml = last
    ? `<div class="fish-result" data-testid="last-result">
         <p><strong>${escape(last.speciesName)}</strong> — ${formatWeight(last.weight)}
         ${last.trophy ? ' · <span class="tag tag-trophy">Trophy</span>' : ''}
         ${last.isNewSpecies ? ' · <span class="tag tag-new">New species</span>' : ''}
         ${last.isRecord ? ' · <span class="tag tag-record">Personal best</span>' : ''}</p>
         <p>Sold for <strong>${formatCoins(last.coins)}</strong> coins
         ${last.auto ? ' (calm reel)' : ` (reel quality ${Math.round(last.quality * 100)}%)`}</p>
       </div>`
    : '';

  return `${header}
    ${resultHtml}
    <div class="cast-cta">
      <button type="button" class="btn btn-primary btn-cast" data-cast data-focus="cast-btn">Cast</button>
      <button type="button" class="btn" data-calm-reel data-focus="calm-btn">Take an ordinary fish</button>
    </div>
    <p class="reel-instructions">Cast, then land three quick taps while the marker crosses the bright zone —
    better timing means a heavier fish and a better price. Miss the taps, or press
    “Take an ordinary fish”, and you still sell a normal catch: timing only ever adds a bonus,
    and there is no bait cost or limit.</p>`;
}

function locationName(state) {
  return getLocation(state.player.locationId)?.name || state.player.locationId;
}
function baitName(state) {
  return getBait(state.player.baitId)?.name || state.player.baitId;
}

function nf2(n) { return new Intl.NumberFormat('en-US').format(n); }
