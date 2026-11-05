// The editing rules for the builder: moving, resizing, aligning, adding. Plain functions on plain data (no page needed), so they can
// be tested on their own.
//
// A "rect" is where a widget really is on the 1080x1920 canvas: {x, y, w, h}. It can differ from the saved numbers because widgets that
// flow or size themselves are placed by the engine. Whenever you move or resize a widget it is pinned to where it is shown plus your
// change: its `flow` goes away, and nothing else on the pane is touched.

import { themeColors } from '../player/themes.js';
import { foldShowIf, withoutReferences } from '../player/conditions.js';       // "show when" rules: pure helpers shared with the player

export const GRID = 40;
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;
const MIN_W = 40;
const MIN_H = 40;

export const snap = (v, g = GRID) => Math.round(v / g) * g;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const copy = (o) => JSON.parse(JSON.stringify(o));

/** A widget with new numbers; `flow` is dropped (it is placed by hand now). `auto_height` goes too when the height is set by hand. */
function placed(widget, box, { heightByHand = false } = {}) {
  const w = { ...foldShowIf(widget) };         // a flow.show_if survives as an ordinary "has content" rule when `flow` goes
  delete w.flow;
  w.x = Math.round(box.x); w.y = Math.round(box.y); w.w = Math.round(box.w);
  if (heightByHand || !widget.auto_height) { w.h = Math.round(box.h); if (heightByHand) delete w.auto_height; }
  return w;
}

/** The widget after a drag ends: moved by (dx, dy) from where it is shown, snapped to whole grid cells, and kept on the canvas. */
export function moved(widget, rect, dx, dy) {
  const w = widget.w;
  const h = widget.auto_height ? Math.min(widget.h, rect.h) : widget.h;
  const x = clamp(snap(rect.x + dx), 0, CANVAS_W - w);
  const y = clamp(snap(rect.y + dy), 0, CANVAS_H - h);
  return placed(widget, { x, y, w, h: widget.h });
}

/** Drag a handle ('nw','ne','sw','se','n','s','e','w') by (dx, dy): the dragged edges snap to the grid, the others stay put. */
export function resized(widget, rect, handle, dx, dy) {
  let left = rect.x, top = rect.y, right = rect.x + rect.w, bottom = rect.y + rect.h;
  if (handle.includes('w')) left = snap(left + dx);
  if (handle.includes('e')) right = snap(right + dx);
  if (handle.includes('n')) top = snap(top + dy);
  if (handle.includes('s')) bottom = snap(bottom + dy);
  left = clamp(left, 0, right - MIN_W); right = clamp(right, left + MIN_W, CANVAS_W);
  top = clamp(top, 0, bottom - MIN_H); bottom = clamp(bottom, top + MIN_H, CANVAS_H);
  const heightByHand = /[ns]/.test(handle) && (top !== rect.y || bottom !== rect.y + rect.h);
  const next = { x: left, y: top, w: right - left, h: heightByHand ? bottom - top : widget.h };
  return placed(widget, next, { heightByHand });
}

const bounds = (rects) => {
  const xs = rects.map((r) => r.x), ys = rects.map((r) => r.y);
  const x2 = rects.map((r) => r.x + r.w), y2 = rects.map((r) => r.y + r.h);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...x2), bottom: Math.max(...y2) };
};

/**
 * Line widgets up. mode: left | center | right | top | middle | bottom | distribute-h | distribute-v | same-width | same-height.
 * `ids` are the widgets to change and `rects` (id -> rect) say where they are. Returns a new widget list.
 */
export function aligned(widgets, ids, rects, mode) {
  const chosen = widgets.filter((w) => ids.includes(w.id) && rects[w.id]);
  if (chosen.length < 2) return widgets;
  const b = bounds(chosen.map((w) => rects[w.id]));
  const out = new Map();
  const put = (w, box, byHand) => out.set(w.id, placed(w, { ...rects[w.id], ...box }, { heightByHand: !!byHand }));
  if (mode === 'left') chosen.forEach((w) => put(w, { x: b.left }));
  else if (mode === 'right') chosen.forEach((w) => put(w, { x: b.right - rects[w.id].w }));
  else if (mode === 'center') chosen.forEach((w) => put(w, { x: (b.left + b.right) / 2 - rects[w.id].w / 2 }));
  else if (mode === 'top') chosen.forEach((w) => put(w, { y: b.top }));
  else if (mode === 'bottom') chosen.forEach((w) => put(w, { y: b.bottom - rects[w.id].h }));
  else if (mode === 'middle') chosen.forEach((w) => put(w, { y: (b.top + b.bottom) / 2 - rects[w.id].h / 2 }));
  else if (mode === 'same-width') chosen.forEach((w) => put(w, { w: rects[chosen[0].id].w }));
  else if (mode === 'same-height') chosen.forEach((w) => put(w, { h: rects[chosen[0].id].h }, true));
  else if (mode === 'distribute-h' || mode === 'distribute-v') {
    if (chosen.length < 3) return widgets;
    const horizontal = mode === 'distribute-h';
    const key = horizontal ? 'x' : 'y', size = horizontal ? 'w' : 'h';
    const sorted = [...chosen].sort((p, q) => rects[p.id][key] - rects[q.id][key]);
    const total = sorted.reduce((sum, w) => sum + rects[w.id][size], 0);
    const span = horizontal ? b.right - b.left : b.bottom - b.top;
    const gap = (span - total) / (sorted.length - 1);
    let at = horizontal ? b.left : b.top;
    sorted.forEach((w) => { put(w, { [key]: at }); at += rects[w.id][size] + gap; });
  } else return widgets;
  return widgets.map((w) => out.get(w.id) || w);
}

/** Keep every widget on the canvas after an alignment (rounding can leave one pixel over). */
export function keptOnCanvas(widgets) {
  return widgets.map((w) => ({ ...w, x: clamp(w.x, 0, CANVAS_W - w.w), y: clamp(w.y, 0, CANVAS_H - w.h) }));
}

// ---------------------------------------------------------------- adding

export function uniqueWidgetId(base, widgets) {
  const taken = new Set(widgets.map((w) => w.id));
  const slug = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'widget';
  let id = slug, n = 2;
  while (taken.has(id)) id = slug + '_' + n++;
  return id;
}

// the size and look a new widget starts with (x, y are chosen separately)
export const DEFAULTS = {
  clock: { w: 560, h: 120, style: { size: 110, weight: 200 } },
  date: { w: 560, h: 40, style: { size: 30, color: 'dim' } },
  text: { w: 560, h: 60, style: { size: 40 }, options: { text: 'Your text' } },
  image: { w: 400, h: 400, options: {} },
  video: { w: 1080, h: 1920, options: {} },
  divider: { w: 400, h: 40, style: { color: 'faint' }, options: { thickness: 2 } },
  message: { w: 760, h: 44, style: { size: 32, italic: true, color: 'accent' }, options: { lines: ['Have a good day', 'Looking good'] } },
  entity_value: { w: 360, h: 120, style: { size: 64, weight: 200 }, options: {} },
  weather: { w: 560, h: 60, style: { size: 36 }, options: { layout: 'line' } },
  calendar_agenda: { w: 560, h: 200, auto_height: true, style: { size: 28 }, options: { max_items: 5, hide_when_empty: true } },
  todo_list: { w: 560, h: 160, auto_height: true, style: { size: 28 }, options: { max_items: 5, hide_when_empty: true } },
  now_playing: { w: 960, h: 200, auto_height: true, style: { size: 40 }, options: { show_art: true, style: 'card' } },
  people: { w: 560, h: 100, auto_height: true, style: { size: 32 }, options: { show_avatar: true, avatar_size: 60 } },
  lights_summary: { w: 560, h: 100, auto_height: true, style: { size: 56, weight: 200 }, options: { show_dots: true } },
  progress_ring: { w: 160, h: 160, style: { size: 39, weight: 300 }, options: {} },
  sports: { w: 960, h: 260, auto_height: true, style: { size: 28 }, options: { layout: 'rows', max_games: 3 } },
  news: { w: 760, h: 160, auto_height: true, style: { size: 26 }, options: { max_stories: 2 } },
};

/** Where a new widget goes: the first free grid spot from the top, so it never lands exactly on another one. */
export function freeSpot(widgets, w, h) {
  const boxes = widgets.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
  for (let y = 80; y <= CANVAS_H - h; y += GRID) {
    for (let x = 40; x <= CANVAS_W - w; x += GRID) {
      if (!boxes.some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y)) return { x, y };
    }
  }
  return { x: 40, y: 80 };
}

/**
 * A new widget of `type`, and the binding it starts with ({slot: value}) when an entity was chosen.
 * Returns { widget, binding } without changing `widgets`.
 */
export function newWidget(type, label, widgets, entityId = null, slotName = null, slotKind = null) {
  const d = DEFAULTS[type];
  if (!d) throw new Error('no such widget type ' + type);
  const spot = freeSpot(widgets, d.w, d.h);
  const widget = { id: uniqueWidgetId(label || type, widgets), name: label || type, type, x: spot.x, y: spot.y, w: d.w, h: d.h };
  if (d.auto_height) widget.auto_height = true;
  if (d.style) widget.style = copy(d.style);
  if (d.options) widget.options = copy(d.options);
  const binding = entityId && slotName ? { [slotName]: slotKind === 'entity' ? entityId : [entityId] } : {};
  return { widget, binding };
}

// ---------------------------------------------------------------- which widgets suit an entity

const SPORT_STATES = ['PRE', 'IN', 'POST', 'BYE', 'NOT_FOUND'];

/** Does this look like a Team Tracker sports sensor? (it is what the sports widget reads) */
export function looksLikeSports(state) {
  const a = (state && state.attributes) || {};
  return a.team_abbr !== undefined || (a.team_name !== undefined && a.opponent_name !== undefined && SPORT_STATES.includes(state.state));
}

const NUMERIC = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
/** Is the state a plain number (not a date, a time or a version)? */
export function looksNumeric(state) {
  return !!state && NUMERIC.test(String(state.state).trim());
}
/** A percentage, for which a ring is the natural picture. */
export function looksPercent(state) {
  const a = (state && state.attributes) || {};
  return looksNumeric(state) && (a.unit_of_measurement === '%' || ['battery', 'humidity', 'moisture'].includes(a.device_class));
}
/** Does this look like a Feedreader event entity (what the news widget reads)? */
export function looksLikeNews(state) {
  const a = (state && state.attributes) || {};
  return a.title !== undefined && a.link !== undefined;
}

/**
 * Widgets that can show this entity, best first: [{type, label, slot, kind}]. `registry` is widgets.json. A widget that needs a kind
 * of data Home Assistant has no built-in entity for (sports) is only offered for an entity that really looks like that data.
 */
export function candidatesFor(entityId, state, registry) {
  const domain = entityId.split('.')[0];
  const out = [];
  for (const [type, spec] of Object.entries(registry)) {
    const slots = Object.entries(spec.slots || {});
    if (slots.length !== 1 || !DEFAULTS[type]) continue;
    const [slot, def] = slots[0];
    if (def.kind !== 'entity' && def.kind !== 'entities' && def.kind !== 'feeds') continue;
    if (type === 'message') continue;
    const generic = def.domains.length === 0;
    if (!generic && !def.domains.includes(domain)) continue;
    if (type === 'sports' && !looksLikeSports(state)) continue;
    if (type === 'news' && !looksLikeNews(state)) continue;
    if (type === 'progress_ring' && !looksNumeric(state)) continue;
    out.push({ type, label: spec.label, slot, kind: def.kind === 'feeds' ? 'entities' : def.kind, generic });
  }
  // an entity-specific widget first, the any-entity "value" last; a sports sensor prefers the sports widget over a plain progress ring.
  // The ring goes first only for something that really is a percentage (battery, humidity, a % unit); otherwise the plain value wins.
  const rank = (c) => (c.type === 'sports' ? -1 : c.type === 'progress_ring' ? (looksPercent(state) ? 0 : 3) : c.generic ? 2 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Widgets with no entity at all: always available. */
export function plainElements(registry) {
  return Object.entries(registry)
    .filter(([type, spec]) => DEFAULTS[type] && (Object.keys(spec.slots || {}).length === 0 || type === 'message'))
    .map(([type, spec]) => ({ type, label: spec.label }));
}

/** Remove a widget. Whatever flowed after it now flows after what it followed, so the layout closes up instead of breaking. */
export function removeWidget(widgets, id) {
  const gone = widgets.find((w) => w.id === id);
  if (!gone) return widgets;
  const goneAfter = gone.flow ? [].concat(gone.flow.after) : [];
  return withoutReferences(widgets.filter((w) => w.id !== id), id).map((w) => {      // rules that looked at it stop looking
    if (!w.flow) return w;
    const flow = { ...w.flow };
    let after = [].concat(flow.after);
    if (after.includes(id)) after = [...new Set([...after.filter((a) => a !== id), ...goneAfter])];
    if (flow.show_if === id) delete flow.show_if;
    if (!after.length) { const next = { ...w }; delete next.flow; return next; }
    flow.after = after.length === 1 ? after[0] : after;
    return { ...w, flow };
  });
}

// ---------------------------------------------------------------- the safe zone
// Items may go all the way to the edge of the canvas. A mirror's frame or rounded corners can hide the outer strip, so anything that
// reaches into it gets a heads-up (the builder asks whether to keep it there or pull it in).

export const SAFE = 40;

/** Does this rect reach into the outer strip? A full-screen item (a video, say) is meant to; it is never flagged. */
export function outsideSafe(rect, margin = SAFE) {
  if (rect.w >= CANVAS_W && rect.h >= CANVAS_H) return false;
  return rect.x < margin || rect.y < margin || rect.x + rect.w > CANVAS_W - margin || rect.y + rect.h > CANVAS_H - margin;
}

/** The widget moved (and shrunk if it must) so it lies inside the safe zone. */
export function pulledInside(widget, rect, margin = SAFE) {
  const w = Math.min(widget.w, CANVAS_W - 2 * margin);
  const h = widget.auto_height ? widget.h : Math.min(widget.h, CANVAS_H - 2 * margin);
  const x = clamp(rect.x, margin, CANVAS_W - margin - w);
  const y = clamp(rect.y, margin, CANVAS_H - margin - Math.min(rect.h, h));
  return placed(widget, { x, y, w, h });
}

// ---------------------------------------------------------------- is the text readable?

// the named colours the player defines (player.css)
export const NAMED_COLORS = { fg: '#f2f2f2', dim: '#8a8a8a', faint: '#5f5f5f', accent: '#6fb4ff', warn: '#ffb347', good: '#5fd38d', bad: '#ff6b6b' };

/** [r, g, b] from #rgb, #rrggbb or rgb(...), or null when it cannot be worked out (names, gradients, images). */
export function parseColor(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgb\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)\s*\)$/.exec(s);
  return m ? [1, 2, 3].map((i) => Math.min(255, parseInt(m[i], 10))) : null;
}

const luminance = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/**
 * How readable text is on a background: { ratio, level } with level 'good', 'low' (fine for big text only), 'poor', or 'unknown'
 * (the colour or background could not be worked out, for example a photo). Uses the WCAG contrast ratio; big text (48px, or 36px
 * bold) only needs 3:1.
 */
export function readability(color, background, { opacity = 1, size = 32, weight = 400, theme } = {}) {
  // a pane theme brings its own background and its own values for the named colours (player/themes.js); without one nothing changes
  const t = themeColors(theme), named = t ? { ...NAMED_COLORS, ...t.named } : NAMED_COLORS;
  const fg = parseColor(named[color] || color || named.fg), bg = parseColor(t ? t.bg : background || '#000000');
  if (!fg || !bg) return { ratio: null, level: 'unknown' };
  const mixed = fg.map((v, i) => v * opacity + bg[i] * (1 - opacity));
  const a = luminance(mixed), b = luminance(bg);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const big = size >= 48 || (size >= 36 && weight >= 700);
  const need = big ? 3 : 4.5;
  return { ratio: Math.round(ratio * 10) / 10, level: ratio >= need ? 'good' : ratio >= 3 ? 'low' : 'poor' };
}

// ---------------------------------------------------------------- why is a widget empty?

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A plain-language reason a bound widget has nothing to show, for the builder to display. `states` maps entity id -> its state object.
 * Only sports has a specific story (it shows games that are live, ended in the last 18 hours, tonight, or within the next 7 days).
 */
export function whyEmpty(type, entityIds, states, now = Date.now()) {
  if (type !== 'sports') return 'Nothing to show right now.';
  const notes = [];
  for (const id of entityIds.slice(0, 3)) {
    const s = states[id];
    if (!s) { notes.push(id + ' is not available'); continue; }
    const name = (s.attributes && (s.attributes.team_name || s.attributes.friendly_name)) || id;
    const t = Date.parse(s.attributes && s.attributes.date);
    if (['NOT_FOUND', 'BYE'].includes(s.state)) notes.push(name + ': no game scheduled');
    else if (s.state === 'PRE' && !isNaN(t) && t - now >= 7 * DAY) { const d = new Date(t); notes.push(name + ': next game ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', shown once it is within a week'); }
    else if (s.state === 'POST' && !isNaN(t) && now - t >= 18 * 3600000) notes.push(name + ': last game ended over 18 hours ago');
    else notes.push(name + (s.state === 'PRE' ? ': waiting for the next game' : ': ' + s.state));
  }
  return (notes.join('. ') || 'No games right now') + '.';
}
