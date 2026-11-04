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

export function num(s) {
  return okState(s) ? parseFloat(s.state) : NaN;
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
