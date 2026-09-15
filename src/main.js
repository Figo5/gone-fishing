/**
 * Gone Fishing — application wiring (v2: the dock business).
 *
 * Live and offline play use the same engine call. The player's minigame uses
 * wall-clock stage time and its own RNG stream, so it can never disturb worker
 * catches; it is canceled (without penalty) on hide, pause, or navigation.
 */

import { AWAY_THRESHOLD_MS, getSpecies } from './data.js';
import {
  abandonContract,
  acceptContract,
  advanceState,
  assignWorker,
  cancelPlayerCast,
  createNewState,
  expandDock,
  generateContracts,
  hireWorker,
  purchaseBait,
  purchaseLocation,
  settlePlayerCast,
  setPaused,
  startPlayerCast,
  submitPlayerInput,
  upgradeRod,
  upgradeStall,
  workerEstimate,
} from './engine.js';
import { seedFromTime } from './rng.js';
import {
  LOCK_KEY,
  exportSave,
  deserialize,
  getStorage,
  loadFromStorage,
  saveToStorage,
} from './save.js';
import { renderCollection, renderTackle } from './panels.js';
import { renderDockPanel } from './dock.js';
import { qualityFromElapsed, renderFishPanel } from './fishing.js';
import { sceneSvg } from './scene.js';
import {
  banner,
  clearBanner,
  els,
  formatCoins,
  formatClock,
  formatWeight,
  renderAwaySummary,
  renderControls,
  renderHeader,
  renderRecent,
  renderScene,
  renderStorageStatus,
} from './ui.js';

const storage = getStorage();
const storageAvailable = storage !== null;

let state;
let activePanel = 'dock';
let dirty = false;
let lastSaveAt = 0;
let rafId = null;
let primaryTab = true;
let pendingConfirm = null;
let lastPlayerResult = null;
let markerRaf = null;

const PLAYER_SWEEP_MS = 1700;

/* ------------------------------------------------------------------ boot */

function boot({ readOnly = false } = {}) {
  const loaded = loadFromStorage(storage);

  if (loaded.status === 'loaded') {
    state = loaded.state;
    if (loaded.migrated) {
      banner(
        `<strong>Welcome to the dock!</strong> Your old game carried over: coins, gear, collection and
        records are untouched. Your automatic fisher is now <strong>Worker 1</strong>, fishing the same
        water with the same bait. A backup of the old save was kept in this browser.`,
        'warn', 'migrated',
      );
      setTimeout(() => clearBanner('migrated'), 12000);
    }
  } else {
    state = createNewState(Date.now(), seedFromTime(Date.now()));
    if (loaded.status === 'corrupt') {
      const details = loaded.errors.map((e) => `• ${e}`).join('<br>');
      banner(
        `<strong>Your saved game could not be read, so a new one was started.</strong><br>${details}<br>` +
        `Nothing was deleted${loaded.preservedKey ? ' — the old data is kept under a recovery key' : ''}.` +
        `<br><button type="button" class="btn" id="download-corrupt">Download the unreadable save</button>`,
        'error', 'corrupt',
      );
      const raw = loaded.raw;
      document.getElementById('download-corrupt')?.addEventListener('click', () => {
        downloadText(`gone-fishing-unreadable-${Date.now()}.json`, raw ?? '');
      });
    }
  }

  if (!storageAvailable) {
    banner('This browser is blocking local storage, so progress is <strong>not</strong> being saved. Export a backup before closing.', 'error', 'storage');
  }

  const now = Date.now();
  const awayMs = now - state.lastSeenAt;

  renderAll();
  renderStorageStatus(storageAvailable);

  if (readOnly) {
    renderFishBody(now);
    return;
  }

  const summary = advanceState(state, now);
  persist(true, { wasMigrated: loaded.migrated === true, backupRaw: loaded.migrated ? loaded.raw : null });
  renderAll();
  if (summary.creditedMs > 0 && awayMs >= AWAY_THRESHOLD_MS && summary.catches.length) {
    renderAwaySummary(summary, state);
  }
  startTicker();
}

/* ------------------------------------------------------------- rendering */

function renderAll() {
  renderHeader(state, estimateIncome());
  renderScene(state);
  renderScenePlayer();
  renderControls(state);
  renderRecent(state);
  renderDock();
  renderFishBody(Date.now());
  if (activePanel === 'collection') renderCollection(state);
  if (activePanel === 'tackle') renderTackle(state);
}

/** The player's own fishing spot (same palette logic, own element). */
let scenePlayerKey = null;
function renderScenePlayer() {
  const el = document.getElementById('scene-player');
  if (!el) return;
  const shown = state.player.locationId;
  const key = `${shown}|${state.dockLevel}|${state.stallLevel}`;
  if (key === scenePlayerKey) return;
  scenePlayerKey = key;
  const sceneLocation = { scene: shown === 'loc_pond' ? 'pond' : shown === 'loc_river' ? 'river' : 'lake' };
  el.innerHTML = sceneSvg(sceneLocation, {
    workers: 0,
    dockLevel: state.dockLevel,
    stallLevel: state.stallLevel,
    awayWorkers: [],
  });
}

/** Sum of per-worker hourly estimates (clearly labeled as an estimate in the UI). */
function estimateIncome() {
  if (state.paused || !state.workers.length) return 0;
  return state.workers.reduce((sum, w) => sum + workerEstimate(state, w).perHour, 0);
}

function renderDock() {
  if (activePanel !== 'dock') return;
  els.dockBody.innerHTML = renderDockPanel(state);
}

function renderFishBody(now) {
  if (activePanel !== 'fish') return;
  els.fishBody.innerHTML = renderFishPanel(state, now, { lastResult: lastPlayerResult });
}

/** Restore focus to the control the player just used after a re-render. */
function withFocusHold(mutator) {
  const key = document.activeElement?.dataset?.focus || null;
  mutator();
  if (key) {
    const next = document.querySelector(`[data-focus="${key}"]`);
    if (next && !next.disabled) next.focus();
  }
}

function renderAfterCatches(summary) {
  withFocusHold(() => {
    renderHeader(state, estimateIncome());
    renderControls(state);
    renderRecent(state, { animate: true });
    renderDock();
    if (activePanel === 'collection') renderCollection(state);
    if (activePanel === 'tackle') renderTackle(state);
  });
  if (summary.newSpecies && summary.newSpecies.length) {
    const names = [...new Set(summary.newSpecies)].map((id) => getSpecies(id).name);
    banner(`New species discovered: <strong>${names.join(', ')}</strong>`, 'warn', 'discovery');
    setTimeout(() => clearBanner('discovery'), 6000);
  }
  for (const completion of summary.contractCompletions || []) {
    banner(`Contract complete — <strong>${formatCoins(completion.reward)}</strong> coin bonus paid.`, 'warn', 'contract-done');
    setTimeout(() => clearBanner('contract-done'), 8000);
  }
}

/* ----------------------------------------------------------------- ticker */

function startTicker() {
  if (rafId !== null) return;
  const tick = () => {
    rafId = requestAnimationFrame(tick);
    const now = Date.now();
    const summary = advanceState(state, now);
    if (summary.catches.length) {
      renderAfterCatches(summary);
      dirty = true;
    }
    tickPlayerMarker(now);
    persist(false);
  };
  rafId = requestAnimationFrame(tick);
}

function stopTicker() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  stopMarker();
}

/** Marker animation only; scoring uses wall-clock time in submitPlayerInput. */
function tickPlayerMarker(now) {
  if (!state.player.active || activePanel !== 'fish') return;
  const elapsed = now - state.player.active.stageStart;
  const loop = PLAYER_SWEEP_MS * 2;
  const phase = ((elapsed % loop) + loop) % loop;
  const t = phase <= PLAYER_SWEEP_MS ? phase / PLAYER_SWEEP_MS : 2 - phase / PLAYER_SWEEP_MS;
  const marker = els.fishBody.querySelector('.reel-marker');
  if (marker) marker.style.left = `${(t * 100).toFixed(1)}%`;
}

function stopMarker() { /* marker rides the main ticker; nothing separate to stop */ }

/** Throttled save: immediate when forced, otherwise at most once per second when dirty. */
function persist(force, { wasMigrated = false, backupRaw = null } = {}) {
  if (!storageAvailable || !primaryTab) return;
  const now = Date.now();
  if (!force && (!dirty || now - lastSaveAt < 1000)) return;
  const result = saveToStorage(storage, state, { wasMigrated, backupRaw });
  if (result.ok) {
    dirty = false;
    lastSaveAt = now;
  } else if (result.reason === 'write_failed') {
    banner('Saving failed — this browser may be out of storage. Export a backup soon.', 'error', 'write');
  }
}

/* ------------------------------------------------------------- visibility */

document.addEventListener('visibilitychange', () => {
  const now = Date.now();
  if (document.hidden) {
    // Cancel any in-progress minigame (no penalty), settle workers, save, stop.
    cancelPlayerCast(state);
    const summary = advanceState(state, now);
    if (summary.catches.length) renderRecent(state);
    stopTicker();
    persist(true);
  } else {
    const awayMs = now - state.lastSeenAt;
    const summary = advanceState(state, now);
    renderAll();
    persist(true);
    if (summary.creditedMs > 0 && awayMs >= AWAY_THRESHOLD_MS && summary.catches.length) {
      renderAwaySummary(summary, state);
    }
    if (primaryTab) startTicker();
  }
});

window.addEventListener('pagehide', () => {
  cancelPlayerCast(state);
  persist(true);
});

/* ------------------------------------------------------------------- tabs */

function selectedTab(panel) {
  activePanel = panel;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.panel === panel));
  }
  for (const id of ['dock', 'fish', 'collection', 'tackle']) {
    document.getElementById(`panel-${id}`).hidden = id !== panel;
  }
  if (panel === 'dock') renderDock();
  if (panel === 'fish') renderFishBody(Date.now());
  if (panel === 'collection') renderCollection(state);
  if (panel === 'tackle') renderTackle(state);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => selectedTab(tab.dataset.panel));
});

/* ---------------------------------------------------------------- actions */

els.toggle.addEventListener('click', () => {
  setPaused(state, Date.now(), !state.paused);
  renderAll();
  persist(true);
});

document.addEventListener('click', (event) => {
  const target = event.target.closest(
    '[data-invest],[data-assign-location],[data-assign-bait],[data-buy-rod],[data-buy-bait],[data-buy-location],[data-player-bait],[data-player-location],[data-cast],[data-reel],[data-cancel-cast],[data-calm-reel],[data-accept],[data-abandon],[data-refresh-board]',
  );
  if (!target) return;
  const now = Date.now();
  let needRender = true;

  // --- business investments
  if (target.dataset.invest === 'hire') {
    const result = hireWorker(state, now);
    if (!result.ok && result.reason === 'insufficient_coins') {
      banner(`Not enough coins yet — you need ${formatCoins(result.missing)} more.`, 'warn', 'invest');
      needRender = false;
    } else if (!result.ok && result.reason === 'dock_full') {
      banner('The dock is full — expand it first.', 'warn', 'invest');
      needRender = false;
    }
  } else if (target.dataset.invest === 'dock') {
    const result = expandDock(state, now);
    if (!result.ok && result.reason === 'insufficient_coins') {
      banner(`Not enough coins yet — you need ${formatCoins(result.missing)} more.`, 'warn', 'invest');
      needRender = false;
    }
  } else if (target.dataset.invest === 'stall') {
    const result = upgradeStall(state, now);
    if (!result.ok && result.reason === 'insufficient_coins') {
      banner(`Not enough coins yet — you need ${formatCoins(result.missing)} more.`, 'warn', 'invest');
      needRender = false;
    }
  }

  // --- assignments
  else if (target.dataset.assignLocation) {
    const workerId = Number(target.dataset.assignLocation);
    const locationId = target.value;
    assignWorker(state, now, workerId, { locationId });
  } else if (target.dataset.assignBait) {
    const workerId = Number(target.dataset.assignBait);
    const baitId = target.value;
    assignWorker(state, now, workerId, { baitId });
  }

  // --- tackle
  else if (target.dataset.buyRod) { upgradeRod(state, now, target.dataset.buyRod); }
  else if (target.dataset.buyBait) {
    const result = purchaseBait(state, now, target.dataset.buyBait);
    if (!result.ok && result.reason === 'insufficient_coins') {
      banner(`Not enough coins yet — you need ${formatCoins(result.missing)} more.`, 'warn', 'invest');
      needRender = false;
    }
  } else if (target.dataset.buyLocation) {
    const result = purchaseLocation(state, now, target.dataset.buyLocation);
    if (!result.ok && result.reason === 'insufficient_coins') {
      banner(`Not enough coins yet — you need ${formatCoins(result.missing)} more.`, 'warn', 'invest');
      needRender = false;
    }
  }

  // --- player fishing
  else if (target.dataset.cast !== undefined || target.hasAttribute('data-cast')) {
    const result = startPlayerCast(state, now);
    if (result.ok) lastPlayerResult = null;
    renderFishBody(now);
    needRender = false;
  } else if (target.hasAttribute('data-reel')) {
    const now2 = Date.now();
    const elapsed = now2 - (state.player.active?.stageStart || now2);
    const q = qualityFromElapsed(elapsed);
    const submit = submitPlayerInput(state, now2, q);
    if (submit.ok && submit.complete) {
      const settled = settlePlayerCast(state, now2, false);
      if (settled.ok) lastPlayerResult = { ...settled, speciesName: getSpecies(settled.speciesId).name };
    }
    renderFishBody(now2);
    needRender = false;
  } else if (target.hasAttribute('data-cancel-cast')) {
    cancelPlayerCast(state);
    renderFishBody(now);
    needRender = false;
  } else if (target.hasAttribute('data-calm-reel')) {
    const result = startPlayerCast(state, now);
    if (result.ok) {
      const settled = settlePlayerCast(state, now, true);
      if (settled.ok) lastPlayerResult = { ...settled, speciesName: getSpecies(settled.speciesId).name, auto: true };
    }
    renderFishBody(now);
    needRender = false;
  }

  // --- player gear / location selection
  else if (target.dataset.playerBait) {
    if (state.ownedBaits.includes(target.dataset.playerBait)) {
      state.player.baitId = target.dataset.playerBait;
      cancelPlayerCast(state); // new bait, fresh cast
    }
  } else if (target.dataset.playerLocation) {
    if (state.unlockedLocations.includes(target.dataset.playerLocation)) {
      state.player.locationId = target.dataset.playerLocation;
      cancelPlayerCast(state);
    }
  }

  // --- contracts
  else if (target.hasAttribute('data-refresh-board')) {
    generateContracts(state, now);
  } else if (target.dataset.accept) {
    const result = acceptContract(state, now, target.dataset.accept);
    if (!result.ok && result.reason === 'one_at_a_time') {
      banner('Finish or abandon your current contract first.', 'warn', 'contract');
      needRender = false;
    }
  } else if (target.hasAttribute('data-abandon')) {
    abandonContract(state, now);
  }

  if (needRender) renderAll();
  persist(true);
}, true);

/* bait / location purchases are handled in the main click delegate above */

/* worker assignment <select> changes fire "change", not "click" */
document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset?.assignLocation) {
    assignWorker(state, Date.now(), Number(target.dataset.assignLocation), { locationId: target.value });
    renderAll();
    persist(true);
  } else if (target.dataset?.assignBait) {
    assignWorker(state, Date.now(), Number(target.dataset.assignBait), { baitId: target.value });
    renderAll();
    persist(true);
  }
});

/* --------------------------------------------------------------- settings */

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openConfirm({ title, text, confirmLabel, onConfirm }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = text;
  document.getElementById('confirm-ok').textContent = confirmLabel;
  pendingConfirm = onConfirm;
  document.getElementById('confirm-shell').hidden = false;
  document.getElementById('confirm-cancel').focus();
}

function closeConfirm() {
  pendingConfirm = null;
  document.getElementById('confirm-shell').hidden = true;
}

document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
document.getElementById('confirm-ok').addEventListener('click', () => {
  const fn = pendingConfirm;
  closeConfirm();
  if (fn) fn();
});

document.getElementById('settings-open').addEventListener('click', () => {
  els.settingsShell.hidden = false;
  document.getElementById('settings-close').focus();
});
document.getElementById('settings-close').addEventListener('click', () => { els.settingsShell.hidden = true; });
document.getElementById('away-close').addEventListener('click', () => { els.awayShell.hidden = true; });

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!document.getElementById('confirm-shell').hidden) return closeConfirm();
  if (!els.awayShell.hidden) return (els.awayShell.hidden = true);
  if (!els.settingsShell.hidden) els.settingsShell.hidden = true;
});

/* keyboard support for the reel game: Space (and Enter) submit a stage */
document.addEventListener('keydown', (event) => {
  if (event.key !== ' ' && event.key !== 'Enter') return;
  if (!state.player.active || activePanel !== 'fish') return;
  const target = event.target;
  if (target && (target.tagName === 'SELECT' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
  event.preventDefault();
  if (event.repeat) return; // held keys cannot spam stages
  const now = Date.now();
  const elapsed = now - state.player.active.stageStart;
  const q = qualityFromElapsed(elapsed);
  const submit = submitPlayerInput(state, now, q);
  if (submit.ok && submit.complete) {
    const settled = settlePlayerCast(state, now, false);
    if (settled.ok) lastPlayerResult = { ...settled, speciesName: getSpecies(settled.speciesId).name };
  }
  renderFishBody(now);
  persist(true);
});

document.getElementById('export-save').addEventListener('click', () => {
  persist(true);
  downloadText(`gone-fishing-save-${new Date().toISOString().slice(0, 10)}.json`, exportSave(state));
});

document.getElementById('import-file').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const text = await file.text();
  const parsed = deserialize(text);
  if (!parsed.ok) {
    els.importStatus.innerHTML = `<span class="banner-error">Import rejected — your current game was not changed.</span><br>${parsed.errors.map((e) => `• ${e}`).join('<br>')}`;
    return;
  }
  els.importStatus.textContent = '';
  openConfirm({
    title: 'Import this save?',
    text: `It will replace your current progress (${formatCoins(state.coins)} coins, ${state.workers.length} worker${state.workers.length === 1 ? '' : 's'}). This cannot be undone.`,
    confirmLabel: 'Replace my progress',
    onConfirm: () => {
      state = parsed.state;
      dirty = true;
      persist(true);
      renderAll();
      banner(parsed.migrated ? 'Old save imported and migrated to the dock.' : 'Save imported.', 'warn', 'import');
      setTimeout(() => clearBanner('import'), 5000);
    },
  });
});

document.getElementById('reset-open').addEventListener('click', () => {
  openConfirm({
    title: 'Reset the whole game?',
    text: `Coins, crew, collection, records and every purchase will be erased (${formatCoins(state.coins)} coins, ${state.workers.length} worker${state.workers.length === 1 ? '' : 's'}). Export a backup first if you want to keep it.`,
    confirmLabel: 'Erase everything',
    onConfirm: () => {
      state = createNewState(Date.now(), seedFromTime(Date.now()));
      dirty = true;
      persist(true);
      renderAll();
      banner('Game reset. Good luck out there.', 'warn', 'reset');
      setTimeout(() => clearBanner('reset'), 4000);
    },
  });
});

/* ------------------------------------------------------------- single writer */

async function acquireWriteLock() {
  if (navigator.locks && navigator.locks.request) {
    let verdict = null;
    try {
      navigator.locks.request(LOCK_KEY, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        verdict = lock ? 'granted' : 'denied';
        if (!lock) return undefined;
        return new Promise(() => {});
      }).catch(() => { verdict = 'error'; });
    } catch (err) {
      verdict = 'error';
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (verdict === 'granted') return 'primary';
    if (verdict === 'denied') return 'secondary';
    return heartbeatLock();
  }
  return heartbeatLock();
}

const myTabId = Math.random().toString(36).slice(2);

function heartbeatLock() {
  try {
    const raw = storage ? storage.getItem(LOCK_KEY) : null;
    const now = Date.now();
    if (raw) {
      const held = JSON.parse(raw);
      if (held && held.id !== myTabId && now - held.ts < 12000) return 'secondary';
    }
  } catch (err) { /* unreadable heartbeat = free */ }
  const claim = () => {
    try { storage && storage.setItem(LOCK_KEY, JSON.stringify({ id: myTabId, ts: Date.now() })); } catch (err) { /* ignore */ }
  };
  claim();
  setInterval(claim, 5000);
  return 'primary';
}

function goSecondary() {
  primaryTab = false;
  stopTicker();
  els.toggle.disabled = true;
  banner(
    '<strong>Another Gone Fishing tab is already playing.</strong> This tab is view-only so the two cannot overwrite each other\'s saves. Close this tab, or play in the other one.',
    'warn', 'second-tab',
  );
}

/* ------------------------------------------------------------------ launch */

(async function main() {
  const lockState = await acquireWriteLock();
  const readOnly = lockState !== 'primary';
  boot({ readOnly });
  if (readOnly) goSecondary();
})();
