// One renderer per widget type. Each is `function (ctx)`; it draws into ctx.root and asks the engine to call it
// again when data changes:
//   ctx.opts / ctx.style / ctx.slots   the widget's options, style, and bound entities
//   ctx.data                           the data client (HAClient or MockClient)
//   ctx.time                           time helpers for the display's timezone
//   ctx.refresh(fn, ids, ms)           run fn now, again whenever one of `ids` changes, and every `ms`
//   ctx.every(ms, fn)                  run fn now and every `ms`
//   ctx.onDestroy(fn)                  cleanup when the pane is replaced
// Nothing here knows any entity ID. Everything comes from ctx.slots.

import { COND, clear, el, FULL_MONTHS, isBad, MONTHS, num, okState, seeded, strictNumber, unitOf } from './util.js';
import { describe } from './format.js';

const pad = (n) => (n < 10 ? '0' : '') + n;
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

// ---------------------------------------------------------------- plain widgets

function clock(ctx) {
  const o = ctx.opts;
  ctx.root.style.whiteSpace = 'nowrap';   // a clock never wraps
  const tick = () => {
    const p = ctx.time.parts(new Date());
    const h = o.format === '24h' ? pad(p.h) : String(p.h % 12 || 12);
    let t = h + ':' + pad(p.mi);
    if (o.show_seconds) t += ':' + pad(p.s);
    if (o.format !== '24h' && o.hide_meridiem === false) t += p.h < 12 ? ' AM' : ' PM';
    setText(ctx.root, t);
  };
  ctx.every(o.show_seconds ? 1000 : 5000, tick);
}

function date(ctx) {
  const o = ctx.opts;
  const tick = () => {
    const p = ctx.time.parts(new Date(Date.now() + (o.day_offset || 0) * 86400000));
    let t;
    switch (o.format) {
      case 'weekday_month_day_year': t = p.wd + ', ' + FULL_MONTHS[p.mo - 1] + ' ' + p.d + ', ' + p.y; break;
      case 'month_day': t = MONTHS[p.mo - 1] + ' ' + p.d; break;
      case 'weekday': t = p.wd; break;
      default: t = p.wd + ', ' + MONTHS[p.mo - 1] + ' ' + p.d;
    }
    setText(ctx.root, (o.prefix || '') + t);
  };
  ctx.every(30000, tick);
}

function text(ctx) {
  setText(ctx.root, ctx.opts.text || '');
  if (ctx.opts.fit !== 'shrink') return;
  // one line, shrunk until it fits the box (re-run once fonts have loaded, since they change the width)
  const base = ctx.style.size || 32;
  const fitText = () => {
    ctx.root.style.whiteSpace = 'nowrap';
    let size = base;
    ctx.root.style.fontSize = size + 'px';
    while (ctx.root.scrollWidth > ctx.root.clientWidth + 1 && size > 8) { size -= 1; ctx.root.style.fontSize = size + 'px'; }
  };
  fitText();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitText);
}

// A picture comes from the media library (options.media, an id) or, in older panes, from a file name in the assets folder.
function image(ctx) {
  const o = ctx.opts;
  if (!o.media && !o.asset) return;
  const img = el('img');
  img.alt = '';
  img.style.cssText = 'width:100%;height:100%;object-fit:' + (o.fit || 'contain');
  const show = (src) => { if (src && ctx.root.isConnected) { img.src = src; ctx.root.appendChild(img); } };
  if (!o.media) { img.onerror = () => { img.style.visibility = 'hidden'; }; show(ctx.assetBase + o.asset); return; }
  // An uploaded picture's signed link dies when Home Assistant restarts (new signing key) and after 7 days. Ask for a fresh one when
  // it fails (at most once a minute), when the connection to Home Assistant is re-made, and every 6 hours.
  const load = (fresh) => Promise.resolve(ctx.data.mediaUrl && ctx.data.mediaUrl(o.media, fresh)).then(show).catch(() => {});
  let lastTry = 0, gen = ctx.data.generation;
  img.onerror = () => {
    img.style.visibility = 'hidden';
    if (Date.now() - lastTry > 60000) { lastTry = Date.now(); load(true); }
  };
  img.onload = () => { img.style.visibility = ''; };
  load(false);
  ctx.every(30000, () => { if (ctx.data.generation !== gen) { gen = ctx.data.generation; load(true); } });
  ctx.every(6 * 3600000, () => load(true));
}

function divider(ctx) {
  const line = el('div');
  line.style.cssText = 'width:100%;height:' + (ctx.opts.thickness || 2) + 'px;background:currentColor';
  ctx.root.appendChild(line);
}

// Looping video. In a normal browser it is a <video>. Inside the kiosk app (?kiosk=1) the page asks the app to play the
// file natively on top, because the reference mirror's Firefox cannot decode video itself.
function video(ctx) {
  const o = ctx.opts;
  if (!o.media) { playVideo(ctx, (o.sources || []).map((s) => new URL(ctx.assetBase + s, location.href).href)); return; }
  // the uploaded video's signed link dies on a Home Assistant restart and after 7 days, so playVideo can ask for a fresh one
  const fresh = () => Promise.resolve(ctx.data.mediaUrl && ctx.data.mediaUrl(o.media, true)).then((url) => (url ? [new URL(url, location.href).href] : null));
  Promise.resolve(ctx.data.mediaUrl && ctx.data.mediaUrl(o.media))
    .then((url) => { if (url && ctx.root.isConnected) playVideo(ctx, [new URL(url, location.href).href], fresh); })
    .catch(() => {});
}

// `fresh` (optional) fetches new addresses when the old ones stop working. Retries back off from 30 s to 10 min, so a dead link is
// never hammered (each failed try would count as a failed login in Home Assistant).
function playVideo(ctx, srcs, fresh) {
  if (!srcs.length) return;
  if (!ctx.kiosk) {
    const v = el('video');
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#000';
    let i = 0, wait = 30000, nextTry = 0;
    v.onerror = () => {
      if (srcs.length > 1 && i < srcs.length - 1) { i++; v.src = srcs[i]; return; }
      if (Date.now() < nextTry) return;
      nextTry = Date.now() + wait; wait = Math.min(wait * 2, 600000);
      setTimeout(() => {
        if (!ctx.root.isConnected) return;
        Promise.resolve(fresh ? fresh() : null).then((list) => { if (list && list.length) srcs = list; i = 0; v.src = srcs[0]; v.play().catch(() => {}); }).catch(() => {});
      }, wait);
    };
    v.onplaying = () => { wait = 30000; };
    v.src = srcs[0];
    ctx.root.appendChild(v);
    v.play().catch(() => {});
    return;
  }
  const call = (path) => fetch(ctx.appUrl + path, { mode: 'cors' }).then((r) => r.json());
  let idx = 0, since = Date.now(), tries = 0, gen = ctx.data.generation;
  const start = () => { since = Date.now(); call('/video/start?url=' + encodeURIComponent(srcs[idx])).catch(() => {}); };
  const renew = () => Promise.resolve(fresh ? fresh() : null).then((list) => { if (list && list.length) { srcs = list; idx = 0; } start(); }).catch(() => {});
  start();
  ctx.every(2000, () => {
    // Home Assistant came back after a drop: its old links may be dead, so hand the app a fresh one
    if (fresh && ctx.data.generation !== gen && gen !== undefined) { gen = ctx.data.generation; renew(); return; }
    gen = ctx.data.generation;
    call('/status').then((st) => {
      const v = st.video;
      if (/^error/.test(v) && idx < srcs.length - 1) { idx++; start(); }
      else if (v === 'starting' && Date.now() - since > 12000) { idx = (idx + 1) % srcs.length; start(); }
      else if (v === 'stopped' || /^error/.test(v)) { if (++tries % 15 === 0) renew(); }      // every 30 s: try again with a fresh link
    }).catch(() => {});
  });
  ctx.onDestroy(() => { call('/video/stop').catch(() => {}); });
}

function message(ctx) {
  const o = ctx.opts, entity = ctx.slots.entity;
  const render = async () => {
    let t = '';
    if (entity) {
      const s = await ctx.data.state(entity);
      if (okState(s)) t = String(s.state);
    }
    if (!t && o.lines && o.lines.length) {
      const rnd = seeded(Math.floor(Date.now() / ((o.rotate_minutes || 30) * 60000)));
      rnd();
      t = o.lines[Math.floor(rnd() * o.lines.length)];
    }
    setText(ctx.root, t ? (o.prefix || '') + t + (o.suffix || '') : '');
  };
  ctx.refresh(render, entity ? [entity] : [], 30000);
}

// ---------------------------------------------------------------- entity widgets

function entityValue(ctx) {
  const o = ctx.opts, entity = ctx.slots.entity, S = ctx.style.size || 32;
  const render = async () => {
    if (!entity) { clear(ctx.root); return; }
    const s = await ctx.data.state(entity);
    clear(ctx.root);
    let v = '-', unit = '';
    if (okState(s)) {
      // the state, or one of its attributes (a thermostat's target temperature, a cover's position, the sun's next rising ...)
      const a = s.attributes || {}, raw = o.attribute ? a[o.attribute] : s.state;
      const shown = describe(raw, {
        domain: String(entity).split('.')[0], deviceClass: o.attribute ? null : a.device_class, format: o.format, decimals: o.decimals,
        thousands: o.thousands_separator, rawState: o.raw_state, time: ctx.time,
      });
      v = shown.text;
      // the entity's own unit belongs to its state, so an attribute only gets the unit you typed
      if (!isNaN(shown.n)) unit = o.unit != null ? o.unit : o.attribute ? '' : unitOf(s);
      else if (o.unit) unit = o.unit;
    }
    const line = el('div', 'gp-ellip', v);
    line.style.lineHeight = '1.05';
    if (unit) { const u = el('span', 'gp-unit', unit); u.style.fontSize = Math.round(S * 0.36) + 'px'; line.appendChild(u); }
    ctx.root.appendChild(line);
    if (o.show_label !== false) {
      const name = o.label || (s && s.attributes && s.attributes.friendly_name) || '';
      if (name) {
        const l = el('div', 'gp-label gp-ellip', name);
        l.style.fontSize = Math.max(11, Math.round(S * 0.3)) + 'px';
        ctx.root.appendChild(l);
      }
    }
  };
  ctx.refresh(render, [entity], 0);
}

// Picks today's (or tomorrow's) high / low / condition out of a forecast list. Handles both forecast types Home Assistant has.
function pickForecast(list, offset, time) {
  const from = time.dayStart(offset), to = time.dayStart(offset + 1);
  const inDay = list.filter((f) => { const d = new Date(f.datetime); return d >= from && d < to; });
  const twice = list.some((f) => 'is_daytime' in f);
  if (twice) {
    let day = inDay.find((f) => f.is_daytime);
    const night = inDay.find((f) => !f.is_daytime);
    if (!day && offset === 0) day = list.find((f) => f.is_daytime);     // evening: the next daytime period, like the old page
    return { hi: day ? day.temperature : null, lo: night ? night.temperature : null, cond: day ? day.condition : night ? night.condition : null };
  }
  const f = inDay[0];
  return f ? { hi: f.temperature, lo: f.templow, cond: f.condition } : { hi: null, lo: null, cond: null };
}

function weather(ctx) {
  const o = ctx.opts, entity = ctx.slots.weather, S = ctx.style.size || 32, offset = o.day_offset || 0;
  const show = new Set(o.show || ['temperature', 'condition', 'high_low']);
  let fc = { hi: null, lo: null, cond: null };
  const loadForecast = async () => {
    if (!entity) return;
    for (const type of ['twice_daily', 'daily']) {
      const res = await ctx.data.service('weather', 'get_forecasts', { entity_id: entity, type });
      const list = res && res.service_response && res.service_response[entity] && res.service_response[entity].forecast;
      if (list && list.length) { fc = pickForecast(list, offset, ctx.time); break; }
    }
    render();
  };
  let last = null;
  const render = async () => {
    if (!entity) { clear(ctx.root); return; }
    last = await ctx.data.state(entity);
    const cur = okState(last) ? last.state : null;
    const temp = last && last.attributes && last.attributes.temperature != null ? Math.round(last.attributes.temperature) + '°' : null;
    const cond = COND[offset ? fc.cond : cur] || (offset ? fc.cond : cur && !isBad(cur) ? cur : '') || '';
    // tomorrow with its high already shown: just add the low ("low 57°"); otherwise high/low
    const hiLo = offset && show.has('temperature') ? (fc.lo != null ? 'low ' + Math.round(fc.lo) + '°' : '')
      : fc.hi != null && fc.lo != null ? Math.round(fc.hi) + '/' + Math.round(fc.lo) : '';
    const big = offset ? (fc.hi != null ? Math.round(fc.hi) + '°' : null) : temp;
    clear(ctx.root);
    if (o.layout === 'stacked') {
      if (show.has('temperature') && (!offset || big)) { const t = el('div', 'gp-ellip', big || '--°'); t.style.lineHeight = '1'; ctx.root.appendChild(t); }
      const small = Math.max(12, Math.round(S * 0.27));
      [show.has('condition') ? cond : '', show.has('high_low') ? hiLo : ''].forEach((s) => {
        if (!s) return;
        const d = el('div', 'gp-label gp-ellip', s);
        d.style.fontSize = small + 'px';
        ctx.root.appendChild(d);
      });
      return;
    }
    const bits = [];
    if (show.has('temperature') && big) bits.push(big + (show.has('condition') && cond ? ' ' + cond : ''));
    else if (show.has('condition') && cond) bits.push(cond);
    if (show.has('high_low') && hiLo) bits.push(hiLo);
    setText(ctx.root, bits.join('  ·  '));
    ctx.root.classList.add('gp-ellip');
  };
  ctx.refresh(render, [entity], 0);
  ctx.every(30 * 60000, loadForecast);
}

function calendarAgenda(ctx) {
  const o = ctx.opts, cals = asList(ctx.slots.calendars), S = ctx.style.size || 32;
  const right = ctx.style.align === 'right';
  let failed = false;
  const stamp = (d) => (o.time_style === '24h' ? ctx.time.time24(d) : o.time_style === 'ampm' ? ctx.time.ampm(d) : ctx.time.shortTime(d));
  const render = async () => {
    if (!cals.length) { clear(ctx.root); return; }
    const from = ctx.time.dayStart(o.day_offset || 0), to = ctx.time.dayStart((o.day_offset || 0) + (o.days || 1));
    failed = false;
    const lists = await Promise.all(cals.map((c) => ctx.data.calendar(c, from, to).catch(() => { failed = true; return []; })));
    const seen = new Set(), items = [];
    lists.forEach((list) => list.forEach((ev) => {
      const allDay = !!(ev.start && ev.start.date);
      if (allDay && o.show_all_day === false) return;
      const when = allDay ? null : new Date(ev.start.dateTime);
      const key = ev.summary + '|' + (allDay ? ev.start.date : ev.start.dateTime);
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ ms: allDay ? 0 : when.getTime(), t: allDay ? '•' : stamp(when), s: ev.summary });
    }));
    items.sort((a, b) => a.ms - b.ms);
    clear(ctx.root);
    ctx.root.style.display = '';
    const shown = items.slice(o.skip || 0, (o.skip || 0) + (o.max_items || 6));
    if (!shown.length) {
      if (o.hide_when_empty) { ctx.root.style.display = 'none'; return; }
      if (o.empty_text && !failed) ctx.root.appendChild(el('div', 'gp-row gp-dim', o.empty_text));
      return;
    }
    shown.forEach((it) => {
      const row = el('div', 'gp-row');
      const t = el('span', 'gp-t', it.t);
      t.style.cssText = right ? 'margin-right:.6em' : 'min-width:' + (ctx.style.align === 'center' ? 0 : 3) + 'em;margin-right:' + (ctx.style.align === 'center' ? '.6em' : '0');
      row.appendChild(t);
      row.appendChild(document.createTextNode(it.s));
      ctx.root.appendChild(row);
    });
  };
  let retry = null;
  const run = async () => {
    clearTimeout(retry);
    await render();
    if (failed) retry = setTimeout(run, 15000);
  };
  ctx.every(300000, run);
  ctx.onDestroy(() => clearTimeout(retry));
}

function todoList(ctx) {
  const o = ctx.opts, entity = ctx.slots.list;
  const render = async () => {
    if (!entity) { clear(ctx.root); return; }
    const res = await ctx.data.service('todo', 'get_items', { entity_id: entity, status: 'needs_action' });
    const items = (res && res.service_response && res.service_response[entity] && res.service_response[entity].items) || [];
    clear(ctx.root);
    ctx.root.style.display = items.length || !o.hide_when_empty ? '' : 'none';
    items.slice(0, o.max_items || 3).forEach((it) => {
      const row = el('div', 'gp-row');
      row.textContent = (o.bullets === false ? '' : '•  ') + it.summary;
      ctx.root.appendChild(row);
    });
  };
  ctx.refresh(render, [entity], 300000);
}

// Which look Now playing uses. Anything unknown or missing means the original "card" look, so existing panes render exactly as before.
// The picture an entity offers. A media player's `entity_picture_local` is served by Home Assistant itself (the remote one may be on the
// internet, which the mirror should not need). A path starting with "/" is resolved against Home Assistant's address.
function pictureOf(ctx, a) {
  const p = (a && (a.entity_picture_local || a.entity_picture)) || '';
  if (!p) return '';
  return p.charAt(0) === '/' && ctx.data && ctx.data.base ? ctx.data.base + p : p;
}
const cssUrl = (u) => 'url("' + String(u).replace(/["\\\n\r]/g, (c) => encodeURIComponent(c)) + '")';

export const NP_STYLES = ['card', 'vinyl', 'cd'];
export function npStyle(opts) {
  const s = opts && opts.style;
  return NP_STYLES.includes(s) ? s : 'card';
}

// Which player to show: the first one playing, otherwise the first one paused recently enough (paused_timeout_minutes).
export function pickPlayer(list, timeoutMinutes, now) {
  const recent = (s) => s && now - Date.parse(s.last_changed || s.last_updated || 0) < (timeoutMinutes || 10) * 60000;
  return list.find((s) => s && s.state === 'playing') || list.find((s) => s && s.state === 'paused' && recent(s)) || null;
}

function nowPlaying(ctx) {
  const o = ctx.opts, players = asList(ctx.slots.players), S = ctx.style.size || 32, look = npStyle(o);
  let view = null;          // vinyl / CD only: the drawn pieces, kept between updates so the tonearm can swing instead of being rebuilt

  // The vinyl record or CD, drawn with CSS only (no picture files). Sized from one number, --d (the disc's width).
  // Only two things ever move: the disc (spins) and the tonearm (swings). Both use CSS "transform" only, each on its own layer,
  // and nothing is animated unless a song is playing (the "playing" class on the outer wrapper is the on/off switch).
  const buildDisc = (p) => {
    const a = p.attributes || {}, d = ctx.h;
    const wrap = el('div', 'gp-np gp-np-' + look + (o.burn_in_saver === true ? ' gp-drift' : ''));
    const stage = el('div', 'gp-np-disc');
    stage.style.cssText = '--d:' + d + 'px;margin-right:' + Math.round(S * 1.1) + 'px';
    const spin = el('div', 'gp-spin gp-' + look);             // the part that rotates
    const label = el('div', 'gp-disc-label');                 // the album art (a plain coloured label when there is none)
    if (o.show_art !== false && pictureOf(ctx, a)) { const i = el('img'); i.alt = ''; i.src = pictureOf(ctx, a); label.appendChild(i); }
    spin.append(el('div', 'gp-disc-sheen'), label, el('div', 'gp-disc-hole'));
    stage.appendChild(spin);
    if (look === 'vinyl') {
      const arm = el('div', 'gp-arm');                        // pivots at its top end; the bar and head hang from it
      arm.append(el('div', 'gp-arm-bar'), el('div', 'gp-arm-head'));
      stage.append(el('div', 'gp-arm-base'), arm);
    }
    wrap.appendChild(stage);
    wrap.appendChild(el('div', 'gp-np-info'));
    return { wrap, label };
  };

  const render = async () => {
    const list = await Promise.all(players.map((p) => ctx.data.state(p)));
    const p = pickPlayer(list, o.paused_timeout_minutes, Date.now());
    if (look !== 'card' && p) {
      const a = p.attributes || {};
      const pic = o.show_art !== false ? pictureOf(ctx, a) : '';
      // draw the record again only when there is none yet or the album art changed; otherwise just update the words and play/pause
      if (!view || !ctx.root.contains(view.wrap) || pic !== view.pic) {
        clear(ctx.root);
        view = buildDisc(p);
        view.pic = pic;
        ctx.root.appendChild(view.wrap);
        // set one frame later, so a freshly drawn tonearm visibly swings onto the record instead of appearing already down
        view.fresh = true;
      }
      const old = view.wrap.querySelector('.gp-np-info');
      old.replaceWith(infoBlock(p, a, false));
      const apply = () => { if (view) view.wrap.classList.toggle('playing', p.state === 'playing'); };
      if (view.fresh) { view.fresh = false; requestAnimationFrame(() => requestAnimationFrame(apply)); } else apply();
      return;
    }
    view = null;
    clear(ctx.root);
    if (!p) {
      // nothing playing: show nothing at all (so an auto-height widget collapses and the sections below move up),
      // unless the pane asked for a message with idle_text
      if (o.idle_text) {
        const idle = el('div', 'gp-dim', o.idle_text);
        idle.style.fontSize = S + 'px';
        ctx.root.appendChild(idle);
      }
      return;
    }
    const a = p.attributes || {}, art = ctx.h;
    const wrap = el('div', 'gp-np' + (o.burn_in_saver === true ? ' gp-drift' : ''));
    if (o.show_art !== false && pictureOf(ctx, a)) {
      const box = el('div', 'gp-np-art');
      box.style.cssText = 'width:' + art + 'px;height:' + art + 'px;margin-right:' + Math.round(S * 1.1) + 'px';
      ['gp-np-glow', 'gp-np-img'].forEach((c) => { const i = el('img', c); i.alt = ''; i.src = pictureOf(ctx, a); box.appendChild(i); });
      wrap.appendChild(box);
    }
    wrap.appendChild(infoBlock(p, a, true));
    ctx.root.appendChild(wrap);
  };

  // title, artist/album and source line: the same words for every look (the little equaliser bars are only on the card look,
  // the record and CD already show movement)
  function infoBlock(p, a, withEq) {
    const info = el('div', 'gp-np-info');
    info.appendChild(el('div', 'gp-ellip', a.media_title || a.app_name || 'Playing'));
    const sub = el('div', 'gp-ellip gp-dim', [a.media_artist, a.media_album_name].filter(Boolean).join('  ·  '));
    sub.style.fontSize = Math.round(S * 0.76) + 'px';
    info.appendChild(sub);
    const src = el('div', 'gp-np-src');
    src.style.fontSize = Math.max(11, Math.round(S * 0.55)) + 'px';
    if (withEq) {
      const eq = el('span', 'gp-eq' + (p.state === 'paused' ? ' paused' : ''));
      for (let i = 0; i < 4; i++) eq.appendChild(el('i'));
      src.appendChild(eq);
    }
    src.appendChild(document.createTextNode([a.friendly_name, a.app_name, p.state === 'paused' ? 'paused' : ''].filter(Boolean).join('  ·  ')));
    info.appendChild(src);
    return info;
  }
  ctx.refresh(render, players, 0);
}

function people(ctx) {
  const o = ctx.opts, ids = asList(ctx.slots.people), S = ctx.style.size || 32, A = o.avatar_size || 65;
  const render = async () => {
    const list = await Promise.all(ids.map((p) => ctx.data.state(p)));
    clear(ctx.root);
    const stack = el('div', 'gp-stack');
    ctx.root.appendChild(stack);
    list.forEach((s) => {
      if (!s) return;
      const a = s.attributes || {}, first = String(a.friendly_name || '').split(' ')[0], home = s.state === 'home';
      const row = el('div', 'gp-person');
      if (o.show_avatar !== false) {
        const av = el('div', 'gp-avatar' + (home ? ' home' : ''));
        av.style.cssText = 'width:' + A + 'px;height:' + A + 'px;font-size:' + Math.round(A * 0.5) + 'px;margin-right:' + Math.round(A * 0.4) + 'px';
        if (pictureOf(ctx, a)) av.style.backgroundImage = cssUrl(pictureOf(ctx, a)); else av.textContent = first.charAt(0);
        row.appendChild(av);
      }
      const txt = el('div');
      txt.appendChild(el('div', 'gp-ellip', first));
      const place = el('div', 'gp-ellip gp-dim', isBad(s.state) ? '-' : s.state === 'home' ? 'Home' : s.state === 'not_home' ? 'Away' : s.state.charAt(0).toUpperCase() + s.state.slice(1));
      place.style.fontSize = Math.round(S * 0.78) + 'px';
      txt.appendChild(place);
      row.appendChild(txt);
      stack.appendChild(row);
    });
  };
  ctx.refresh(render, ids, 0);
}

function lightsSummary(ctx) {
  const o = ctx.opts, ids = asList(ctx.slots.lights), S = ctx.style.size || 32;
  const render = async () => {
    // a light group lists its members in attributes.entity_id; expand those
    let members = [];
    for (const id of ids) {
      const s = await ctx.data.state(id);
      const inner = s && s.attributes && s.attributes.entity_id;
      if (Array.isArray(inner)) members = members.concat(inner); else members.push(id);
    }
    const states = await Promise.all(members.map((m) => ctx.data.state(m)));
    const real = states.filter((m) => m && m.state !== 'unavailable'), on = real.filter((m) => m.state === 'on').length;
    clear(ctx.root);
    const top = el('div');
    top.style.lineHeight = '1';
    top.appendChild(document.createTextNode(String(on)));
    const u = el('span', 'gp-unit', 'of ' + real.length + ' on');
    u.style.fontSize = Math.round(S * 0.36) + 'px';
    top.appendChild(u);
    ctx.root.appendChild(top);
    if (o.show_dots !== false) {
      const dots = el('div', 'gp-dots');
      real.forEach((m) => dots.appendChild(el('i', m.state === 'on' ? 'on' : '')));
      ctx.root.appendChild(dots);
    }
  };
  ctx.refresh(render, ids, 0);
}

// "Only tell me when something is wrong." Each check is {entity, name, text?, bad?, ok?, below?, above?}.
// A check or a feed may be a plain entity id (as the builder and agents bind them) or a rule object.
const asRules = (list) => asList(list).map((k) => (typeof k === 'string' ? { entity: k } : k)).filter((k) => k && k.entity);

function statusSummary(ctx) {
  const o = ctx.opts, checks = asRules(ctx.slots.checks);
  const staleMs = (o.stale_days != null ? o.stale_days : 30) * 86400000 || Infinity;
  const render = async () => {
    const list = await Promise.all(checks.map((k) => ctx.data.state(k.entity)));
    const issues = [];
    list.forEach((s, i) => {
      const k = checks[i], v = s ? s.state : 'unavailable', n = strictNumber(v), offline = !s || v === 'unavailable' || v === 'unknown';
      let why = null;
      if (k.below != null) { if (isNaN(n)) why = 'offline'; else if (n < k.below) why = 'low'; }
      else if (k.above != null) { if (isNaN(n)) why = 'offline'; else if (n > k.above) why = 'high'; }
      else if (k.ok) { if (k.ok.indexOf(v) < 0) why = offline ? 'offline' : v; }
      else if (k.bad ? k.bad.indexOf(v) >= 0 : isBad(v)) why = offline ? 'offline' : v;
      // offline for a long time is deliberate, not a surprise: stop mentioning it
      if (why === 'offline' && s && s.last_changed && Date.now() - Date.parse(s.last_changed) > staleMs) why = null;
      if (why) issues.push((k.name || k.entity) + (k.text ? ' ' + k.text : ' ' + why));
    });
    clear(ctx.root);
    if (!issues.length) {
      if (o.hide_when_ok) return;
      const line = el('div', 'gp-ok');
      line.appendChild(el('span', 'gp-dot'));
      line.appendChild(document.createTextNode(o.ok_text || 'All good'));
      ctx.root.appendChild(line);
      return;
    }
    issues.slice(0, o.max_items || 6).forEach((t) => {
      const line = el('div', 'gp-issue');
      line.appendChild(el('span', 'gp-dot'));
      line.appendChild(document.createTextNode(t));
      ctx.root.appendChild(line);
    });
  };
  ctx.refresh(render, checks.map((k) => k.entity), 0);
}

function progressRing(ctx) {
  const o = ctx.opts, entity = ctx.slots.entity, S = ctx.style.size || 32;
  const render = async () => {
    const s = entity ? await ctx.data.state(entity) : null, v = num(s);
    const a = (s && s.attributes) || {}, unit = unitOf(s);
    // a number or input_number knows its own range; anything else is 0 to 100 unless the options say otherwise
    const ownMin = strictNumber(a.min), ownMax = strictNumber(a.max);
    const min = o.min != null ? o.min : !isNaN(ownMin) ? ownMin : 0, max = o.max != null ? o.max : !isNaN(ownMax) ? ownMax : 100;
    const pct = isNaN(v) ? 0 : Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
    let color = 'var(--gp-accent)';
    if (!isNaN(v)) {
      if ((o.crit_below != null && v < o.crit_below) || (o.crit_above != null && v > o.crit_above)) color = 'var(--gp-bad)';
      else if ((o.warn_below != null && v < o.warn_below) || (o.warn_above != null && v > o.warn_above)) color = 'var(--gp-warn)';
      else if (o.warn_above != null || o.warn_below != null) color = 'var(--gp-good)';
    }
    const c = 2 * Math.PI * 44;
    clear(ctx.root);
    const wrap = el('div', 'gp-ring');
    wrap.innerHTML = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="#262626" stroke-width="7"/>' +
      '<circle cx="50" cy="50" r="44" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' +
      (c * pct / 100).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg>';
    const mid = el('div', 'gp-ring-v');
    // "%" only when the value really is a percentage; otherwise the entity's own unit (21 °C stays 21 °C)
    const pctLike = unit === '%' || (!unit && min === 0 && max === 100);
    mid.appendChild(el('b', '', isNaN(v) ? '-' : Math.round(v) + (pctLike ? '%' : unit ? ' ' + unit : '')));
    if (o.label) { const l = el('span', '', o.label); l.style.fontSize = Math.max(9, Math.round(S * 0.5)) + 'px'; mid.appendChild(l); }
    mid.firstChild.style.fontSize = S + 'px';
    wrap.appendChild(mid);
    ctx.root.appendChild(wrap);
  };
  ctx.refresh(render, [entity], 0);
}

// ---------------------------------------------------------------- sports (Team Tracker style sensors)

function parseGame(s, time, dayOnly) {
  if (!s || !s.attributes || isBad(s.state)) return null;
  const a = s.attributes, t = Date.parse(a.date), now = Date.now(), h = 3600000;
  let kind = null;
  if (s.state === 'IN') kind = 'live';
  else if (s.state === 'POST' && now - t < 18 * h && (!dayOnly || time.sameDay(new Date(t), new Date()))) kind = 'final';   // dayOnly: a final only until midnight
  else if (s.state === 'PRE' && t - now < 18 * h && t > now - 3 * h && time.sameDay(new Date(t), new Date())) kind = 'tonight';
  else if (!dayOnly && s.state === 'PRE' && t - now < 7 * 24 * h && t > now) kind = 'next';                                   // dayOnly: never announce a later game
  if (!kind) return null;
  return {
    kind, name: a.team_name, opp: a.opponent_name, logo: a.team_logo, ologo: a.opponent_logo, ts: a.team_score, os: a.opponent_score,
    win: a.team_winner, color: (a.team_colors || [])[0], tv: a.tv_network, t: new Date(t), clock: a.clock, period: a.quarter != null ? a.quarter : a.period, home: a.team_homeaway === 'home',
  };
}

export { parseGame };   // exported so the game-picking rules can be tested on their own

// "3rd", "OT", "Halftime"... from the period number if the sensor gives one, else out of the clock text. Never the running clock.
function periodText(g) {
  const n = parseInt(g.period, 10);
  if (n > 0) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  const m = /(\d+(?:st|nd|rd|th)|OT|overtime|half(?:time)?|end of \w+|(?:top|bot(?:tom)?|mid) \d+\w*)/i.exec(g.clock || '');
  return m ? m[1] : '';
}
const liveText = (g) => { const p = periodText(g); return p ? 'Live · ' + p : 'Live'; };

function sports(ctx) {
  const o = ctx.opts, teams = asList(ctx.slots.teams), S = ctx.style.size || 32, T = ctx.time;
  const vs = (g) => (g.home ? 'vs' : '@');
  const showLogos = o.show_logos !== false;
  const logo = (u) => {
    if (!showLogos) return document.createDocumentFragment();           // logos switched off: draw nothing
    const im = el('img'); im.alt = '';
    if (u) im.src = u; else im.style.visibility = 'hidden';
    im.onerror = () => { im.style.visibility = 'hidden'; };
    return im;
  };
  const render = async () => {
    const list = await Promise.all(teams.map((t) => ctx.data.state(t)));
    const games = list.map((s) => parseGame(s, T, o.game_day_only === true)).filter(Boolean);
    const order = { live: 0, final: 1, tonight: 2, next: 3 };
    games.sort((a, b) => order[a.kind] - order[b.kind] || a.t - b.t);
    const now = games.filter((g) => g.kind !== 'next');
    const nexts = games.filter((g) => g.kind === 'next');
    const max = o.max_games || 3;
    clear(ctx.root);

    if (o.layout === 'line') {
      // one game per line; a long line wraps rather than being cut off
      now.slice(0, max).forEach((g) => {
        const line = el('div', 'gp-gline');
        if (g.kind === 'final') {
          line.appendChild(document.createTextNode(g.name + ' '));
          line.appendChild(el('span', g.win ? 'gp-win' : 'gp-loss', g.win ? 'W ' : 'L '));
          line.appendChild(document.createTextNode(g.ts + '–' + g.os + ' ' + g.opp));
        } else if (g.kind === 'live') {
          line.appendChild(el('span', 'gp-live', '● '));
          line.appendChild(document.createTextNode(g.name + ' ' + g.ts + '–' + g.os + ' ' + g.opp + (periodText(g) ? '  ·  ' + periodText(g) : '')));
        } else line.appendChild(document.createTextNode(g.name + ' play at ' + T.shortTime(g.t)));
        ctx.root.appendChild(line);
      });
      return;
    }

    if (o.layout === 'box') {
      // two rows per game so it fits a narrow column
      const soon = nexts.filter((g) => g.t.getTime() - Date.now() < 24 * 3600000);
      now.concat(soon).slice(0, max).forEach((g) => {
        const box = el('div', 'gp-box'), played = g.kind === 'final' || g.kind === 'live';
        if (!showLogos) box.style.gridTemplateColumns = '1fr auto';
        [[g.logo, g.name, g.ts, g.kind !== 'final' || g.win], [g.ologo, g.opp, g.os, g.kind !== 'final' || !g.win]].forEach((r, k) => {
          box.appendChild(logo(r[0]));
          box.appendChild(el('span', r[3] ? '' : 'gp-dim', r[1]));
          box.appendChild(el('span', 'gp-score' + (r[3] ? '' : ' gp-dim'),
            played ? String(r[2]) : k === 0 ? (T.sameDay(g.t, new Date()) ? 'Tonight' : T.parts(g.t).wd.slice(0, 3)) : T.ampm(g.t)));
        });
        if (g.kind === 'live') box.appendChild(el('div', 'gp-boxlive', '● ' + liveText(g)));
        ctx.root.appendChild(box);
      });
      return;
    }

    // rows: logo / score / logo, with a headline beside them (in one block, so a centred list keeps its columns lined up)
    const stack = el('div', 'gp-stack');
    ctx.root.appendChild(stack);
    now.slice(0, max).forEach((g) => {
      const row = el('div', 'gp-game');
      row.style.borderLeftColor = g.color || 'var(--gp-line)';
      const mid = el('span', 'gp-mid');
      if (g.kind === 'tonight') mid.appendChild(el('span', 'gp-dash', vs(g)));
      else {
        mid.appendChild(el('span', 'gp-sc' + (g.kind === 'final' && !g.win ? ' gp-dim' : ''), String(g.ts)));
        mid.appendChild(el('span', 'gp-dash', '–'));
        mid.appendChild(el('span', 'gp-sc' + (g.kind === 'final' && g.win ? ' gp-dim' : ''), String(g.os)));
      }
      row.appendChild(logo(g.logo));
      row.appendChild(mid);
      row.appendChild(logo(g.ologo));
      const gi = el('div', 'gp-gi'), head = el('b');
      if (g.kind === 'live') head.appendChild(el('span', 'gp-live', '● '));
      // short by default: the scores already say who won (the loser's is dimmed), so just "Final" or the time; verbose_text brings the old wording back
      head.appendChild(document.createTextNode(o.verbose_text
        ? (g.kind === 'final' ? (g.win ? g.name + ' win' : g.name + ' lose') + ' · Final' : g.kind === 'live' ? liveText(g) : g.name + ' play at ' + T.shortTime(g.t))
        : (g.kind === 'final' ? 'Final' : g.kind === 'live' ? liveText(g) : 'Tonight · ' + T.ampm(g.t))));
      gi.appendChild(head);
      row.appendChild(gi);
      stack.appendChild(row);
    });
    // only "vs" games (nothing scored yet): pull the two logos in close. With scores in the list the middle keeps its width so the columns line up.
    if (stack.children.length && now.slice(0, max).every((g) => g.kind === 'tonight')) stack.classList.add('gp-tight');
    if (o.show_next !== false) {
      nexts.slice(0, 2).forEach((g) => {
        ctx.root.appendChild(el('div', 'gp-next gp-dim', 'Next: ' + g.name + ' ' + vs(g) + ' ' + g.opp + ' · ' + T.dayTime(g.t)));
      });
    }
  };
  ctx.refresh(render, teams, 0);
}

// ---------------------------------------------------------------- news

// Feedreader-style event entities only hold the newest story of each feed, so the player keeps a week's worth on the
// device as stories arrive and picks from that pile.
const htmlDoc = (h) => new DOMParser().parseFromString(h || '', 'text/html');
function storyFrom(s, srcName) {
  const a = s.attributes || {};
  if (!a.title || !a.link) return null;
  const dd = htmlDoc(a.description), plain = dd.body.textContent.replace(/\s+/g, ' ').trim();
  return { title: a.title.trim(), link: a.link, src: srcName || a.friendly_name || '', text: plain.slice(0, 320), t: Date.parse(s.state) || Date.now() };
}
const cleanTitle = (t) => String(t).replace(/^(WATCH LIVE|WATCH|LISTEN|LIVE UPDATES|LIVE|ANALYSIS|BREAKING)\s*:\s*/i, '').trim();
// Headlines have to read in a glance: skip explainers, questions, podcasts and very long ones.
function quick(t, max) {
  const c = cleanTitle(t);
  if (/^(how|why|what|who|when|where|here's|here’s|here is|opinion|podcast|photos|video|quiz|do you|does|did you|is it|are you|can you|should you)\b/i.test(c)) return false;
  if (/\b(signs of|what to know|things to know|tips for|explained|recipe)\b/i.test(c) || /\?/.test(c)) return false;
  return c.length <= max;
}

function news(ctx) {
  const o = ctx.opts, feeds = asRules(ctx.slots.feeds), S = ctx.style.size || 32;
  const key = 'glass_panes_news_' + ctx.paneId + '_' + ctx.widgetId;
  let pile = [];
  try { pile = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e) { pile = []; }
  const kws = (o.keywords || []).map((w) => new RegExp('[^a-z]' + w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^a-z]'));
  const counts = (n) => n.all || !kws.length || kws.some((re) => re.test((' ' + n.title + ' ' + n.text + ' ').toLowerCase()));
  const render = async () => {
    const list = await Promise.all(feeds.map((f) => ctx.data.state(f.entity)));
    list.forEach((s, i) => {
      const item = okState(s) ? storyFrom(s, feeds[i].name) : null;
      if (!item) return;
      item.all = feeds[i].filter !== 'keywords';
      if (!pile.some((n) => n.link === item.link || n.title === item.title)) pile.push(item);
    });
    const cut = Date.now() - 7 * 86400000;
    pile = pile.filter((n) => n.t > cut).sort((a, b) => b.t - a.t).slice(0, 40);
    try { localStorage.setItem(key, JSON.stringify(pile)); } catch (e) { /* storage may be unavailable */ }
    const big = pile.filter((n) => counts(n) && quick(n.title, o.max_headline_chars || 110));
    const fresh = big.filter((n) => Date.now() - n.t < (o.max_age_hours || 36) * 3600000);
    const pick = fresh.concat(big.filter((n) => fresh.indexOf(n) < 0)).slice(0, o.max_stories || 1);
    clear(ctx.root);
    pick.forEach((n, i) => {
      const d = el('div', 'gp-story');
      const h = el('div', 'gp-headline', cleanTitle(n.title));
      if (i > 0) h.style.fontSize = Math.round(S * 0.8) + 'px';
      d.appendChild(h);
      if (o.show_source && n.src) d.appendChild(el('div', 'gp-label', n.src));
      ctx.root.appendChild(d);
    });
    if (!pick.length) ctx.root.appendChild(el('div', 'gp-dim', 'Slow news day.'));
  };
  ctx.refresh(render, feeds.map((f) => f.entity), 0);
}

export const widgets = {
  clock, date, text, image, video, divider, message,
  entity_value: entityValue, weather, calendar_agenda: calendarAgenda, todo_list: todoList, now_playing: nowPlaying,
  people, lights_summary: lightsSummary, status_summary: statusSummary, progress_ring: progressRing, sports, news,
};
