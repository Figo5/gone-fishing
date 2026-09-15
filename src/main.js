/**
 * Gone Fishing — application wiring.
 *
 * Live fishing and offline catch-up use the same engine call (advanceState), so
 * nothing about "while you were away" is a separate code path.
 */

import { AWAY_THRESHOLD_MS, getSpecies } from './data.js';
import {
  advanceState,
  createNewState,
  currentCastDurationMs,
  purchase,
  purchaseAndVisit,
  selectBait,
  selectLocation,
  selectRod,
  setFishing,
  trophyTotal,
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
import {
  banner,
  clearBanner,
  els,
  formatCoins,
  formatClock,
  renderAwaySummary,
  renderCastProgress,
  renderControls,
  renderHeader,
  renderRecent,
  renderScene,
  renderStorageStatus,
} from './ui.js';

const storage = getStorage();
const storageAvailable = storage !== null;

let state;
let activePanel = 'fishing';
let dirty = false;
let lastSaveAt = 0;
let rafId = null;
let primaryTab = true;
let pendingConfirm = null;

// ------------------------------------------------------------------ startup

function boot({ readOnly = false } = {}) {
  const loaded = loadFromStorage(storage);

  if (loaded.status === 'loaded') {
    state = loaded.state;
  } else {
    state = createNewState(Date.now(), seedFromTime(Date.now()));
    if (loaded.status === 'corrupt') {
      // Never erase a corrupt save: keep it, tell the player, and offer the raw file.
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

  // Measure the absence BEFORE anything settles time, so the summary is about the
  // real gap rather than the two milliseconds since boot.
  const now = Date.now();
  const awayMs = now - state.lastSeenAt;

  renderAll();
  renderStorageStatus(storageAvailable);

  if (readOnly) {
    // A second tab shows the saved game but must not simulate, award or write.
    renderCastProgress(state, now);
    return;
  }

  const summary = advanceState(state, now);
  persist(true);
  renderAll();
  if (summary.creditedMs > 0 && awayMs >= AWAY_THRESHOLD_MS && summary.catches.length) {
    renderAwaySummary(summary, state);
  }
  startTicker();
}

// ----------------------------------------------------------------- rendering

function renderAll() {
  renderHeader(state);
  renderScene(state);
  renderControls(state);
  renderRecent(state);
  renderCastProgress(state, Date.now());
  if (activePanel === 'collection') renderCollection(state);
  if (activePanel === 'tackle') renderTackle(state);
}

/** Restore focus to the control the player just used (renders happen on catch events). */
function withFocusHold(mutator) {
  const key = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
  mutator();
  if (key) {
    const next = document.querySelector(`[data-focus="${key}"]`);
    if (next && !next.disabled) next.focus();
  }
}

/** Everything that changes when catches land. Deliberately not a full re-render. */
function renderAfterCatches(summary) {
  withFocusHold(() => {
    renderHeader(state);
    renderControls(state);
    renderRecent(state, { animate: true });
    if (activePanel === 'collection') renderCollection(state);
    if (activePanel === 'tackle') renderTackle(state);
  });
  if (summary.newSpecies.length) {
    const names = [...new Set(summary.newSpecies)].map((id) => getSpecies(id).name);
    banner(`New species discovered: <strong>${names.join(', ')}</strong>`, 'warn', 'discovery');
    setTimeout(() => clearBanner('discovery'), 6000);
  }
}

// ------------------------------------------------------------------- ticker

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
    renderCastProgress(state, now);
    persist(false);
  };
  rafId = requestAnimationFrame(tick);
}

function stopTicker() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}

/** Throttled save: immediate when forced (actions, page hide), otherwise once per second. */
function persist(force) {
  if (!storageAvailable || !primaryTab) return;
  const now = Date.now();
  if (!force && (!dirty || now - lastSaveAt < 1000)) return;
  const result = saveToStorage(storage, state);
  if (result.ok) {
    dirty = false;
    lastSaveAt = now;
  } else if (result.reason === 'write_failed') {
    banner('Saving failed — this browser may be out of storage. Export a backup soon.', 'error', 'write');
  }
}

// ---------------------------------------------------------------- visibility

document.addEventListener('visibilitychange', () => {
  const now = Date.now();
  if (document.hidden) {
    // Settle what has been earned, then stop the loop so hidden tabs do no work.
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

window.addEventListener('pagehide', () => persist(true));

// --------------------------------------------------------------------- tabs

function selectedTab(panel) {
  activePanel = panel;
  for (const tab of document.querySelectorAll('.tab')) {
    const isActive = tab.dataset.panel === panel;
    tab.setAttribute('aria-selected', String(isActive));
  }
  for (const id of ['fishing', 'collection', 'tackle']) {
    document.getElementById(`panel-${id}`).hidden = id !== panel;
  }
  if (panel === 'collection') renderCollection(state);
  if (panel === 'tackle') renderTackle(state);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => selectedTab(tab.dataset.panel));
});
document.getElementById('goto-tackle').addEventListener('click', () => selectedTab('tackle'));

// ------------------------------------------------------------------ actions

els.toggle.addEventListener('click', () => {
  setFishing(state, Date.now(), !state.fishing);
  renderControls(state);
  renderCastProgress(state, Date.now());
  persist(true);
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-buy],[data-select-rod],[data-select-bait],[data-travel]');
  if (!target) return;
  const now = Date.now();

  if (target.dataset.buy) {
    const id = target.dataset.buy;
    const isLocation = id.startsWith('loc_');
    const result = isLocation ? purchaseAndVisit(state, now, id) : purchase(state, now, id);
    if (result.ok) {
      clearBanner('purchase');
      renderAll();
      withFocusHold(() => {});
    } else if (result.reason === 'insufficient_coins') {
      banner(`Not enough coins yet — you need ${formatCoins(result.missing)} more.`, 'warn', 'purchase');
    } else if (result.reason === 'already_owned') {
      banner('You already own that.', 'warn', 'purchase');
    }
  } else if (target.dataset.selectRod) {
    selectRod(state, now, target.dataset.selectRod);
    renderAll();
  } else if (target.dataset.selectBait) {
    selectBait(state, now, target.dataset.selectBait);
    renderAll();
  } else if (target.dataset.travel) {
    selectLocation(state, now, target.dataset.travel);
    renderAll();
  }
  persist(true);
});

// ------------------------------------------------------------------ settings

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
  const ok = document.getElementById('confirm-ok');
  ok.textContent = confirmLabel;
  pendingConfirm = onConfirm;
  document.getElementById('confirm-shell').hidden = false;
  document.getElementById('confirm-cancel').focus(); // safe default: Cancel has focus
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
    // Rejected without touching the live game.
    els.importStatus.innerHTML = `<span class="banner-error">Import rejected — your current game was not changed.</span><br>${parsed.errors.map((e) => `• ${e}`).join('<br>')}`;
    return;
  }
  els.importStatus.textContent = '';
  openConfirm({
    title: 'Import this save?',
    text: `It will replace your current progress (${formatCoins(state.coins)} coins, ${trophyTotal(state)} trophies). This cannot be undone.`,
    confirmLabel: 'Replace my progress',
    onConfirm: () => {
      state = parsed.state;
      dirty = true;
      persist(true);
      renderAll();
      renderHeader(state);
      banner('Save imported.', 'warn', 'import');
      setTimeout(() => clearBanner('import'), 4000);
    },
  });
});

document.getElementById('reset-open').addEventListener('click', () => {
  openConfirm({
    title: 'Reset the whole game?',
    text: `Coins, collection, records and every purchase will be erased (${formatCoins(state.coins)} coins, ${trophyTotal(state)} trophies). Export a backup first if you want to keep it.`,
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

// ------------------------------------------------------------- single writer

/**
 * One active tab. Uses the Web Locks API where available; falls back to a
 * localStorage heartbeat in browsers without it (best effort, documented in README).
 */
async function acquireWriteLock() {
  if (navigator.locks && navigator.locks.request) {
    let verdict = null;
    try {
      navigator.locks.request(LOCK_KEY, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        verdict = lock ? 'granted' : 'denied';
        if (!lock) return undefined;
        return new Promise(() => {}); // held for the lifetime of this tab
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

function heartbeatLock() {
  try {
    const raw = storage ? storage.getItem(LOCK_KEY) : null;
    const now = Date.now();
    if (raw) {
      const held = JSON.parse(raw);
      if (held && held.id !== myTabId && now - held.ts < 12000) return 'secondary';
    }
  } catch (err) { /* treat unreadable heartbeat as free */ }
  const claim = () => {
    try { storage && storage.setItem(LOCK_KEY, JSON.stringify({ id: myTabId, ts: Date.now() })); } catch (err) { /* ignore */ }
  };
  claim();
  setInterval(claim, 5000);
  return 'primary';
}

const myTabId = Math.random().toString(36).slice(2);

function goSecondary() {
  primaryTab = false;
  stopTicker();
  els.toggle.disabled = true;
  banner(
    '<strong>Another Gone Fishing tab is already playing.</strong> This tab is view-only so the two cannot overwrite each other\'s saves. ' +
    'Close this tab, or play in the other one.',
    'warn', 'second-tab',
  );
}

// --------------------------------------------------------------------- launch

(async function main() {
  const lockState = await acquireWriteLock();
  const readOnly = lockState !== 'primary';
  boot({ readOnly });
  if (readOnly) goSecondary();
})();
