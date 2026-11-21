// The decorative and "fun" widgets and looks (v0.13): vertical clocks, sparkles, ASCII art, the art pond, petals and the like.
// This file is loaded only when a pane uses one of them (see `fun()` in widgets.js), so a display that never shows them never
// downloads it. Each export is `function (ctx, helpers)`, the same contract as a widget in widgets.js; `helpers` carries the few
// shared pieces from widgets.js (time zones and the digital-time pieces) so nothing here imports widgets.js back.
// Nothing here knows any entity ID, and nothing here ships a picture: pictures come from the person's own media library.

import { clear, el } from './util.js';

// The few animations the decorations use, and the chibi weather icon's box. They are added to the page when this file loads, so a
// display that never shows a fun widget never gets them. Everything moves only with transform or opacity (cheap for the mirror's
// browser); prefers-reduced-motion stops it.
const FUN_CSS = `
@keyframes gp-twinkle { 0%, 100% { opacity: var(--o, .85); } 50% { opacity: calc(var(--o, .85) * .35); } }
@keyframes gp-fall { from { transform: translate3d(0, 0, 0) rotate(0deg); } to { transform: translate3d(var(--dx, 40px), var(--fall, 1000px), 0) rotate(var(--spin, 320deg)); } }
@keyframes gp-sway { 0%, 100% { transform: translateX(calc(var(--sw, 14px) * -1)); } 50% { transform: translateX(var(--sw, 14px)); } }
@keyframes gp-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .gp-motion, .gp-motion * { animation: none !important; } }
.gp-chibi { display: inline-block; vertical-align: middle; margin-right: .25em; }
.gp-chibi svg { display: block; width: 100%; height: 100%; }
`;
if (typeof document !== 'undefined' && !document.getElementById('gp-fun-css')) {
  const st = document.createElement('style');
  st.id = 'gp-fun-css';
  st.textContent = FUN_CSS;
  (document.head || document.documentElement).appendChild(st);
}

// ---------------------------------------------------------------- vertical clocks (clock option `orientation`)

// digit width and line height as parts of the font size, for a typical sans font with tabular figures (a little generous, so it never spills)
const DIGIT_W = 0.62, LINE_H = 1.0, SMALL = 0.4, ROOM = 1.08;   // ROOM: a font's glyphs reach a little past its line box

/**
 * Font sizes (px) that fit a stacked clock in a w x h box: `big` for the hours and minutes rows (two characters each), `small` for the
 * seconds / AM-PM row under them (0 when there is none). The box sizes the digits; the style's text size is not used.
 */
export function stackedSizes(w, h, hasSmall) {
  const rows = 2 * LINE_H + (hasSmall ? SMALL * 1.15 : 0);
  const big = Math.max(8, Math.floor(Math.min(h / (rows * ROOM), w / (2 * DIGIT_W + 0.04))));
  return { big, small: hasSmall ? Math.max(8, Math.round(big * SMALL)) : 0 };
}

/** The font size (px) for a sideways clock: a line of `chars` characters runs along the box's height, one line across its width. */
export function sidewaysSize(w, h, chars) {
  return Math.max(8, Math.floor(Math.min(w / (LINE_H * 1.35), h / (Math.max(1, chars) * DIGIT_W))));
}

// the galactic font's digits run about a third wider than a typical sans font's
const wideness = (ctx) => (ctx.style.font === 'galactic' ? 1.35 : 1);
const sideOf = (align) => ({ left: 'flex-start', right: 'flex-end' }[align] || 'center');
const setText = (node, t) => { if (node.textContent !== t) node.textContent = t; };

// hours over minutes, with the seconds and AM/PM in a small row underneath. The rows are kept, so a tick only changes their text.
export function stackedClock(ctx, { zoneTime, clockPieces }) {
  const o = ctx.opts, time = zoneTime(ctx, o.timezone);
  const hasSmall = !!o.show_seconds || (o.format !== '24h' && o.hide_meridiem === false);
  const sz = stackedSizes((ctx.w || 200) / wideness(ctx), ctx.h || 400, hasSmall);
  clear(ctx.root);
  const box = el('div', 'gp-clock-stack');
  box.style.cssText = 'display:flex;flex-direction:column;justify-content:center;height:100%;line-height:' + LINE_H +
    ';font-variant-numeric:tabular-nums;white-space:nowrap;align-items:' + sideOf(ctx.style.align);
  const row = (px) => { const d = el('div'); d.style.fontSize = px + 'px'; box.appendChild(d); return d; };
  const hh = row(sz.big), mm = row(sz.big), small = hasSmall ? row(sz.small) : null;
  if (small) { small.style.letterSpacing = '.08em'; small.style.marginTop = Math.round(sz.small * 0.15) + 'px'; small.style.opacity = '.8'; }
  ctx.root.appendChild(box);
  ctx.every(o.show_seconds ? 1000 : 5000, () => {
    const pc = clockPieces(time.parts(new Date()), o);
    setText(hh, pc.h); setText(mm, pc.m);
    if (small) setText(small, [pc.s, pc.ap].filter(Boolean).join(' '));
  });
}

// the one-line time with a small second line under it in ordinary digits and the system font, so a clock in an alien alphabet
// (the galactic font) can still be read at a glance
export function twoLineClock(ctx, { zoneTime, clockPieces, clockLine }) {
  const o = ctx.opts, time = zoneTime(ctx, o.timezone);
  clear(ctx.root);
  const box = el('div');
  box.style.cssText = 'display:flex;flex-direction:column;justify-content:center;height:100%;white-space:nowrap;align-items:' + sideOf(ctx.style.align);
  const big = el('div'), small = el('div');
  small.style.cssText = 'font-family:system-ui,sans-serif;font-size:.28em;letter-spacing:.12em;opacity:.7;margin-top:.15em;font-variant-numeric:tabular-nums';
  box.append(big, small);
  ctx.root.appendChild(box);
  ctx.every(o.show_seconds ? 1000 : 5000, () => { const t = clockLine(clockPieces(time.parts(new Date()), o)); setText(big, t); setText(small, t); });
}

// ---- the two round clock looks (clock style analog / alarm), moved here from widgets.js so they load only when a pane uses one

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, parent) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

// A round clock face drawn centred on (cx, cy) with radius R: the face, 60 ticks (the hours bolder), the numerals, and the hands.
// Returns the hands so the clock can turn them. Plain SVG; only `transform` changes after this, once a second at most.
function drawFace(parent, cx, cy, R, dark, allNumerals, seconds) {
  const ink = dark ? '#ececec' : '#1c1c1c', faceFill = dark ? '#151515' : '#f7f7f3', k = R / 88;
  svg('circle', { cx, cy, r: R, fill: faceFill }, parent);
  const at = (r, deg) => [cx + r * Math.sin(deg * Math.PI / 180), cy - r * Math.cos(deg * Math.PI / 180)];
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0, a = at(R - (major ? 13 : 7) * k, i * 6), b = at(R - 3 * k, i * 6);
    svg('line', { x1: a[0].toFixed(2), y1: a[1].toFixed(2), x2: b[0].toFixed(2), y2: b[1].toFixed(2), stroke: ink, 'stroke-width': (major ? 3 : 1.1) * k, 'stroke-linecap': 'round' }, parent);
  }
  for (let n = 1; n <= 12; n++) {
    if (!allNumerals && n % 3 !== 0) continue;
    const pt = at(R * 0.73, n * 30);
    const t = svg('text', { x: pt[0].toFixed(2), y: pt[1].toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': (allNumerals ? 21 : 24) * k, 'font-weight': 500, fill: ink,
      'font-family': 'Helvetica Neue, Helvetica, Arial, system-ui, sans-serif' }, parent);
    t.textContent = String(n);
  }
  const bar = (len, tail, width) => svg('rect', { x: cx - width / 2, y: cy - len, width, height: len + tail, rx: width / 2, fill: ink }, parent);
  const hour = bar(50 * k, 12 * k, 7 * k), minute = bar(74 * k, 12 * k, 5 * k);
  let second = null;
  if (seconds) {
    second = svg('g', {}, parent);
    svg('line', { x1: cx, y1: cy + 18 * k, x2: cx, y2: cy - 78 * k, stroke: '#d9382c', 'stroke-width': 2 * k, 'stroke-linecap': 'round' }, second);
    svg('circle', { cx, cy, r: 5.5 * k, fill: faceFill, stroke: '#d9382c', 'stroke-width': 2.2 * k }, second);
  } else {
    svg('circle', { cx, cy, r: 4.5 * k, fill: ink }, parent);
  }
  return { hour, minute, second, cx, cy };
}

// The two round looks. "analog" is a traditional face (numerals 1 to 12, the minute marks, a red second hand when Show seconds is on).
// "alarm" is a bedside alarm clock: two bells and a striker on top, feet, a coloured case (the widget's text colour when it is a #rrggbb, else red)
// and a small gold alarm hand. Both follow the time zone option and the light/dark face option.
export function roundClock(ctx, { zoneTime, clockAngles }) {
  const o = ctx.opts, time = zoneTime(ctx, o.timezone), alarm = o.style === 'alarm', dark = o.face === 'dark', seconds = o.show_seconds === true;
  const place = { left: 'xMinYMid', right: 'xMaxYMid' }[ctx.style.align] || 'xMidYMid';
  const root = svg('svg', { viewBox: alarm ? '0 0 200 234' : '0 0 200 200', preserveAspectRatio: place + ' meet', width: '100%', height: '100%', role: 'img', 'aria-label': 'Clock' });
  root.setAttribute('class', 'gp-clock-svg');
  root.style.display = 'block';
  let hands;
  if (!alarm) {
    svg('circle', { cx: 100, cy: 100, r: 98, fill: '#2b2b2b' }, root);
    hands = drawFace(root, 100, 100, 89, dark, true, seconds);
  } else {
    const body = /^#[0-9a-f]{6}$/i.test(ctx.style.color || '') ? ctx.style.color : '#d9453d', metal = dark ? '#9a9a9a' : '#7d7d7d';
    for (const sign of [-1, 1]) {
      svg('line', { x1: 100 + sign * 50, y1: 196, x2: 100 + sign * 62, y2: 224, stroke: body, 'stroke-width': 10, 'stroke-linecap': 'round' }, root);          // feet
      svg('path', { d: 'M-34 0 A34 34 0 0 1 34 0 Z', transform: 'translate(' + (100 + sign * 52) + ' 48) rotate(' + (sign * 34) + ')', fill: body }, root);        // bells
    }
    svg('rect', { x: 72, y: 12, width: 56, height: 6, rx: 3, fill: metal }, root);                                                                              // striker
    svg('line', { x1: 100, y1: 18, x2: 100, y2: 40, stroke: metal, 'stroke-width': 5, 'stroke-linecap': 'round' }, root);
    svg('circle', { cx: 100, cy: 128, r: 86, fill: body }, root);                                                                                                // the case
    hands = drawFace(root, 100, 128, 72, dark, false, seconds);
    // the small alarm hand is decoration (about 8 o'clock); the real hands go back on top of it
    const k = 72 / 88, a = 245 * Math.PI / 180;
    svg('line', { x1: 100, y1: 128, x2: (100 + 38 * k * Math.sin(a)).toFixed(2), y2: (128 - 38 * k * Math.cos(a)).toFixed(2), stroke: '#e0a73a', 'stroke-width': 3 * k, 'stroke-linecap': 'round' }, root);
    root.appendChild(hands.hour); root.appendChild(hands.minute); if (hands.second) root.appendChild(hands.second);
  }
  clear(ctx.root);
  ctx.root.appendChild(root);
  const turn = (node, deg) => { if (node) node.setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' ' + hands.cx + ' ' + hands.cy + ')'); };
  const tick = () => {
    const a = clockAngles(time.parts(new Date()));
    turn(hands.hour, a.hour); turn(hands.minute, a.minute); turn(hands.second, a.second);
  };
  ctx.every(seconds ? 1000 : 5000, tick);
}

// the one-line time turned a quarter to the right, reading top to bottom along a narrow strip; the box decides the size
export function sidewaysClock(ctx, { zoneTime, clockPieces, clockLine }) {
  const o = ctx.opts, time = zoneTime(ctx, o.timezone), r = ctx.root.style;
  r.whiteSpace = 'nowrap'; r.writingMode = 'vertical-rl'; r.textOrientation = 'sideways'; r.lineHeight = String(LINE_H);
  r.display = 'flex'; r.alignItems = 'center'; r.justifyContent = sideOf(ctx.style.align); r.fontVariantNumeric = 'tabular-nums';
  let size = 0;
  ctx.every(o.show_seconds ? 1000 : 5000, () => {
    const t = clockLine(clockPieces(time.parts(new Date()), o));
    const want = sidewaysSize(ctx.w || 120, (ctx.h || 600) / wideness(ctx), t.length);
    if (want !== size) { size = want; r.fontSize = size + 'px'; }
    setText(ctx.root, t);
  });
}

// ---------------------------------------------------------------- shared helpers for the decorations

/** A small seeded random generator: the same text always gives the same sequence (so "today" looks the same all day). */
export function rng(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's date in the display's time zone, as YYYY-MM-DD. */
export const today = (ctx) => { const p = ctx.time.parts(new Date()); return p.y + '-' + String(p.mo).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'); };

const HEX = /^#[0-9a-f]{6}$/i;
/** The colours a decoration uses: the person's own list when the palette is `custom` (or not set and colours are given), else a named palette. Never empty. */
export function paletteOf(name, own, palettes, fallback) {
  const mine = (Array.isArray(own) ? own : []).filter((c) => HEX.test(c));
  if (mine.length && (name === 'custom' || !name)) return mine;
  return palettes[name] || palettes[fallback];
}

// draw again when the day changes (checked every 10 minutes; cheap), so a "new every day" decoration turns over after midnight
function daily(ctx, draw) {
  let day = '';
  ctx.every(10 * 60000, () => { const d = today(ctx); if (d !== day) { day = d; draw(d); } });
}

// The animations (gp-twinkle, gp-fall, gp-sway, gp-blink) live in player.css, which the display and the builder both load.

// ---------------------------------------------------------------- sparkles (Decorations)
// Little four-point twinkles plus, optionally, bigger five-point stars, scattered top to bottom through the widget's box. The spread is
// seeded by the pane, the widget and (with change: daily) the date, so it stays put all day and is new tomorrow. Nothing moves unless
// `twinkle` is on (a slow fade, CSS only).

export const SPARKLE_PALETTES = {
  pastel: ['#ffb3d1', '#d8c6ff', '#bfe8ff', '#b8f0d0', '#ffe3b3', '#ffc9a8', '#ff9fa8'],
  rainbow: ['#ff5c8a', '#ffd93d', '#6bcb77', '#4d96ff', '#ff9f43', '#9b5de5', '#00e5d0'],
  gold: ['#ffd76a', '#f5c542', '#ffe9a8', '#e8b04a', '#fff3c4'],
  silver: ['#ffffff', '#e6ecf2', '#cfd8e3', '#b8c4d4'],
  ice: ['#bfe8ff', '#9fd6ff', '#e0f4ff', '#c8d8ff'],
};
export const TWINKLE4 = 'M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z';
export const KIRA = 'M12 0L13.2 10.8L24 12L13.2 13.2L12 24L10.8 13.2L0 12L10.8 10.8Z';   // a thin four-ray glint, the anime 'kira' sparkle
export const STAR5 = 'M12 1.2L14.9 8.6L22.8 9L16.6 13.9L18.7 21.6L12 17.3L5.3 21.6L7.4 13.9L1.2 9L9.1 8.6Z';

/** Where each sparkle goes: [{ x, y, s, star, color, tilt }] for a w x h box. Pure (tested). */
export function sparkleLayout(o, w, h, seed) {
  const r = rng(seed), out = [];
  // keep_middle: no sparkle where your face is (the middle half of the width, from 15% to 70% of the height)
  const inMiddle = (x, y, s) => o.keep_middle && x + s > w * 0.25 && x < w * 0.75 && y + s > h * 0.15 && y < h * 0.7;
  const colors = paletteOf(o.palette || 'pastel', o.colors, SPARKLE_PALETTES, 'pastel');
  const scol = paletteOf(o.star_palette || 'rainbow', o.star_colors, SPARKLE_PALETTES, 'rainbow');
  const n = Math.max(0, Math.min(60, o.count == null ? 10 : o.count)), ns = Math.max(0, Math.min(60, o.stars || 0));
  const lo = o.min_size || 12, hi = Math.max(lo, o.max_size || 34), slo = o.star_min_size || 14, shi = Math.max(slo, o.star_max_size || 30);
  const put = (i, count, a, b, list, star) => {
    const s = Math.round(a + r() * (b - a));
    const y = Math.round(((i + r() * 0.8) / count) * Math.max(0, h - s));   // spread top to bottom, jittered
    let x = Math.round(r() * Math.max(0, w - s));
    if (inMiddle(x, y, s)) x = r() < 0.5 ? Math.round(r() * Math.max(0, w * 0.25 - s)) : Math.round(w * 0.75 + r() * Math.max(0, w * 0.25 - s));   // move it to a side
    out.push({ x, y, s, star, color: list[Math.floor(r() * list.length)], tilt: star ? Math.round((r() - 0.5) * 50) : 0 });
  };
  for (let i = 0; i < n; i++) put(i, n, lo, hi, colors, false);
  for (let i = 0; i < ns; i++) put(i, ns, slo, shi, scol, true);
  return out;
}

/** One small SVG shape (a path in a 24 x 24 box) as an absolutely placed element. */
function shape(path, fill, x, y, s, extra) {
  const d = el('div');
  d.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + s + 'px;height:' + s + 'px;' + (extra || '');
  d.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="' + path + '" fill="' + fill + '"/></svg>';
  return d;
}

// whole_screen: the drawing goes on its own layer that covers the whole pane, behind every widget, wherever the widget's own box is.
// The layer is removed with the widget.
export function wholeScreen(ctx) {
  const st = ctx.root.parentNode, W = (st && st.offsetWidth) || 1080, H = (st && st.offsetHeight) || 1920;
  const host = el('div', 'gp-screen-layer');
  host.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;z-index:-1;pointer-events:none';
  if (st) st.insertBefore(host, st.firstChild);
  ctx.onDestroy(() => host.remove());
  return { W, H, host };
}

export function sparkles(ctx) {
  const o = ctx.opts;
  const screen = o.whole_screen ? wholeScreen(ctx) : null, host = screen ? screen.host : ctx.root;
  if (screen) ctx = { ...ctx, w: screen.W, h: screen.H };
  daily(ctx, (day) => {
    clear(host);
    const box = el('div');
    box.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;pointer-events:none';
    if (o.twinkle) box.className = 'gp-motion';
    sparkleLayout(o, ctx.w || 200, ctx.h || 600, 'sparkles' + ctx.paneId + ctx.widgetId + (o.change === 'never' ? '' : day)).forEach((p, i) => {
      const op = p.star ? 0.92 : 0.8;
      box.appendChild(shape(p.star ? STAR5 : o.shape === 'kira' ? KIRA : TWINKLE4, p.color, p.x, p.y, p.s, 'opacity:' + op + ';--o:' + op + (p.tilt ? ';transform:rotate(' + p.tilt + 'deg)' : '') +
        (o.twinkle ? ';animation:gp-twinkle ' + (3 + (i % 5)) + 's ease-in-out ' + ((i % 7) * 0.6).toFixed(1) + 's infinite' : '')));
    });
    host.appendChild(box);
  });
}

// ---------------------------------------------------------------- weather radar
// The picture of a radar `image.*` or `camera.*` entity (Environment Canada, Buienradar, a Generic Camera pointed at a radar image ...),
// shrunk by Home Assistant to the widget's size, in a frame that sits well on glass: rounded corners, a thin edge, dimmed a little so
// the bright map colours don't glare through a mirror, and the time it was last updated. Nothing is fetched from outside Home Assistant.

/** How often (seconds) to ask for the picture again: the option when set (at least 30 s), else 2 minutes for a camera, 10 for an image. */
export function radarEvery(entity, refresh) {
  const s = Number(refresh);
  if (s > 0) return Math.max(30, s);
  return !entity ? 300 : String(entity).startsWith('camera.') ? 120 : 600;   // no entity: a web address, every 5 minutes
}

/** Where the corner labels go: in a round frame the corners are outside the picture, so they sit at the top and bottom middle. */
export function radarSpots(frame) {
  return frame === 'circle'
    ? { title: 'left:50%;top:7%;transform:translateX(-50%)', updated: 'left:50%;bottom:7%;transform:translateX(-50%)' }
    : { title: 'left:.6em;top:.6em', updated: 'right:.6em;bottom:.6em' };
}

/**
 * The address of the US radar composite (every NEXRAD radar, in colour) from the Iowa Environmental Mesonet's RadMap service, for a region
 * and the extra layers asked for, at the widget's size. US only. Exported for the tests.
 */
export function compositeUrl(o, w, h) {
  const region = String(o.region || 'conus').toLowerCase();
  const q = region.length === 3 && !['lot', 'hun', 'iem', 'ict'].includes(region) ? 'sector=wfo&sector_wfo=' + region.toUpperCase() : 'sector=' + encodeURIComponent(region);
  const extra = { counties: 'uscounties', roads: 'interstates', places: 'places', temps: 'airtemps', warnings: 'sbw' };
  const layers = ['nexrad'].concat((Array.isArray(o.layers) ? o.layers : ['counties']).map((k) => extra[k]).filter(Boolean));
  return 'https://mesonet.agron.iastate.edu/GIS/radmap.php?' + q + '&width=' + Math.round(w) + '&height=' + Math.round(h) + layers.map((l) => '&layers%5B%5D=' + l).join('');
}

/** A web address with a value that changes each time, so the display never shows a stale cached copy. */
export function freshUrl(url, now) {
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_gp=' + Math.floor(now / 1000);
}

/** The time a radar picture is from: an image entity's state is the moment its picture changed; a camera has none, so the time we got it. */
export function radarTime(state, fetchedAt) {
  const t = state && /^image\./.test(state.entity_id || '') ? Date.parse(state.state) : NaN;
  return isFinite(t) ? t : fetchedAt;
}

export function radar(ctx) {
  const o = ctx.opts, entity = ctx.slots && ctx.slots.entity;
  const address = o.source === 'us_composite' ? compositeUrl(o, ctx.w || 600, ctx.h || 600) : o.url;
  const web = !entity && /^https:\/\//.test(address || '');
  const frame = o.frame || 'rounded', R = frame === 'circle' ? '50%' : frame === 'rounded' ? (o.radius == null ? 24 : o.radius) + 'px' : '0';
  const box = el('div', 'gp-radar');
  box.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;border-radius:' + R +
    (frame !== 'none' && o.border !== false ? ';box-shadow:inset 0 0 0 1px var(--gp-line, rgba(255,255,255,.25))' : '');
  ctx.root.appendChild(box);
  const label = (text, corner) => {
    const d = el('div', 'gp-label', text);
    d.style.cssText = 'position:absolute;' + corner + ';z-index:2;padding:.15em .55em;border-radius:1em;background:rgba(0,0,0,.55);font-size:' +
      Math.max(12, Math.round((ctx.style.size || 22) * 0.75)) + 'px;white-space:nowrap';
    box.appendChild(d);
    return d;
  };
  if (!entity && !web) {   // nothing set (a shipped pane): an empty frame with a word, never a broken picture
    const d = el('div', 'gp-dim', 'Radar: bind a radar camera or image, or give a radar picture address');
    d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:1em;font-size:' + Math.max(12, Math.round((ctx.style.size || 22) * 0.8)) + 'px';
    box.appendChild(d);
    return;
  }
  const img = el('img');
  img.alt = '';
  const dim = Math.max(0, Math.min(80, o.dim == null ? 20 : o.dim));
  // grayscale: black and white, a little crisper, so a bright map sits quietly on a mirror (the same look as the image widget's option)
  const filters = (o.grayscale ? 'grayscale(1) contrast(1.25) ' : '') + (dim ? 'brightness(' + (1 - dim / 100).toFixed(2) + ')' : '');
  img.style.cssText = 'display:block;width:100%;height:100%;object-fit:' + (o.fit || 'cover') + (filters ? ';filter:' + filters.trim() : '') +
    (o.anchor === 'top' || o.anchor === 'bottom' ? ';object-position:50% ' + (o.anchor === 'top' ? '0%' : '100%') : '');
  const spot = radarSpots(frame);
  if (o.label) label(o.label, spot.title);
  const when = o.show_updated === false ? null : label('', spot.updated);
  if (when) when.style.display = 'none';
  const stamp = (t) => { if (when) { when.textContent = (o.updated_text != null ? o.updated_text : 'Updated') + ' ' + ctx.time.ampm(new Date(t)); when.style.display = ''; } };
  if (web) {
    // a public radar picture on the web, loaded by the display itself; the new copy loads off screen first, so the old one stays up
    // if the site is slow or down
    ctx.every(radarEvery(null, o.refresh_s) * 1000, () => {
      const next = new Image();
      next.onload = () => { if (!ctx.root.isConnected) return; img.src = next.src; if (!img.isConnected) box.insertBefore(img, box.firstChild); stamp(Date.now()); };
      next.src = freshUrl(address, Date.now());
    });
    return;
  }
  let current = null;
  const forget = (u) => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); };
  ctx.onDestroy(() => forget(current));
  const w = Math.round(ctx.w || 600), h = Math.round(ctx.h || 600);
  ctx.refresh(async () => {
    const [src, st] = await Promise.all([ctx.data.picture(entity, w, h), ctx.data.state(entity)]);
    if (!src || !ctx.root.isConnected) return;
    const old = current;
    current = src;
    img.src = src;
    if (!img.isConnected) box.insertBefore(img, box.firstChild);
    forget(old);
    stamp(radarTime(st, Date.now()));
  }, [entity], radarEvery(entity, o.refresh_s) * 1000);
}

// ---------------------------------------------------------------- ASCII art (Decorations)
// Text art in a monospace font: a piece from the small built-in library (all drawn for Glass Panes, plain ASCII only, so the bundled
// JetBrains Mono (SIL Open Font License) draws every character), your own typed art, a big ASCII clock, or an ASCII weather picture.
// Looks: green or amber terminal (a soft glow, optional scanlines and a blinking cursor) or plain (the widget's own colour).
// The box sizes the text (fit), so the art always fits whatever size the widget is.

export const ASCII_ART = {
  coffee: [
    '    ( (',
    '     ) )',
    '  ........',
    '  |      |]',
    '  \\      /',
    "   `----'",
  ],
  cat: [
    '   /\\     /\\',
    '  /  \\___/  \\',
    ' |  o     o  |',
    ' |     w     |',
    '  \\_________/',
    '   |  | |  |',
  ],
  mountains: [
    '        /\\',
    '       /  \\    /\\',
    '      / /\\ \\  /  \\',
    '     / /  \\ \\/ /\\ \\',
    '  __/_/____\\__/__\\_\\__',
  ],
  rocket: [
    '     /\\',
    '    /  \\',
    '   | () |',
    '   |    |',
    '   | GP |',
    '  /|    |\\',
    ' /_|____|_\\',
    '    /\\/\\',
    "   ' ' ' '",
  ],
  sun: [
    '    \\   |   /',
    '     \\  |  /',
    '  --- (   ) ---',
    '     /  |  \\',
    '    /   |   \\',
  ],
  moon: [
    '   *       .',
    '       _..',
    "  .   /  .'   *",
    '     |  (',
    "      \\  '._   .",
    "   *   `-..-'",
  ],
  plant: [
    '     \\ | /',
    '    --(*)--',
    '     / | \\',
    '       |',
    '    \\  |  /',
    '     \\_|_/',
    '     |   |',
    '     |___|',
  ],
  waves: [
    '   .-~~~-.     .-~~~-.',
    '  /       \\   /       \\',
    ' ~         ~~~         ~~~',
  ],
  heart: [
    '   .--.   .--.',
    '  /    \\ /    \\',
    "  \\     '     /",
    '   \\         /',
    '    \\       /',
    '     \\     /',
    '      \\   /',
    '       \\ /',
    "        '",
  ],
  house: [
    '       ____||____',
    '      /          \\',
    '     /____________\\',
    '      |  _    _  |',
    '      | |_|  |_| |',
    '      |    __    |',
    '      |___|  |___|',
  ],
};

// a 3 x 5 block font for the ASCII clock, drawn with '#'
const DIGITS = {
  0: ['###', '# #', '# #', '# #', '###'], 1: [' # ', '## ', ' # ', ' # ', '###'], 2: ['###', '  #', '###', '#  ', '###'],
  3: ['###', '  #', ' ##', '  #', '###'], 4: ['# #', '# #', '###', '  #', '  #'], 5: ['###', '#  ', '###', '  #', '###'],
  6: ['###', '#  ', '###', '# #', '###'], 7: ['###', '  #', ' # ', ' # ', ' # '], 8: ['###', '# #', '###', '# #', '###'],
  9: ['###', '# #', '###', '  #', '###'], ':': [' ', '#', ' ', '#', ' '], ' ': [' ', ' ', ' ', ' ', ' '],
};
/** Big ASCII digits for a time such as "9:05": five lines of '#' blocks, one space between characters. */
export function bigDigits(text) {
  const rows = ['', '', '', '', ''];
  String(text).split('').forEach((c, i) => { const g = DIGITS[c] || DIGITS[' ']; g.forEach((r, k) => { rows[k] += (i ? ' ' : '') + r; }); });
  return rows;
}

// ASCII weather pictures by Home Assistant's weather condition names (drawn for Glass Panes)
const WX = {
  sun: ['   \\ | /', ' -- ( ) --', '   / | \\'],
  cloud: ['    .--.', ' .-(    ).', '(___.__)__)'],
  partly: ['  \\ /  .--.', ' -( )-(    ).', '  / (___.__)'],
  rain: ['    .--.', ' .-(    ).', '(___.__)__)', "  ' ' ' '", " ' ' ' '"],
  snow: ['    .--.', ' .-(    ).', '(___.__)__)', '  *  *  *', '   *  *'],
  storm: ['    .--.', ' .-(    ).', '(___.__)__)', '    /_  /_', '     /   /'],
  fog: [' _ - _ - _ -', '  _ - _ - _', ' _ - _ - _ -'],
  night: ['    _..', "   /  .'", '  |  (', "   \\  '._", "    `-..-'"],
  wind: ['  ~~~~~~>', ' ~~~~~>', '   ~~~~~~~>'],
};
const WX_OF = {
  sunny: 'sun', 'clear-night': 'night', cloudy: 'cloud', partlycloudy: 'partly', rainy: 'rain', pouring: 'rain', snowy: 'snow',
  'snowy-rainy': 'snow', hail: 'snow', lightning: 'storm', 'lightning-rainy': 'storm', fog: 'fog', windy: 'wind', 'windy-variant': 'wind', exceptional: 'storm',
};
/** The ASCII weather picture for a condition, with the temperature line under it. */
export function asciiWeather(condition, temp, unit) {
  const art = WX[WX_OF[condition] || 'cloud'];
  const t = temp == null || temp === '' || isNaN(Number(temp)) ? '--' : String(Math.round(Number(temp)));
  const words = { partlycloudy: 'partly cloudy', 'clear-night': 'clear', 'snowy-rainy': 'sleet', 'lightning-rainy': 'thunderstorms', 'windy-variant': 'windy' }[condition];
  return art.concat(['', '  ' + t + (unit || '\u00b0') + '  ' + (words || String(condition || '').replace(/-/g, ' '))]);
}

/** The lines to draw: your own text, or a library piece (unknown names fall back to the first one). Tabs become spaces; trailing blank lines go. */
export function asciiLines(o) {
  if (o.art === 'custom' || (!o.art && o.text)) {
    const lines = String(o.text || '').replace(/\t/g, '    ').replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.slice(0, 60).map((l) => l.slice(0, 160));
  }
  return (ASCII_ART[o.art] || ASCII_ART.coffee).slice();
}

/** The font size (px) that fits `lines` in a w x h box: monospace characters are about 0.6 em wide, lines 1.15 em apart. */
export function asciiFit(lines, w, h) {
  const cols = Math.max(1, ...lines.map((l) => l.length)), rows = Math.max(1, lines.length);
  return Math.max(6, Math.floor(Math.min(w / (cols * 0.61), h / (rows * 1.15))));
}

const TERMINAL = { green: '#3dff7a', amber: '#ffb000' };
export function asciiArt(ctx) {
  const o = ctx.opts, look = o.look || 'green', ink = TERMINAL[look];
  const pre = el('pre', 'gp-ascii');
  pre.style.cssText = "margin:0;font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;line-height:1.15;white-space:pre;overflow:hidden;font-weight:400" +
    (ink ? ';color:' + ink + ';text-shadow:0 0 .35em ' + ink + '88' : '');
  const wrap = el('div');
  wrap.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:' + ({ left: 'flex-start', right: 'flex-end' }[ctx.style.align] || 'center');
  wrap.appendChild(pre);
  if (o.scanlines && ink) {     // a static pattern of faint dark lines over the text (no animation)
    const sl = el('div');
    sl.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0, rgba(0,0,0,0) 2px, rgba(0,0,0,.35) 3px, rgba(0,0,0,0) 4px)';
    wrap.appendChild(sl);
  }
  clear(ctx.root);
  ctx.root.appendChild(wrap);
  let cursor = null;
  if (o.cursor) {
    cursor = el('span', 'gp-motion', '_');
    cursor.style.animation = 'gp-blink 1.1s infinite';
  }
  const draw = (lines) => {
    pre.style.fontSize = (o.fit === false ? (ctx.style.size || 24) : asciiFit(cursor ? lines.concat(['_']) : lines, ctx.w || 400, ctx.h || 300)) + 'px';
    const text = lines.join('\n');
    if (pre.firstChild && pre.firstChild.nodeValue === text) return;
    pre.textContent = text;
    if (cursor) pre.appendChild(cursor);
  };
  const show = o.show || 'art';
  if (show === 'clock') {
    ctx.every(5000, () => {
      const p = ctx.time.parts(new Date());
      const h = o.format === '24h' ? String(p.h).padStart(2, '0') : String(p.h % 12 || 12);
      draw(bigDigits(h + ':' + String(p.mi).padStart(2, '0')));
    });
  } else if (show === 'weather') {
    const entity = ctx.slots && ctx.slots.weather;
    if (!entity) { draw(asciiWeather('sunny', null)); return; }
    ctx.refresh(async () => {
      const s = await ctx.data.state(entity), a = (s && s.attributes) || {};
      draw(asciiWeather(s && s.state, a.temperature, a.temperature_unit));
    }, [entity], 0);
  } else draw(asciiLines(o));
}

// ---------------------------------------------------------------- anime-inspired looks (our own drawings and effects only)
// Inspired by the style, never by any real show: no characters, logos, names or art from any anime, manga or other franchise.

// ---- petals: cherry-blossom petals drifting down through the box (Decorations). CSS transform animation only, a capped count, and
// `motion: still` for a scattered, perfectly still version (the lightest on a mirror).
export const PETAL = 'M12 23C7 19 4.4 13 7.3 7.2C8.4 5 10 3.7 11 3.2L12 5.2L13 3.2C14 3.7 15.6 5 16.7 7.2C19.6 13 17 19 12 23Z';
export const PETAL_PALETTES = {
  sakura: ['#ffc4d6', '#ffb0c8', '#ffd9e4', '#f9a8c0', '#ffe4ec'],
  plum: ['#f48fb1', '#e57399', '#f8bbd0', '#d81b60'],
  white: ['#ffffff', '#f6f1f3', '#fbe9ee'],
  autumn: ['#ff9f43', '#e8b04a', '#d9453d', '#f5c542', '#c0602a'],
};
const PETAL_SPEED = { slow: 18, medium: 12, fast: 8 };

/** Each petal: { x, y, s, color, dur, delay, dx, spin, sway } for a w x h box. Pure (tested). */
export function petalLayout(o, w, h, seed) {
  const r = rng(seed), out = [];
  const colors = paletteOf(o.palette || 'sakura', o.colors, PETAL_PALETTES, 'sakura');
  const n = Math.max(0, Math.min(40, o.count == null ? 14 : o.count));
  const lo = o.min_size || 16, hi = Math.max(lo, o.max_size || 30), base = PETAL_SPEED[o.speed] || PETAL_SPEED.slow;
  for (let i = 0; i < n; i++) {
    const s = Math.round(lo + r() * (hi - lo)), dur = +(base * (0.8 + r() * 0.5)).toFixed(1);
    out.push({
      x: Math.round(((i + r()) / n) * Math.max(0, w - s)), y: Math.round(r() * Math.max(0, h - s)), s, color: colors[Math.floor(r() * colors.length)],
      dur, delay: -+(r() * dur).toFixed(1), dx: Math.round((r() - 0.3) * 120), spin: Math.round(180 + r() * 360) * (r() < 0.5 ? -1 : 1),
      sway: Math.round(8 + r() * 16), swayDur: +(3 + r() * 3).toFixed(1),
    });
  }
  return out;
}

export function petals(ctx) {
  const o = ctx.opts, W = ctx.w || 400, H = ctx.h || 800, still = o.motion === 'still';
  const draw = (day) => {
    clear(ctx.root);
    const box = el('div', still ? '' : 'gp-motion');
    box.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;pointer-events:none';
    petalLayout(o, W, H, 'petals' + ctx.paneId + ctx.widgetId + (still ? day : '')).forEach((p) => {
      const op = (o.opacity == null ? 85 : o.opacity) / 100;
      if (still) { box.appendChild(shape(PETAL, p.color, p.x, p.y, p.s, 'opacity:' + op + ';transform:rotate(' + p.spin + 'deg)')); return; }
      // the outer element falls (and turns); the inner one sways from side to side
      const fall = el('div');
      fall.style.cssText = 'position:absolute;left:' + p.x + 'px;top:' + (-p.s - 4) + 'px;width:' + p.s + 'px;height:' + p.s + 'px;opacity:' + op +
        ';--fall:' + (H + p.s * 2 + 8) + 'px;--dx:' + p.dx + 'px;--spin:' + p.spin + 'deg;animation:gp-fall ' + p.dur + 's linear ' + p.delay + 's infinite;will-change:transform';
      const sway = shape(PETAL, p.color, 0, 0, p.s, 'position:relative;--sw:' + p.sway + 'px;animation:gp-sway ' + p.swayDur + 's ease-in-out ' + p.delay + 's infinite');
      sway.style.left = '0'; sway.style.top = '0';
      fall.appendChild(sway);
      box.appendChild(fall);
    });
    ctx.root.appendChild(box);
  };
  if (still) daily(ctx, draw); else draw('');
}

// ---- chibi-style weather icons (the weather widget's `icon: chibi`): round, soft shapes with little faces, drawn for Glass Panes
const INK = '#3a2a2a', CHEEK = '#ff9fb2';
const face = (cx, cy, k, eyes) => {
  const e = { dot: () => '<circle cx="' + (cx - 4.5 * k) + '" cy="' + cy + '" r="' + 1.6 * k + '" fill="' + INK + '"/><circle cx="' + (cx + 4.5 * k) + '" cy="' + cy + '" r="' + 1.6 * k + '" fill="' + INK + '"/>',
    happy: () => [-1, 1].map((d) => '<path d="M' + (cx + d * 4.5 * k - 2 * k) + ' ' + (cy + 0.8 * k) + ' q' + 2 * k + ' ' + -2.6 * k + ' ' + 4 * k + ' 0" stroke="' + INK + '" stroke-width="' + 1.3 * k + '" fill="none" stroke-linecap="round"/>').join(''),
    sleepy: () => [-1, 1].map((d) => '<path d="M' + (cx + d * 4.5 * k - 2 * k) + ' ' + cy + ' h' + 4 * k + '" stroke="' + INK + '" stroke-width="' + 1.3 * k + '" stroke-linecap="round"/>').join(''),
    squint: () => [-1, 1].map((d) => '<path d="M' + (cx + d * 4.5 * k - 1.8 * d * k) + ' ' + (cy - 1.8 * k) + ' l' + 1.8 * d * k + ' ' + 1.8 * k + ' l' + -1.8 * d * k + ' ' + 1.8 * k + '" stroke="' + INK + '" stroke-width="' + 1.2 * k + '" fill="none" stroke-linecap="round"/>').join('') }[eyes]();
  const mouth = eyes === 'squint' ? '<path d="M' + (cx - 1.5 * k) + ' ' + (cy + 4 * k) + ' h' + 3 * k + '" stroke="' + INK + '" stroke-width="' + 1.2 * k + '" stroke-linecap="round"/>'
    : '<path d="M' + (cx - 2 * k) + ' ' + (cy + 3 * k) + ' q' + 2 * k + ' ' + 2 * k + ' ' + 4 * k + ' 0" stroke="' + INK + '" stroke-width="' + 1.2 * k + '" fill="none" stroke-linecap="round"/>';
  const cheeks = [-1, 1].map((d) => '<ellipse cx="' + (cx + d * 8 * k) + '" cy="' + (cy + 2.6 * k) + '" rx="' + 2 * k + '" ry="' + 1.2 * k + '" fill="' + CHEEK + '" opacity=".75"/>').join('');
  return e + mouth + cheeks;
};
const cloud = (x, y, k, fill) => '<path d="M' + x + ' ' + (y + 12 * k) + ' a' + 6 * k + ' ' + 6 * k + ' 0 0 1 ' + 3 * k + ' ' + -11.5 * k + ' a' + 8 * k + ' ' + 8 * k + ' 0 0 1 ' + 15 * k + ' ' + -3 * k +
  ' a' + 6.5 * k + ' ' + 6.5 * k + ' 0 0 1 ' + 10 * k + ' ' + 6 * k + ' a' + 5 * k + ' ' + 5 * k + ' 0 0 1 ' + -1 * k + ' ' + 8.5 * k + ' z" fill="' + fill + '"/>';
const sunDisc = (cx, cy, r) => {
  let rays = '';
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; rays += '<line x1="' + (cx + Math.cos(a) * r * 1.3).toFixed(1) + '" y1="' + (cy + Math.sin(a) * r * 1.3).toFixed(1) + '" x2="' + (cx + Math.cos(a) * r * 1.62).toFixed(1) + '" y2="' + (cy + Math.sin(a) * r * 1.62).toFixed(1) + '" stroke="#ffb703" stroke-width="2.6" stroke-linecap="round"/>'; }
  return rays + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#ffd166"/>';
};
const drops = (color, kind) => [10, 20, 30].map((x, i) => kind === 'snow' ? '<circle cx="' + (x + 3) + '" cy="' + (40 + (i % 2) * 4) + '" r="2.2" fill="' + color + '"/>'
  : '<path d="M' + (x + 3) + ' ' + (37 + (i % 2) * 3) + ' q-2.4 3.6 0 5.4 q2.4 -1.8 0 -5.4z" fill="' + color + '"/>').join('');

/** The SVG (48 x 48) of a chibi weather icon for a Home Assistant weather condition. Pure (tested). */
export function chibiSvg(cond) {
  const kind = { sunny: 'sun', 'clear-night': 'night', partlycloudy: 'partly', cloudy: 'cloud', rainy: 'rain', pouring: 'rain', snowy: 'snow', 'snowy-rainy': 'snow', hail: 'snow',
    lightning: 'storm', 'lightning-rainy': 'storm', fog: 'fog', windy: 'wind', 'windy-variant': 'wind', exceptional: 'storm' }[cond] || 'cloud';
  let body;
  if (kind === 'sun') body = sunDisc(24, 24, 12) + face(24, 24, 1, 'happy');
  else if (kind === 'night') body = '<path d="M30 6a17 17 0 1 0 12 28a14 14 0 1 1 -12 -28z" fill="#ffe8a3"/>' + face(22, 26, 0.9, 'sleepy') +
    '<text x="34" y="14" font-size="9" font-family="sans-serif" font-weight="700" fill="#bcd4ff">z</text>';
  else if (kind === 'partly') body = sunDisc(32, 15, 8) + cloud(6, 20, 1, '#ffffff') + face(21, 27, 0.85, 'dot');
  else if (kind === 'rain') body = cloud(5, 12, 1.05, '#dfe8f5') + face(21, 20, 0.85, 'dot') + drops('#6fb4ff', 'rain');
  else if (kind === 'snow') body = cloud(5, 12, 1.05, '#ffffff') + face(21, 20, 0.85, 'happy') + drops('#e8f4ff', 'snow');
  else if (kind === 'storm') body = cloud(5, 10, 1.05, '#b9c2d3') + face(21, 18, 0.85, 'squint') + '<path d="M25 30l-6 9h5l-3 8l9 -11h-5l3 -6z" fill="#ffd166"/>';
  else if (kind === 'fog') body = cloud(5, 8, 1.05, '#eef1f5') + face(21, 16, 0.85, 'sleepy') + [32, 38, 44].map((y, i) => '<path d="M' + (8 + i * 3) + ' ' + y + 'h' + (30 - i * 4) + '" stroke="#c9d1dc" stroke-width="2.4" stroke-linecap="round"/>').join('');
  else if (kind === 'wind') body = cloud(4, 12, 1.0, '#ffffff') + face(19, 20, 0.85, 'squint') + '<path d="M36 18h7M38 24h8M36 30h6" stroke="#bfe8ff" stroke-width="2.4" stroke-linecap="round"/>';
  else body = cloud(5, 12, 1.05, '#ffffff') + face(21, 20, 0.85, 'happy');
  return '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + body + '</svg>';
}

/** Put a chibi icon in front of the weather widget's text (called by widgets.js after each draw). */
export function chibiWeather(ctx, cond, size, stacked) {
  const old = ctx.root.querySelector('.gp-chibi');
  if (old) old.remove();
  const s = Math.round(size * (stacked ? 1.5 : 1.15));
  const span = el('span', 'gp-chibi');
  span.style.width = s + 'px'; span.style.height = s + 'px';
  if (stacked) { span.style.display = 'block'; span.style.marginBottom = '.15em'; }
  span.innerHTML = chibiSvg(cond);
  ctx.root.insertBefore(span, ctx.root.firstChild);
}

// ---------------------------------------------------------------- art pond (Decorations): your own cut-outs, arranged anew each day
// The mechanism of a water-lily pond strip, for pictures the person uploads to their own media library (small PNG or WebP cut-outs with
// see-through backgrounds). Each piece has a role: `base` pieces (lily pads, leaves ...) gather in overlapping groups that float on their
// own patch of open water, `accent` pieces (flowers ...) sit on top of a group, and `edge` pieces (grass, reeds ...) stand along the bottom
// in the gaps. A group's "distance" sets its size and height in the strip: far is small, high and a little faded; near is big, low and
// drawn on top. Groups never touch each other.
// Two sets: `monet_lilies` (the default), cut-outs from Claude Monet's Water Lilies paintings (public domain) shipped in
// player/art/monet-lilies/ exactly as they were made, and `own`, the person's own uploads (`pieces`).

/**
 * Where every piece goes, for pieces [{ id, role, w, h }] (w, h: the picture's own size) in a W x H box. Returns
 * [{ id, x, bottom, w, h, z, opacity }] (x from the left, bottom up from the bottom edge). Pure and seeded (tested).
 */
export function pondLayout(pieces, o, W, H, seed) {
  const R = rng(seed), out = [];
  const ok = (p) => p && p.id && p.w > 0 && p.h > 0;
  const role = (r) => pieces.filter((p) => ok(p) && p.role === r);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(R() * a.length)];
  const lim = (v, d, lo, hi) => Math.max(lo, Math.min(hi, v == null ? d : v));
  let bases = role('base'), accents = role('accent');
  if (!bases.length) { bases = accents; accents = []; }          // only one kind given: they make the groups themselves
  const edges = shuffle(role('edge'));
  const nc = lim(o.clusters, 5, 0, 12), per = lim(o.per_cluster, 5, 1, 8), nAcc = lim(o.accents, 2, 0, 4), nEdge = lim(o.edge, 3, 0, 12);
  const scale = lim(o.size, 240, 60, 600) / 240, depth = o.depth !== false;
  const taken = [], GAP = 10;
  const free = (b) => !taken.some((q) => b.l < q.l + q.w + GAP && b.l + b.w + GAP > q.l && b.t < q.t + q.h + GAP && b.t + b.h + GAP > q.t);
  // one group `cw` px wide: its pictures in group-local pixels (x from the left, y up from the bottom)
  const group = (cw, np, nf) => {
    const rx = cw * 0.5, ry = cw * 0.13, items = [];
    for (let i = 0; i < np; i++) {
      const a = (i / np) * 6.283 + R() * 0.9, r = 0.35 + R() * 0.65;   // round an ellipse, weighted to the middle
      const b = pick(bases), pw = cw * (0.28 + R() * 0.2), ph = pw * b.h / b.w;
      items.push({ id: b.id, w: pw, h: ph, x: rx + Math.cos(a) * r * (rx - pw * 0.45) - pw / 2, y: ry + Math.sin(a) * r * ry - ph / 2 });
    }
    items.sort((p, q) => p.y - q.y);                                   // lower = nearer = drawn later (on top)
    const list = items.slice();
    if (accents.length) {
      const tops = shuffle(items.slice());
      for (let i = 0; i < Math.min(nf, tops.length); i++) {
        const p = tops[i], f = pick(accents), fw = Math.min(p.w * (0.34 + R() * 0.16), 70 + cw * 0.1), fh = fw * f.h / f.w;
        list.push({ id: f.id, w: fw, h: fh, x: p.x + Math.max(0, Math.min(p.w - fw, (p.w - fw) / 2 + (R() - 0.5) * p.w * 0.5)), y: p.y + p.h * (0.3 + R() * 0.12), top: true });
      }
    }
    const minX = Math.min(...list.map((p) => p.x)), minY = Math.min(...list.map((p) => p.y));
    list.forEach((p) => { p.x -= minX; p.y -= minY; });
    return { list, w: Math.max(...list.map((p) => p.x + p.w)), h: Math.max(...list.map((p) => p.y + p.h)) };
  };
  if (bases.length && nc) {
    const depths = [];
    for (let i = 0; i < nc; i++) depths.push(depth ? (i + R() * 0.9) / nc : 0.6);
    shuffle(depths).forEach((d) => {
      for (let k = 0; k < 150; k++) {
        const cw = Math.round((240 + 190 * d) * scale * (0.9 + R() * 0.25) * (k > 80 ? 0.8 : 1));
        const g = group(cw, Math.max(Math.min(2, per), Math.round(per * (0.55 + R() * 0.45))), Math.max(nAcc ? 1 : 0, Math.round(nAcc * (0.5 + R() * 0.7))));
        if (g.h > H - 6 || g.w > W) continue;
        const bottom = Math.round((1 - d) * (H - g.h - 12) + R() * 10 + 6);
        const b = { l: Math.round(R() * (W - g.w)), t: H - bottom - g.h, w: g.w, h: g.h };
        if (!free(b)) continue;
        taken.push(b);
        const op = depth ? +(0.6 + 0.4 * d).toFixed(2) : 1, z0 = 2 + Math.round(d * 10) * 12;
        g.list.forEach((p, i) => out.push({ id: p.id, x: Math.round(b.l + p.x), bottom: Math.round(bottom + p.y), w: Math.round(p.w), h: Math.round(p.h), z: z0 + i + (p.top ? 40 : 0), opacity: op }));
        return;
      }
    });
  }
  // edge pieces go into whatever gaps the groups left, standing on the bottom edge
  for (let i = 0; i < Math.min(nEdge, edges.length * 3); i++) {
    const e = edges[i % edges.length], w = Math.round((80 + R() * 50) * scale), h = Math.round(w * e.h / e.w);
    if (h > H) continue;
    for (let k = 0; k < 40; k++) {
      const b = { l: Math.round(R() * Math.max(0, W - w)), t: H - h, w, h };
      if (free(b)) { taken.push(b); out.push({ id: e.id, x: b.l, bottom: 0, w, h, z: 1, opacity: 1 }); break; }
    }
  }
  return out;
}

/** The media ids an art pond uses (also what the builder must leave out when a pane is exported). */
export const pondMedia = (o) => (Array.isArray(o && o.pieces) ? o.pieces : []).map((p) => p && p.media).filter(Boolean);

// the built-in set: sizes.json maps each picture to [width, height, kind]; kinds pad / flower / grass are the base / accent / edge roles
const MONET = new URL('./art/monet-lilies/', import.meta.url);
const KIND_ROLE = { pad: 'base', flower: 'accent', grass: 'edge' };
/** The built-in set's pieces from its sizes.json. Pure (tested). */
export function setPieces(sizes, base) {
  return Object.entries(sizes || {}).filter(([, v]) => KIND_ROLE[v[2]]).map(([name, v]) => ({ id: name, role: KIND_ROLE[v[2]], w: v[0], h: v[1], url: base + name + '.png' }));
}

export function artPond(ctx) {
  const o = ctx.opts, own = o.set === 'own';
  const list = own ? (Array.isArray(o.pieces) ? o.pieces : []).filter((p) => p && p.media).slice(0, 40) : [];
  const box = el('div');
  box.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;pointer-events:none';
  ctx.root.appendChild(box);
  if (own && !list.length) {
    const d = el('div', 'gp-dim', 'Art pond: add your own cut-out pictures in the builder');
    d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:1em;font-size:' + Math.max(12, Math.round((ctx.style.size || 22) * 0.8)) + 'px';
    box.appendChild(d);
    return;
  }
  // your own pictures: each one's address (a signed link from the media library) and its own size, read once
  const loadOne = (p) => Promise.resolve(ctx.data.mediaUrl && ctx.data.mediaUrl(p.media)).then((url) => new Promise((done) => {
    if (!url) { done(null); return; }
    const im = new Image();
    im.onload = () => done({ id: p.media, role: p.role || 'base', w: im.naturalWidth, h: im.naturalHeight, url });
    im.onerror = () => done(null);
    im.src = url;
  })).catch(() => null);
  const load = () => (own ? Promise.all(list.map(loadOne)).then((a) => a.filter(Boolean))
    : fetch(new URL('sizes.json', MONET).href).then((r) => r.json()).then((S) => setPieces(S, MONET.href)).catch(() => []));
  let pieces = null;
  const draw = async (day) => {
    if (!pieces) pieces = await load();
    if (!ctx.root.isConnected) return;
    clear(box);
    const url = new Map(pieces.map((p) => [p.id, p.url]));
    pondLayout(pieces, o, ctx.w || 1000, ctx.h || 300, 'pond' + ctx.paneId + ctx.widgetId + (o.change === 'never' ? '' : day)).forEach((p) => {
      const im = el('img');
      im.alt = '';
      im.src = url.get(p.id);
      im.style.cssText = 'position:absolute;left:' + p.x + 'px;bottom:' + p.bottom + 'px;width:' + p.w + 'px;height:' + p.h + 'px;z-index:' + p.z + ';opacity:' + p.opacity;
      box.appendChild(im);
    });
  };
  daily(ctx, draw);
  if (own) ctx.every(6 * 3600000, () => { pieces = null; });   // signed links expire after some days: fresh ones now and then (used at the next redraw)
}

// widget type names (widgets.js looks the renderer up by type)
export { asciiArt as ascii_art, artPond as art_pond };
