/**
 * Gone Fishing — inline SVG scene.
 * One structure, three palettes. No external assets.
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
};

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

/**
 * @param {object} location one of LOCATIONS
 * @param {string} [suffix] unique id suffix so gradients do not collide
 */
export function sceneSvg(location, suffix = 'a') {
  const palette = PALETTES[location.scene] || PALETTES.pond;
  const uid = `${location.scene}-${suffix}`;
  const waterY = 214;

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

  <!-- sky -->
  <rect x="0" y="0" width="720" height="${waterY}" fill="url(#sky-${uid})"/>
  <circle cx="596" cy="66" r="46" fill="url(#glow-${uid})"/>
  <circle cx="596" cy="66" r="19" fill="${palette.sun}" opacity="${palette.moon ? 0.92 : 0.8}"/>
  ${palette.moon ? `<circle cx="590" cy="60" r="16" fill="${palette.skyTop}" opacity="0.85"/>` : ''}
  <ellipse class="cloud" cx="180" cy="58" rx="62" ry="15" fill="#ffffff" opacity="0.07"/>
  <ellipse class="cloud" cx="420" cy="36" rx="46" ry="11" fill="#ffffff" opacity="0.05"/>

  <!-- far shore -->
  <path d="M0 ${waterY} C 90 ${waterY - 26}, 170 ${waterY - 12}, 250 ${waterY - 22} S 420 ${waterY - 8}, 520 ${waterY - 20} S 650 ${waterY - 6}, 720 ${waterY - 16} V ${waterY} Z" fill="${palette.hills}"/>
  ${treeLine(waterY - 4, palette, location.scene === 'river' ? 9 : 3)}

  <!-- water -->
  <rect x="0" y="${waterY}" width="720" height="${300 - waterY}" fill="url(#water-${uid})"/>
  <path d="M0 ${waterY} h720" stroke="${palette.ripple}" stroke-opacity="0.25"/>
  <path d="M0 ${waterY + 30} q 40 -7 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0" fill="none" stroke="${palette.ripple}" stroke-opacity="0.14" stroke-width="2"/>
  <path d="M0 ${waterY + 58} q 40 -6 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0" fill="none" stroke="${palette.ripple}" stroke-opacity="0.1" stroke-width="2"/>
  ${palette.moon ? `<ellipse cx="596" cy="252" rx="26" ry="42" fill="${palette.sun}" opacity="0.1"/>` : ''}
  ${location.scene === 'river' ? `<path d="M40 268 q 60 -10 120 0 t 120 0 t 120 0" fill="none" stroke="${palette.ripple}" stroke-opacity="0.2" stroke-width="3"/>` : ''}

  <!-- reeds -->
  <g opacity="0.9">
    <path d="M22 300 q4 -34 -2 -52 M34 300 q6 -30 2 -46 M48 300 q3 -26 -3 -40" stroke="${palette.reeds}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M672 300 q-5 -32 2 -50 M686 300 q-6 -28 -1 -44 M700 300 q-3 -24 4 -38" stroke="${palette.reeds}" stroke-width="4" fill="none" stroke-linecap="round"/>
  </g>

  <!-- dock -->
  <g>
    <rect x="300" y="${waterY - 6}" width="150" height="12" rx="3" fill="${palette.dock}"/>
    <rect x="300" y="${waterY - 6}" width="150" height="4" rx="2" fill="#ffffff" opacity="0.06"/>
    <rect x="312" y="${waterY + 4}" width="9" height="52" fill="${palette.post}"/>
    <rect x="428" y="${waterY + 4}" width="9" height="52" fill="${palette.post}"/>
    <rect x="366" y="${waterY + 4}" width="7" height="44" fill="${palette.dockDark}"/>
    <rect x="262" y="${waterY - 4}" width="46" height="9" rx="3" fill="${palette.dockDark}"/>
  </g>

  <!-- rod -->
  <g stroke="${palette.post}" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M258 ${waterY - 8} L 300 ${waterY - 74}"/>
  </g>
  <path d="M300 ${waterY - 74} q 34 26 44 92" stroke="#dfeee9" stroke-opacity="0.5" stroke-width="1.4" fill="none"/>

  <!-- ripples around the bobber -->
  <g>
    <ellipse class="ripple" cx="352" cy="${waterY + 22}" rx="26" ry="7" fill="none" stroke="${palette.ripple}" stroke-width="1.6"/>
    <ellipse class="ripple ripple-2" cx="352" cy="${waterY + 22}" rx="26" ry="7" fill="none" stroke="${palette.ripple}" stroke-width="1.4"/>
  </g>

  <!-- bobber -->
  <g class="bobber">
    <ellipse cx="352" cy="${waterY + 26}" rx="13" ry="4.5" fill="#04191b" opacity="0.35"/>
    <circle cx="352" cy="${waterY + 21}" r="8.5" fill="#e8574a"/>
    <path d="M344.2 ${waterY + 18} a8.5 8.5 0 0 1 15.6 0 Z" fill="#f6f1e6"/>
    <rect x="350.4" y="${waterY + 6}" width="3.2" height="9" rx="1.4" fill="#2b1d14"/>
  </g>

  <!-- foreground bank -->
  <path d="M0 300 V ${waterY + 74} q 40 -14 84 -6 q 46 8 92 2 q 44 -6 88 4 q 50 10 100 4 q 46 -6 92 2 q 50 8 100 2 q 46 -6 164 2 V 300 Z" fill="${palette.treeDark}" opacity="0.95"/>

  <!-- fish shapes (decorative) -->
  <g opacity="0.16" fill="${palette.ripple}">
    <path d="M120 262 q14 -8 28 0 q-14 8 -28 0 Z"/>
    <path d="M470 276 q16 -9 32 0 q-16 9 -32 0 Z"/>
    <path d="M560 246 q12 -7 24 0 q-12 7 -24 0 Z"/>
  </g>
</svg>`;
}
