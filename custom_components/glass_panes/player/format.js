// Turning an entity's raw value into words for a screen. Pure: no page, no Home Assistant, so it is tested on its own.
//
// describe(raw, opts) -> { text, n }   `n` is the number when the value is one (NaN otherwise), for rings and comparisons.
//   opts: domain, deviceClass, format ('auto' | 'relative' | 'time' | 'date' | 'datetime' | 'duration' | 'raw'), decimals, thousands,
//         durationUnit ('seconds' | 'minutes' | 'hours', what a number means for format 'duration'; default minutes),
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

const UNIT_MINUTES = { seconds: 1 / 60, minutes: 1, hours: 60 };

/** 75 minutes -> "1 h 15 min"; 5 -> "5 min"; 0.2 -> "<1 min"; 0 -> "0 min". `unit` says what the number counts. */
export function durationText(value, unit = 'minutes') {
  const n = strictNumber(value);
  if (isNaN(n)) return null;
  const mins = n * (UNIT_MINUTES[unit] || 1), sign = mins < 0 ? '-' : '', abs = Math.abs(mins);
  if (abs > 0 && abs < 1) return sign + '<1 min';
  const total = Math.round(abs), h = Math.floor(total / 60), m = total % 60;
  if (h === 0) return sign + m + ' min';
  return sign + h + ' h' + (m ? ' ' + m + ' min' : '');
}

export function describe(raw, opts = {}) {
  const format = opts.format || 'auto', now = opts.now != null ? opts.now : Date.now();
  if (raw === undefined || raw === null || raw === '') return { text: '-', n: NaN };
  if (format === 'raw') return { text: String(raw), n: strictNumber(raw) };
  if (format === 'duration') { const d = durationText(raw, opts.durationUnit); if (d !== null) return { text: d, n: strictNumber(raw) }; }
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

// ---------------------------------------------------------------- table cells (the `table` widget)
// One column of a table says what to show for each row (each row is one entity): its name, its state, one attribute, or fixed text.

/**
 * The text of one cell and the raw value a style rule looks at. `col` is { source, attribute, text, format, decimals, unit, duration_unit }.
 * `st` is the row's entity state (null = missing). Returns { text, raw }.
 */
export function tableCell(col, st, entityId, { time = null, now } = {}) {
  if (col.source === 'text') return { text: col.text || '', raw: col.text || '' };
  const a = (st && st.attributes) || {};
  if (col.source === 'name') {
    const text = a.friendly_name || String(entityId || '').split('.').slice(1).join('.').replace(/_/g, ' ') || '-';
    return { text, raw: text };
  }
  if (!st) return { text: '-', raw: undefined };
  const raw = col.source === 'attribute' ? a[col.attribute] : st.state;
  if (raw === undefined || raw === null || raw === '' || raw === 'unavailable' || raw === 'unknown') return { text: '-', raw: undefined };
  const domain = String(entityId || '').split('.')[0];
  let text;
  if (col.format === 'number') {
    const n = strictNumber(raw);
    text = isNaN(n) ? '-' : formatNumber(n, col.decimals);
  } else {
    text = describe(raw, { domain, deviceClass: col.source === 'attribute' ? null : a.device_class, format: col.format, decimals: col.decimals, durationUnit: col.duration_unit, time, now }).text;
  }
  // a number carries a unit: the one you typed, else (for a state, not an attribute) the entity's own
  const isNum = !isNaN(strictNumber(raw)) && col.format !== 'time' && col.format !== 'date' && col.format !== 'datetime' && col.format !== 'duration';
  const unit = col.unit != null ? col.unit : col.source === 'state' ? a.unit_of_measurement || '' : '';
  if (isNum && unit && text !== '-') text += (/^[%°]/.test(unit) ? '' : ' ') + unit;
  return { text, raw: typeof raw === 'object' ? undefined : raw };
}
