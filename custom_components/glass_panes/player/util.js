// Small helpers shared by the player and the widgets. No dependencies.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];
export const WD_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

export const COND = {
  partlycloudy: 'Partly cloudy', 'clear-night': 'Clear', sunny: 'Sunny', 'lightning-rainy': 'Thunderstorms',
  lightning: 'Thunderstorms', 'snowy-rainy': 'Sleet', 'windy-variant': 'Windy', pouring: 'Heavy rain', rainy: 'Rain',
  snowy: 'Snow', cloudy: 'Cloudy', fog: 'Foggy', hail: 'Hail', windy: 'Windy', exceptional: 'Alert',
};

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A picture that changes (an image or camera entity) is fetched as a file and shown from memory, because its address is signed and
// cannot carry a "version" to make the browser load it again. `getUrl(fresh)` gives the signed address (fresh = ask for a new one,
// for when the old one has expired). Returns an address the page can show (a blob: address; the caller revokes it), or null.
export async function blobPicture(getUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let url = null;
    try { url = await getUrl(attempt > 0); } catch (e) { return null; }
    if (!url) return null;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return URL.createObjectURL(await r.blob());
    } catch (e) { /* try once more with a new address */ }
  }
  return null;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// States that mean "no real value".
export function isBad(v) {
  return v === 'unknown' || v === 'unavailable' || v === '' || v == null;
}

export function okState(s) {
  return !!s && !isBad(s.state);
}

// A state is a number only if the WHOLE text is one. parseFloat would read "2026-11-05" as 2026, "07:30:00" as 7 and an IP address
// as 192. A leading zero ("02139", a ZIP code) means text, not a number.
const NUMERIC = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
export function strictNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  const t = String(v == null ? '' : v).trim();
  if (!NUMERIC.test(t) || /^[-+]?0\d/.test(t)) return NaN;
  return Number(t);
}

export function num(s) {
  return okState(s) ? strictNumber(s.state) : NaN;
}

// A number for people: `decimals` fixed when given, otherwise one decimal under 100 and whole numbers above (the player's old rule).
// Thousands get a comma unless `thousands` is false. Rounds correctly (1234.56 with one decimal is "1,234.6").
export function formatNumber(n, decimals, thousands = true) {
  let digits = decimals;
  if (digits == null) digits = Math.abs(n) < 100 && !Number.isInteger(n) ? 1 : 0;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: thousands !== false }).format(n);
}

export function unitOf(s) {
  return (s && s.attributes && s.attributes.unit_of_measurement) || '';
}

export function comma(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function slugDomain(entityId) {
  return String(entityId || '').split('.')[0];
}

// A small seeded random generator so a "random" pick stays put until the seed changes.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Time in an explicit timezone. The reference mirror's system clock is stuck on UTC, so nothing here trusts the
// device's own zone: every wall-clock value goes through Intl with the zone the display was told to use.
export function makeTime(tz) {
  const opts = {
    hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'long',
  };
  if (tz) opts.timeZone = tz;
  let fmt;
  try { fmt = new Intl.DateTimeFormat('en-US', opts); } catch (e) { delete opts.timeZone; fmt = new Intl.DateTimeFormat('en-US', opts); }

  function parts(d) {
    const o = {};
    fmt.formatToParts(d).forEach((p) => { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: o.weekday };
  }
  function offsetMs(d) {
    const p = parts(d);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000;
  }
  // 00:00 of the given moment's day, in the display's zone.
  function midnight(d) {
    const p = parts(d), guess = Date.UTC(p.y, p.mo - 1, p.d, 0, 0, 0);
    let off = offsetMs(new Date(guess));
    off = offsetMs(new Date(guess - off));
    return new Date(guess - off);
  }
  // Midnight `n` days from today's midnight (30 h hops dodge daylight-saving edges, then snap back to midnight).
  function dayStart(n) {
    let m = midnight(new Date());
    for (let i = 0; i < n; i++) m = midnight(new Date(m.getTime() + 30 * 3600000));
    return m;
  }
  function sameDay(a, b) {
    const x = parts(a), y = parts(b);
    return x.y === y.y && x.mo === y.mo && x.d === y.d;
  }
  // 9, 12:30, 3  (no AM/PM)
  function shortTime(d) {
    const p = parts(d), h = p.h % 12 || 12;
    return p.mi === 0 ? String(h) : h + ':' + (p.mi < 10 ? '0' + p.mi : p.mi);
  }
  function ampm(d) {
    return shortTime(d) + (parts(d).h < 12 ? ' am' : ' pm');
  }
  function time24(d) {
    const p = parts(d);
    return (p.h < 10 ? '0' : '') + p.h + ':' + (p.mi < 10 ? '0' : '') + p.mi;
  }
  function dayTime(d) {
    return sameDay(d, new Date()) ? ampm(d) : (WD_SHORT[parts(d).wd] || '') + ' ' + ampm(d);
  }
  function timeAgo(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return Math.max(1, m) + ' min ago';
    if (m < 1440) { const h = Math.round(m / 60); return h + (h === 1 ? ' hr ago' : ' hrs ago'); }
    return sameDay(new Date(t), new Date(Date.now() - 86400000)) ? 'yesterday' : WD_SHORT[parts(new Date(t)).wd];
  }
  return { parts, midnight, dayStart, sameDay, shortTime, ampm, time24, dayTime, timeAgo };
}

// ---------------------------------------------------------------- divider looks

export const DIVIDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'fade'];
const COLOR_TOKENS = ['fg', 'dim', 'faint', 'accent', 'warn', 'good', 'bad'];
/** A colour option (a theme token like "accent" or a #rrggbb) as CSS, or `fallback` when it is neither. */
export function colorCss(v, fallback = 'currentColor') {
  if (COLOR_TOKENS.includes(v)) return 'var(--gp-' + v + ')';
  return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : fallback;
}
/** A divider drawn as a `box` frames a group instead of separating sections, so the "only between two things" rule skips it. */
export const isSeparator = (spec) => spec.type === 'divider' && (spec.options || {}).look !== 'box';

/**
 * The CSS for a divider widget. `look: 'line'` (default) is a rule in one of five styles; `look: 'box'` is an outline with rounded
 * corners and an optional soft fill. Returns { line, fill } as cssText strings (fill is null for a line or a box without a fill).
 */
export function dividerCss(o = {}) {
  const t = Math.max(1, Math.min(20, Math.round(o.thickness || 2)));
  if (o.look === 'box') {
    const r = Math.max(0, Math.min(200, Math.round(o.radius == null ? 24 : o.radius)));
    const line = 'position:absolute;inset:0;box-sizing:border-box;border:' + t + 'px ' + (o.style === 'dashed' || o.style === 'dotted' ? o.style : 'solid') + ' currentColor;border-radius:' + r + 'px';
    const op = Math.max(0, Math.min(100, Math.round(o.fill_opacity == null ? 10 : o.fill_opacity))) / 100;
    const fill = o.fill ? 'position:absolute;inset:0;border-radius:' + r + 'px;background:' + colorCss(o.fill) + ';opacity:' + op : null;
    return { line, fill };
  }
  const base = 'width:100%;box-sizing:border-box;';
  if (o.style === 'dashed' || o.style === 'dotted') return { line: base + 'height:0;border-top:' + t + 'px ' + o.style + ' currentColor', fill: null };
  if (o.style === 'double') return { line: base + 'height:' + t * 3 + 'px;border-top:' + t + 'px solid currentColor;border-bottom:' + t + 'px solid currentColor', fill: null };
  if (o.style === 'fade') return { line: base + 'height:' + t + 'px;background:linear-gradient(to right,transparent,currentColor 20%,currentColor 80%,transparent)', fill: null };
  return { line: base + 'height:' + t + 'px;background:currentColor', fill: null };
}

/** The time zone a display shows times in: its own when it has one, otherwise Home Assistant's, else '' (the device's own zone). */
export function displayZone(display) {
  const own = display && typeof display.timezone === 'string' ? display.timezone.trim() : '';
  if (own) return own;
  const ha = display && typeof display.ha_timezone === 'string' ? display.ha_timezone.trim() : '';
  return ha;
}


// ---------------------------------------------------------------- tile and chip looks (Entity value)

export const VALUE_LOOKS = ['plain', 'tile', 'chip'];

/**
 * The CSS for an Entity value drawn as a `tile` (a rounded card: an icon in a tinted circle, the name over the value) or a `chip` (a
 * small pill: an icon and the value). Everything scales from `S`, the widget's text size, so it looks the same at any size.
 * Returns cssText strings: box, fill (a soft layer behind the content), badge, badgeFill, texts, name, value, and the icon's pixel size.
 */
export function tileCss(look, S, radius) {
  const r = look === 'chip' ? 999 : Math.max(0, Math.min(200, Math.round(radius == null ? 28 : radius)));
  const px = (k) => Math.round(S * k);
  const fill = 'position:absolute;inset:0;border-radius:' + r + 'px;background:var(--gp-fg);opacity:.08';
  if (look === 'chip') {
    return {
      box: 'position:relative;display:inline-flex;align-items:center;gap:' + px(0.3) + 'px;max-width:100%;box-sizing:border-box;padding:' + px(0.25) + 'px ' + px(0.6) + 'px;border-radius:999px;overflow:hidden',
      fill, badge: 'position:relative;flex:none;display:inline-flex;align-items:center', badgeFill: null,
      texts: 'position:relative;min-width:0;display:flex;align-items:baseline;gap:' + px(0.3) + 'px',
      name: 'font-size:' + px(0.6) + 'px;color:var(--gp-dim)', value: 'font-size:' + S + 'px;color:var(--gp-fg);white-space:nowrap', iconSize: px(0.9),
    };
  }
  return {
    box: 'position:relative;display:flex;align-items:center;gap:' + px(0.55) + 'px;width:100%;height:100%;box-sizing:border-box;padding:0 ' + px(0.6) + 'px;border-radius:' + r + 'px;overflow:hidden',
    fill,
    badge: 'position:relative;flex:none;width:' + px(1.7) + 'px;height:' + px(1.7) + 'px;display:flex;align-items:center;justify-content:center',
    badgeFill: 'position:absolute;inset:0;border-radius:50%;background:currentColor;opacity:.2',
    texts: 'position:relative;min-width:0;display:flex;flex-direction:column;justify-content:center',
    name: 'font-size:' + px(0.5) + 'px;color:var(--gp-dim);line-height:1.2', value: 'font-size:' + S + 'px;color:var(--gp-fg);line-height:1.1', iconSize: px(0.9),
  };
}
