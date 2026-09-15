/**
 * Gone Fishing — inline SVG dock scene.
 * Grows with the business: additional stations per worker, dock sections per dock
 * level, a better stall per stall level, and boats for workers fishing elsewhere.
 */

const PALETTES = {
  pond: {
    skyTop: '#2a4d55', skyBottom: '#173940', sun: '#f2c14e', sunGlow: '#f2c14e',
    hills: '#14322f', trees: '#0f2b2a', treeDark: '#0b2222',
    waterTop: '#1f5f61', waterBottom: '#0f3739', ripple: '#8fd8cb',
    dock: '#4a3524', dockDark: '#33251a', post: '#2b1d14',
    moon: false, reeds: '#2c5d4c',
  },
  river: {
    skyTop: '#22373f', skyBottom: '#16282e', sun: '#e8d9a6', sunGlow: '#e8d9a6',
    hills: '#16302c', trees: '#0e2a26', treeDark: '#0a201e',
    waterTop: '#2b6f77', waterBottom: '#123a40', ripple: '#bfeae2',
    dock: '#4f3b28', dockDark: '#352718', post: '#2d1f15',
    moon: false, reeds: '#33654f',
  },
  lake: {
    skyTop: '#101d33', skyBottom: '#0a1224', sun: '#e2ecf7', sunGlow: '#cfe3f5',
    hills: '#101f33', trees: '#0c1726', treeDark: '#08111c',
    waterTop: '#17395a', waterBottom: '#0a1c30', ripple: '#bcd8f0',
    dock: '#3d3222', dockDark: '#2a2217', post: '#221a11',
    moon: true, reeds: '#24506b',
  },
  cedar: {
    skyTop: '#3d4a33', skyBottom: '#22301f', sun: '#f0d8a0', sunGlow: '#f0d8a0',
    hills: '#2c3d26', trees: '#22331d', treeDark: '#182614',
    waterTop: '#3f6b4e', waterBottom: '#1e3d2a', ripple: '#c2e4c8',
    dock: '#57422a', dockDark: '#3b2c1b', post: '#2c2013',
    moon: false, reeds: '#3f6b3a',
  },
  frost: {
    skyTop: '#41586b', skyBottom: '#273a4a', sun: '#eaf4fb', sunGlow: '#d7ecf7',
    hills: '#31475a', trees: '#263c4d', treeDark: '#1a2c3a',
    waterTop: '#5688a8', waterBottom: '#274a63', ripple: '#e2f1fa',
    dock: '#4a4f58', dockDark: '#33373e', post: '#25282e',
    moon: false, reeds: '#4a7a8c',
  },
  mere: {
    skyTop: '#1b1233', skyBottom: '#0d0a20', sun: '#c9b8ff', sunGlow: '#b7a3f2',
    hills: '#201638', trees: '#181030', treeDark: '#100a20',
    waterTop: '#2f2462', waterBottom: '#150e33', ripple: '#c3b2f7',
    dock: '#3a2f4a', dockDark: '#281f33', post: '#1c1526',
    moon: true, reeds: '#4a3a7a',
  },
};

const BOAT_COLORS = ['#b3543f', '#3f7ab3', '#7a67b3', '#3fb371', '#c2903f'];

function tree(x, y, h, fill) {
  const w = h * 0.62;
  return `<path d="M${x} ${y - h} l${w / 2} ${h} h-${w} Z" fill="${fill}" opacity="${0.85 + (x % 7) / 40}"/>`;
}

function treeLine(baseY, palette, seedOffset = 0) {
  let out = '';
  for (let i = 0; i < 11; i += 1) {
    const x = 30 + i * 88 + ((i * 37 + seedOffset) % 17);
    const h = 34 + ((i * 23 + seedOffset) % 30);
    out += tree(x, baseY, h, i % 3 === 0 ? palette.treeDark : palette.trees);
  }
  return out;
}

/** A labeled boat marker for a worker fishing at another location. */
function boat(x, y, color, label) {
  return `
    <g role="img" aria-label="${label}">
      <path d="M${x} ${y} q 4 8 18 8 q 14 0 18 -8 Z" fill="${color}"/>
      <rect x="${x + 16}" y="${y - 12}" width="3" height="13" fill="${color}"/>
      <path d="M${x + 19} ${y - 12} l 11 6 l -11 5 Z" fill="#e8e2cf" opacity="0.85"/>
      <text x="${x + 18}" y="${y + 20}" text-anchor="middle" font-size="9"
            fill="#cfe3de" font-family="system-ui, sans-serif">${label}</text>
    </g>`;
}

/** One fishing station: a dock extension, a rod and a seated figure shape. */
function station(x, y, palette, index) {
  const wobble = (index % 2) * 6;
  return `
    <g>
      <rect x="${x}" y="${y}" width="46" height="10" rx="3" fill="${palette.dock}"/>
      <rect x="${x}" y="${y}" width="46" height="3" rx="2" fill="#ffffff" opacity="0.06"/>
      <rect x="${x + 6}" y="${y + 9}" width="7" height="34" fill="${palette.post}"/>
      <rect x="${x + 33}" y="${y + 9}" width="7" height="34" fill="${palette.post}"/>
      <path d="M${x + 12 + wobble} ${y - 2} q 8 -8 16 -2" stroke="${palette.post}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M${x + 30 + wobble} ${y - 8} q 26 18 34 66" stroke="#dfeee9" stroke-opacity="0.45" stroke-width="1.3" fill="none"/>
      <circle cx="${x + 14 + wobble}" cy="${y - 6}" r="5" fill="#d7c9a8" opacity="0.9"/>
      <rect x="${x + 9 + wobble}" y="${y - 2}" width="11" height="9" rx="3" fill="#3d5a55"/>
    </g>`;
}

/** The fish stall: grows with stall level. */
function stall(x, y, palette, level) {
  if (level === 0) {
    return `<g aria-label="Crate on a barrel">
      <rect x="${x}" y="${y - 14}" width="30" height="16" rx="2" fill="${palette.dock}"/>
      <rect x="${x + 8}" y="${y - 2}" width="14" height="12" fill="${palette.dockDark}"/>
      <ellipse cx="${x + 15}" cy="${y - 14}" rx="13" ry="4" fill="#7fa8a0" opacity="0.7"/>
    </g>`;
  }
  if (level === 1) {
    return `<g aria-label="Proper fish stall">
      <rect x="${x}" y="${y - 26}" width="52" height="28" rx="3" fill="${palette.dock}"/>
      <rect x="${x - 2}" y="${y - 32}" width="56" height="8" rx="3" fill="${palette.dockDark}"/>
      <rect x="${x + 6}" y="${y - 20}" width="40" height="10" rx="2" fill="#7fa8a0" opacity="0.6"/>
      <rect x="${x + 4}" y="${y + 2}" width="6" height="12" fill="${palette.post}"/>
      <rect x="${x + 42}" y="${y + 2}" width="6" height="12" fill="${palette.post}"/>
    </g>`;
  }
  if (level === 2) {
    return `<g aria-label="Iced display stall">
      <rect x="${x}" y="${y - 30}" width="60" height="32" rx="3" fill="${palette.dock}"/>
      <rect x="${x - 3}" y="${y - 37}" width="66" height="9" rx="3" fill="${palette.dockDark}"/>
      <rect x="${x + 5}" y="${y - 24}" width="50" height="13" rx="2" fill="#a9cfd6" opacity="0.75"/>
      <ellipse cx="${x + 18}" cy="${y - 18}" rx="7" ry="2.6" fill="#dfeee9" opacity="0.85"/>
      <ellipse cx="${x + 38}" cy="${y - 18}" rx="7" ry="2.6" fill="#dfeee9" opacity="0.85"/>
      <rect x="${x + 4}" y="${y + 2}" width="6" height="14" fill="${palette.post}"/>
      <rect x="${x + 50}" y="${y + 2}" width="6" height="14" fill="${palette.post}"/>
    </g>`;
  }
  return `<g aria-label="Dockside market">
    <rect x="${x}" y="${y - 38}" width="74" height="40" rx="4" fill="${palette.dock}"/>
    <rect x="${x - 4}" y="${y - 46}" width="82" height="10" rx="4" fill="${palette.dockDark}"/>
    <rect x="${x + 5}" y="${y - 32}" width="64" height="16" rx="2" fill="#a9cfd6" opacity="0.8"/>
    <ellipse cx="${x + 18}" cy="${y - 24}" rx="8" ry="3" fill="#dfeee9" opacity="0.9"/>
    <ellipse cx="${x + 38}" cy="${y - 24}" rx="8" ry="3" fill="#dfeee9" opacity="0.9"/>
    <ellipse cx="${x + 58}" cy="${y - 24}" rx="8" ry="3" fill="#dfeee9" opacity="0.9"/>
    <rect x="${x + 4}" y="${y + 2}" width="7" height="16" fill="${palette.post}"/>
    <rect x="${x + 63}" y="${y + 2}" width="7" height="16" fill="${palette.post}"/>
    <text x="${x + 37}" y="${y - 40}" text-anchor="middle" font-size="9" fill="#f2c14e"
          font-family="system-ui, sans-serif">MARKET</text>
  </g>`;
}

/**
 * @param {object} location one of LOCATIONS (sets the palette)
 * @param {object} business { workers, dockLevel, stallLevel, playerLocationId, awayWorkers }
 *   awayWorkers: [{ label }] — workers fishing at other locations, shown as boats.
 */
export function sceneSvg(location, business = { workers: 1, dockLevel: 0, stallLevel: 0, awayWorkers: [] }) {
  const palette = PALETTES[location.scene] || PALETTES.pond;
  const waterY = 214;
  const uid = `${location.scene}-${business.dockLevel}-${business.workers}-${business.stallLevel}`;

  // Dock grows from the left: level 0 spans 300-450, each level adds a section.
  const dockLeft = 250;
  const dockWidth = 150 + business.dockLevel * 55;
  const dockY = waterY - 6;

  // Stations along the dock, one per worker.
  const stations = [];
  for (let i = 0; i < business.workers; i += 1) {
    const x = dockLeft + 10 + i * Math.min(52, (dockWidth - 60) / Math.max(1, business.workers - 1 || 1));
    stations.push(station(Math.min(x, dockLeft + dockWidth - 50), dockY, palette, i));
  }

  // Boats for workers assigned elsewhere (at most 3 shown, drifting right of the dock).
  const boats = (business.awayWorkers || []).slice(0, 3).map((away, i) => {
    const color = BOAT_COLORS[i % BOAT_COLORS.length];
    return boat(505 + i * 62, waterY + 44 + (i % 2) * 16, color, away.label);
  }).join('');

  return `
<svg viewBox="0 0 720 300" preserveAspectRatio="xMidYMid slice" role="presentation" focusable="false">
  <defs>
    <linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.skyTop}"/>
      <stop offset="100%" stop-color="${palette.skyBottom}"/>
    </linearGradient>
    <linearGradient id="water-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.waterTop}"/>
      <stop offset="100%" stop-color="${palette.waterBottom}"/>
    </linearGradient>
    <radialGradient id="glow-${uid}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${palette.sunGlow}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${palette.sunGlow}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="720" height="${waterY}" fill="url(#sky-${uid})"/>
  <circle cx="596" cy="66" r="46" fill="url(#glow-${uid})"/>
  <circle cx="596" cy="66" r="19" fill="${palette.sun}" opacity="${palette.moon ? 0.92 : 0.8}"/>
  ${palette.moon ? `<circle cx="590" cy="60" r="16" fill="${palette.skyTop}" opacity="0.85"/>` : ''}
  <ellipse class="cloud" cx="180" cy="58" rx="62" ry="15" fill="#ffffff" opacity="0.07"/>
  <ellipse class="cloud" cx="420" cy="36" rx="46" ry="11" fill="#ffffff" opacity="0.05"/>

  <path d="M0 ${waterY} C 90 ${waterY - 26}, 170 ${waterY - 12}, 250 ${waterY - 22} S 420 ${waterY - 8}, 520 ${waterY - 20} S 650 ${waterY - 6}, 720 ${waterY - 16} V ${waterY} Z" fill="${palette.hills}"/>
  ${treeLine(waterY - 4, palette, location.scene === 'river' ? 9 : 3)}

  <rect x="0" y="${waterY}" width="720" height="${300 - waterY}" fill="url(#water-${uid})"/>
  <path d="M0 ${waterY} h720" stroke="${palette.ripple}" stroke-opacity="0.25"/>
  <path d="M0 ${waterY + 30} q 40 -7 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0" fill="none" stroke="${palette.ripple}" stroke-opacity="0.14" stroke-width="2"/>
  <path d="M0 ${waterY + 58} q 40 -6 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0" fill="none" stroke="${palette.ripple}" stroke-opacity="0.1" stroke-width="2"/>
  ${palette.moon ? `<ellipse cx="596" cy="252" rx="26" ry="42" fill="${palette.sun}" opacity="0.1"/>` : ''}
  ${location.scene === 'river' ? `<path d="M40 268 q 60 -10 120 0 t 120 0" fill="none" stroke="${palette.ripple}" stroke-opacity="0.2" stroke-width="3"/>` : ''}

  <g opacity="0.9">
    <path d="M22 300 q4 -34 -2 -52 M34 300 q6 -30 2 -46 M48 300 q3 -26 -3 -40" stroke="${palette.reeds}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M672 300 q-5 -32 2 -50 M686 300 q-6 -28 -1 -44 M700 300 q-3 -24 4 -38" stroke="${palette.reeds}" stroke-width="4" fill="none" stroke-linecap="round"/>
  </g>

  <!-- the dock itself, with posts -->
  <g>
    <rect x="${dockLeft}" y="${dockY}" width="${dockWidth}" height="12" rx="3" fill="${palette.dock}"/>
    <rect x="${dockLeft}" y="${dockY}" width="${dockWidth}" height="4" rx="2" fill="#ffffff" opacity="0.06"/>
    ${Array.from({ length: 2 + business.dockLevel * 2 }, (_, i) =>
      `<rect x="${dockLeft + 10 + i * ((dockWidth - 24) / (1 + business.dockLevel * 2))}" y="${dockY + 10}" width="9" height="48" fill="${palette.post}"/>`).join('')}
  </g>

  <!-- one station per worker -->
  ${stations.join('')}

  <!-- the player's bobber at the end of the dock -->
  <g>
    <ellipse class="ripple" cx="${dockLeft + dockWidth + 26}" cy="${waterY + 22}" rx="26" ry="7" fill="none" stroke="${palette.ripple}" stroke-width="1.6"/>
    <ellipse class="ripple ripple-2" cx="${dockLeft + dockWidth + 26}" cy="${waterY + 22}" rx="26" ry="7" fill="none" stroke="${palette.ripple}" stroke-width="1.4"/>
  </g>
  <g class="bobber">
    <ellipse cx="${dockLeft + dockWidth + 26}" cy="${waterY + 26}" rx="13" ry="4.5" fill="#04191b" opacity="0.35"/>
    <circle cx="${dockLeft + dockWidth + 26}" cy="${waterY + 21}" r="8.5" fill="#e8574a"/>
    <path d="M${dockLeft + dockWidth + 18.2} ${waterY + 18} a8.5 8.5 0 0 1 15.6 0 Z" fill="#f6f1e6"/>
    <rect x="${dockLeft + dockWidth + 24.4}" y="${waterY + 6}" width="3.2" height="9" rx="1.4" fill="#2b1d14"/>
  </g>

  <!-- workers fishing elsewhere appear as labeled boats -->
  ${boats}

  <!-- the stall, growing with investment -->
  ${stall(dockLeft - 68, dockY + 12, palette, business.stallLevel)}

  <!-- foreground bank -->
  <path d="M0 300 V ${waterY + 74} q 40 -14 84 -6 q 46 8 92 2 q 44 -6 88 4 q 50 10 100 4 q 46 -6 92 2 q 50 8 100 2 q 46 -6 164 2 V 300 Z" fill="${palette.treeDark}" opacity="0.95"/>

  <g opacity="0.16" fill="${palette.ripple}">
    <path d="M120 262 q14 -8 28 0 q-14 8 -28 0 Z"/>
    <path d="M470 276 q16 -9 32 0 q-16 9 -32 0 Z"/>
    <path d="M560 246 q12 -7 24 0 q-12 7 -24 0 Z"/>
  </g>
</svg>`;
}
