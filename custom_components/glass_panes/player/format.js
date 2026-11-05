// Turning an entity's raw value into words for a screen. Pure: no page, no Home Assistant, so it is tested on its own.
//
// describe(raw, opts) -> { text, n }   `n` is the number when the value is one (NaN otherwise), for rings and comparisons.
//   opts: domain, deviceClass, format ('auto' | 'relative' | 'time' | 'date' | 'datetime' | 'raw'), decimals, thousands,
//         rawState (true keeps "on" instead of "Open"), time (makeTime(tz) from util.js), now (ms, for tests)

import { formatNumber, MONTHS, strictNumber, WD_SHORT } from './util.js';
import { stateWord } from './states.js';

// domains whose state is a moment in time (when a button was last pressed, a scene last activated, an event last fired ...)
const TIME_DOMAINS = new Set(['button', 'scene', 'event', 'notify', 'input_button', 'image', 'date', 'datetime', 'time', 'input_datetime']);
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{1,2}):(\d{2})(:\d{2})?$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clockText(h, m) {
  const h12 = h % 12 || 12;
  return (m === 0 ? String(h12) : h12 + ':' + (m < 10 ? '0' + m : m)) + (h < 12 ? ' am' : ' pm');
}

function dateOnlyText(y, mo, d, now, time) {
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const thisYear = time ? time.parts(new Date(now)).y : new Date(now).getUTCFullYear();
  return wd + ', ' + MONTHS[mo - 1] + ' ' + d + (y !== thisYear ? ', ' + y : '');
}

function momentDate(t, time, now) {
  const p = time.parts(new Date(t)), today = time.parts(new Date(now));
  const wd = WD_SHORT[p.wd] || '';
  return wd + ', ' + MONTHS[p.mo - 1] + ' ' + p.d + (p.y !== today.y ? ', ' + p.y : '');
}

function relative(t, time, now) {
  const diff = t - now, mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return diff < 0 ? mins + ' min ago' : 'in ' + mins + ' min';
  const hrs = Math.round(mins / 60);
  if (hrs < 24 && time.sameDay(new Date(t), new Date(now))) {
    return diff < 0 ? hrs + (hrs === 1 ? ' hr ago' : ' hrs ago') : 'in ' + hrs + (hrs === 1 ? ' hr' : ' hrs');
  }
  if (time.sameDay(new Date(t), new Date(now - 86400000))) return 'yesterday ' + time.ampm(new Date(t));
  if (time.sameDay(new Date(t), new Date(now + 86400000))) return 'tomorrow ' + time.ampm(new Date(t));
  return momentDate(t, time, now) + ', ' + time.ampm(new Date(t));
}

function moment(text, format, time, now) {
  const m = ISO_DATETIME.exec(text);
  if (m) {
    const t = Date.parse(text.replace(' ', 'T'));
    if (isNaN(t) || !time) return null;
    if (format === 'time') return time.ampm(new Date(t));
    if (format === 'date') return momentDate(t, time, now);
    if (format === 'datetime') return momentDate(t, time, now) + ', ' + time.ampm(new Date(t));
    return relative(t, time, now);                        // auto and relative
  }
  const d = ISO_DATE.exec(text);
  if (d) return dateOnlyText(+d[1], +d[2], +d[3], now, time);
  const c = CLOCK.exec(text);
  if (c && +c[1] < 24 && +c[2] < 60) return clockText(+c[1], +c[2]);
  return null;
}

export function describe(raw, opts = {}) {
  const format = opts.format || 'auto', now = opts.now != null ? opts.now : Date.now();
  if (raw === undefined || raw === null || raw === '') return { text: '-', n: NaN };
  if (format === 'raw') return { text: String(raw), n: strictNumber(raw) };
  if (typeof raw === 'boolean') return { text: raw ? 'Yes' : 'No', n: NaN };
  if (Array.isArray(raw)) return { text: raw.filter((v) => v != null && typeof v !== 'object').join(', ') || '-', n: NaN };
  if (typeof raw === 'object') return { text: '-', n: NaN };
  const text = String(raw);

  const timeish = format !== 'auto' || TIME_DOMAINS.has(opts.domain) || opts.deviceClass === 'timestamp' || opts.deviceClass === 'date';
  if (timeish || ISO_DATETIME.test(text) || ISO_DATE.test(text)) {
    const shown = moment(text, format, opts.time, now);
    if (shown) return { text: shown, n: NaN };
  }
  const n = strictNumber(raw);
  if (!isNaN(n)) return { text: formatNumber(n, opts.decimals, opts.thousands), n };
  if (!opts.rawState) {
    const word = stateWord(opts.domain, opts.deviceClass, text);
    if (word) return { text: word, n: NaN };
  }
  return { text, n: NaN };
}
