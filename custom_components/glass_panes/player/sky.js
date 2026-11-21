// Sky widgets (v0.13): the moon now, and later the sun's arc, the zodiac and the night sky. Loaded only when a pane uses one of them
// (see SKY in widgets.js), so a display that never shows the sky never downloads this. Everything is worked out from the date with
// standard astronomy formulas (Jean Meeus, "Astronomical Algorithms", 2nd ed., chapters 47-49), so a widget works with nothing set up;
// binding a Home Assistant sensor (the built-in Moon integration, or Lunar Phase from HACS) makes its phase name match that sensor.

import { clear, el, okState } from './util.js';

const RAD = Math.PI / 180;
const sin = (deg) => Math.sin(deg * RAD), cos = (deg) => Math.cos(deg * RAD);
const norm = (deg) => ((deg % 360) + 360) % 360;
const DAY = 86400000;
const jdOf = (ms) => ms / DAY + 2440587.5;
const msOf = (jd) => (jd - 2440587.5) * DAY;

/**
 * The moment of a principal moon phase (Meeus ch. 49): k is a whole number for a new moon, + .25 first quarter, + .5 full,
 * + .75 last quarter, counted from the new moon of 6 January 2000. Accurate to a few minutes. Returns ms since 1970 (UTC).
 */
export function phaseTime(k) {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;
  const q = Math.round(norm(k * 360) / 90) % 4;           // 0 new, 1 first quarter, 2 full, 3 last quarter
  let c;
  if (q === 0 || q === 2) {
    const n = q === 0;
    c = (n ? -0.4072 : -0.40614) * sin(Mp) + (n ? 0.17241 : 0.17302) * E * sin(M) + (n ? 0.01608 : 0.01614) * sin(2 * Mp)
      + (n ? 0.01039 : 0.01043) * sin(2 * F) + (n ? 0.00739 : 0.00734) * E * sin(Mp - M) - (n ? 0.00514 : 0.00515) * E * sin(Mp + M)
      + (n ? 0.00208 : 0.00209) * E * E * sin(2 * M) - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M)
      - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F) - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(O)
      - 0.00007 * sin(Mp + 2 * M) + 0.00004 * sin(2 * Mp - 2 * F) + 0.00004 * sin(3 * M) + 0.00003 * sin(Mp + M - 2 * F) + 0.00003 * sin(2 * Mp + 2 * F)
      - 0.00003 * sin(Mp + M + 2 * F) + 0.00003 * sin(Mp - M + 2 * F) - 0.00002 * sin(Mp - M - 2 * F) - 0.00002 * sin(3 * Mp + M) + 0.00002 * sin(4 * Mp);
  } else {
    c = -0.62801 * sin(Mp) + 0.17172 * E * sin(M) - 0.01183 * E * sin(Mp + M) + 0.00862 * sin(2 * Mp) + 0.00804 * sin(2 * F)
      + 0.00454 * E * sin(Mp - M) + 0.00204 * E * E * sin(2 * M) - 0.0018 * sin(Mp - 2 * F) - 0.0007 * sin(Mp + 2 * F) - 0.0004 * sin(3 * Mp)
      - 0.00034 * E * sin(2 * Mp - M) + 0.00032 * E * sin(M + 2 * F) + 0.00032 * E * sin(M - 2 * F) - 0.00028 * E * E * sin(Mp + 2 * M)
      + 0.00027 * E * sin(2 * Mp + M) - 0.00017 * sin(O) - 0.00005 * sin(Mp - M - 2 * F) + 0.00004 * sin(2 * Mp + 2 * F) - 0.00004 * sin(Mp + M + 2 * F)
      + 0.00004 * sin(Mp - 2 * M) + 0.00003 * sin(Mp + M - 2 * F) + 0.00003 * sin(3 * M) + 0.00002 * sin(2 * Mp - 2 * F) + 0.00002 * sin(Mp - M + 2 * F)
      - 0.00002 * sin(3 * Mp + M);
    const W = 0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M) + 0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
    c += q === 1 ? W : -W;
  }
  return msOf(jde + c);
}

export const PHASES = ['new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous', 'full_moon', 'waning_gibbous', 'last_quarter', 'waning_crescent'];
export const PHASE_NAMES = { new_moon: 'New moon', waxing_crescent: 'Waxing crescent', first_quarter: 'First quarter', waxing_gibbous: 'Waxing gibbous',
  full_moon: 'Full moon', waning_gibbous: 'Waning gibbous', last_quarter: 'Last quarter', waning_crescent: 'Waning crescent' };

/**
 * The moon at a moment: how much of it is lit (0..1, Meeus ch. 48, within about a percent), whether it is waxing, its phase name (one of
 * PHASES, the same names as Home Assistant's Moon sensor; a principal phase counts for the 18 hours either side of its exact moment), and
 * the next new and full moons (ms).
 */
export function moonAt(ms) {
  const T = (jdOf(ms) - 2451545) / 36525;
  const D = norm(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);
  const M = norm(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = norm(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T);
  const i = 180 - D - 6.289 * sin(Mp) + 2.1 * sin(M) - 1.274 * sin(2 * D - Mp) - 0.658 * sin(2 * D) - 0.214 * sin(2 * Mp) - 0.11 * sin(D);
  const lit = (1 + cos(i)) / 2, waxing = D < 180;
  // the principal phases around now: start a little before, take the ones on either side
  const k0 = Math.floor((ms - Date.UTC(2000, 0, 6, 18, 14)) / (29.530588861 * DAY)) - 1;
  const events = [];
  for (let k = k0; k <= k0 + 3; k++) for (let q = 0; q < 4; q++) events.push({ q, t: phaseTime(k + q / 4) });
  const near = events.find((e) => Math.abs(e.t - ms) < 18 * 3600000);
  let phase;
  if (near) phase = PHASES[near.q * 2];
  else {
    const prev = events.filter((e) => e.t <= ms).pop();
    phase = PHASES[(prev ? prev.q * 2 + 1 : (waxing ? 1 : 7)) % 8];
  }
  const after = (q) => (events.find((e) => e.q === q && e.t > ms) || {}).t;
  return { lit, waxing, phase, nextNew: after(0), nextFull: after(2) };
}

/**
 * The lit part of a moon disc (radius r, centre cx, cy) as an SVG path, lit on the right; the caller mirrors it for a moon lit on the
 * left. The outer edge is a half circle; the shadow line (terminator) is half an ellipse whose width follows how much is lit.
 */
export function litPath(cx, cy, r, lit) {
  const rx = Math.abs(1 - 2 * lit) * r, f = (n) => n.toFixed(2);
  return 'M' + f(cx) + ' ' + f(cy - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(cx) + ' ' + f(cy + r) +
    'A' + f(rx) + ' ' + f(r) + ' 0 0 ' + (lit > 0.5 ? 1 : 0) + ' ' + f(cx) + ' ' + f(cy - r) + 'Z';
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, parent) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
// the darker "seas" of the moon's face as seen from the north, as [x, y, rx, ry] on a 100-unit disc centred at 50, 50
const MARIA = [[34, 30, 12, 9], [55, 26, 10, 8], [62, 42, 9, 11], [44, 46, 8, 7], [30, 52, 10, 13], [58, 62, 7, 6], [40, 70, 9, 6], [72, 30, 6, 5]];
let seq = 0;

/** Draws the moon (`look`: realistic, line or glow) into a fresh SVG of `size` px. */
export function moonSvg(m, size, look, south) {
  const id = 'gpm' + (++seq), r = 48, s = svgEl('svg', { viewBox: '0 0 100 100', width: size, height: size, 'aria-hidden': 'true' });
  s.style.cssText = 'display:block;flex:none;overflow:visible';
  const flip = (m.waxing ? 1 : -1) * (south ? -1 : 1);           // seen from the south, the lit side swaps
  const lit = svgEl('path', { d: litPath(50, 50, r, m.lit), transform: flip < 0 ? 'translate(100 0) scale(-1 1)' : '' });
  if (look === 'line') {
    svgEl('circle', { cx: 50, cy: 50, r, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, opacity: 0.55 }, s);
    lit.setAttribute('fill', 'currentColor');
    s.appendChild(lit);
    return s;
  }
  const defs = svgEl('defs', {}, s);
  const g = svgEl('radialGradient', { id: id + 'g', cx: '42%', cy: '38%', r: '70%' }, defs);
  svgEl('stop', { offset: '0', 'stop-color': '#fbf8ee' }, g);
  svgEl('stop', { offset: '1', 'stop-color': look === 'glow' ? '#e9ecf4' : '#cfc8b5' }, g);
  const soft = svgEl('filter', { id: id + 'f', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
  svgEl('feGaussianBlur', { stdDeviation: 2.2 }, soft);
  const clip = svgEl('clipPath', { id: id + 'c' }, defs);
  clip.appendChild(lit.cloneNode());
  if (look !== 'glow') svgEl('circle', { cx: 50, cy: 50, r, fill: '#1c1f25' }, s);       // the unlit side, faintly visible (earthshine)
  if (look === 'glow') s.style.filter = 'drop-shadow(0 0 ' + Math.round(size * 0.06) + 'px rgba(235,240,255,.55))';
  lit.setAttribute('fill', 'url(#' + id + 'g)');
  s.appendChild(lit);
  if (look !== 'glow') {
    const seas = svgEl('g', { 'clip-path': 'url(#' + id + 'c)' }, s);
    const inner = svgEl('g', { fill: '#8f8a7c', opacity: 0.3, filter: 'url(#' + id + 'f)', transform: south ? 'rotate(180 50 50)' : '' }, seas);
    MARIA.forEach(([x, y, rx, ry]) => svgEl('ellipse', { cx: x, cy: y, rx: rx * 0.85, ry: ry * 0.85 }, inner));
  }
  return s;
}

// NASA's Scientific Visualization Studio publishes the moon as it looks for every hour of a year ("Moon Phase and Libration", public
// domain), north-up and south-up. The year's two visualisation ids; a year not listed (not published yet) falls back to the drawing.
export const NASA_MOON = { 2025: [5415, 5416], 2026: [5587, 5588] };
/** The address of NASA's picture of the moon for the hour containing `ms`, or '' when that year isn't listed. */
export function nasaMoonUrl(ms, south) {
  const d = new Date(ms), y = d.getUTCFullYear(), ids = NASA_MOON[y];
  if (!ids) return '';
  const id = ids[south ? 1 : 0], frame = Math.floor((ms - Date.UTC(y, 0, 1)) / 3600000) + 1;
  const pad = (n) => String(n).padStart(6, '0');
  return 'https://svs.gsfc.nasa.gov/vis/a000000/a' + pad(Math.floor(id / 100) * 100) + '/a' + pad(id) + '/frames/730x730_1x1_30p/moon.' + String(frame).padStart(4, '0') + '.jpg';
}

/** The moon as a picture: NASA's frame for this hour, or the drawing when there is none or it fails to load. */
function moonPicture(m, size, look, south, now) {
  if (look !== 'photo') return moonSvg(m, size, look, south);
  const url = nasaMoonUrl(now, south);
  if (!url) return moonSvg(m, size, 'realistic', south);
  const im = el('img');
  im.alt = '';
  im.width = size; im.height = size;
  // the frames have a little black margin around the disc; trim it so the moon fills the box like the drawing does
  im.style.cssText = 'display:block;flex:none;width:' + size + 'px;height:' + size + 'px;object-fit:cover;transform:scale(1.12)';
  im.onerror = () => { im.onerror = null; im.replaceWith(moonSvg(m, size, 'realistic', south)); };
  im.src = url;
  return im;
}

const hhmm = (t, time) => time.ampm(new Date(t));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "today", "tomorrow", "on Tuesday" (this week) or "on December 9" for a coming moment, in the display's zone. */
export function whenText(t, now, time) {
  const days = Math.round((time.midnight(new Date(t)) - time.midnight(new Date(now))) / DAY);
  const p = time.parts(new Date(t));
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? 'on ' + p.wd : 'on ' + MONTHS[p.mo - 1] + ' ' + p.d;
}

/** The moon widget: the drawn moon and, as chosen, its phase name, how much is lit, and the next full (or new) moon. */
export function moon(ctx) {
  const o = ctx.opts, entity = ctx.slots.entity;
  const look = o.look || 'realistic', layout = o.layout || 'stacked';
  const render = async () => {
    const now = Date.now(), m = moonAt(now);
    let rise = null, set = null;
    if (entity) {
      // the person's moon sensor wins where it knows more: the built-in Moon integration names the phase; Lunar Phase (HACS) also
      // gives how much is lit, the next full and new moons, and moonrise and moonset for their home
      const st = await ctx.data.state(entity);
      const name = okState(st) ? String(st.state).toLowerCase().replace(/\s+/g, '_') : '';
      if (PHASES.includes(name)) m.phase = name;
      const a = (okState(st) && st.attributes) || {};
      const pct = Number(a.illumination_fraction);
      if (a.illumination_fraction != null && isFinite(pct)) m.lit = pct > 1 ? pct / 100 : pct;
      const t = (v) => { const x = Date.parse(v); return isFinite(x) ? x : null; };
      m.nextFull = t(a.next_full_moon) || m.nextFull;
      m.nextNew = t(a.next_new_moon) || m.nextNew;
      rise = t(a.moonrise); set = t(a.moonset);
    }
    if (!ctx.root.isConnected) return;
    clear(ctx.root);
    const W = ctx.w || 300, H = ctx.h || 300, side = layout === 'side', only = layout === 'moon';
    const lines = [];
    if (!only && o.show_name !== false) lines.push(el('div', 'gp-moon-name', PHASE_NAMES[m.phase]));
    if (!only && o.show_percent !== false) lines.push(el('div', 'gp-moon-lit', Math.round(m.lit * 100) + '% lit'));
    if (!only && o.show_next !== false) {
      const full = m.phase === 'full_moon', t = full ? m.nextNew : m.nextFull;
      if (t) lines.push(el('div', 'gp-moon-next', (full ? 'New moon ' : 'Full moon ') + whenText(t, now, ctx.time)));
    }
    if (!only && o.show_rise !== false && rise && set) lines.push(el('div', 'gp-moon-rise', 'Rises ' + hhmm(rise, ctx.time) + ' · sets ' + hhmm(set, ctx.time)));
    const fs = (ctx.style.size || 28);
    const textH = lines.length ? fs * (1.3 + (lines.length - 1) * 0.95) : 0;
    const size = Math.max(24, Math.floor(only ? Math.min(W, H) : side ? Math.min(H, W * 0.45) : Math.min(W, H - textH - fs * 0.4)));
    const box = el('div', 'gp-moon');
    box.style.cssText = 'display:flex;height:100%;align-items:center;gap:' + Math.round(fs * 0.6) + 'px;' +
      (side ? 'flex-direction:row;' : 'flex-direction:column;justify-content:center;text-align:center;') +
      (side && ctx.style.align === 'right' ? 'flex-direction:row-reverse;text-align:right;' : '');
    box.appendChild(moonPicture(m, size, look, o.hemisphere === 'south', now));
    if (lines.length) {
      const t = el('div');
      t.style.cssText = 'display:grid;gap:' + Math.round(fs * 0.15) + 'px;line-height:1.15;min-width:0';
      lines.forEach((n, i) => { if (i) { n.style.fontSize = '.72em'; n.style.opacity = '.75'; } t.appendChild(n); });
      box.appendChild(t);
    }
    ctx.root.appendChild(box);
  };
  ctx.refresh(render, entity ? [entity] : [], look === 'photo' ? 30 * 60000 : 10 * 60000);
}
