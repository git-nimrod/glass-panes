// Where the player gets Home Assistant data from. Two interchangeable clients with the same methods:
//   HAClient   talks to a real Home Assistant (REST for reads, websocket for live changes).
//   MockClient makes up believable data so a pane can be previewed with no Home Assistant at all.
//
// Methods both have:  state(id), track(ids), onChange(fn), calendar(id, start, end), service(domain, name, data)
//
// The HAClient is the "developer" data path: it uses a long-lived access token that the owner creates and pastes
// once, the same way the original mirror page did. The planned per-display endpoint (build step 4) will replace it
// so nobody has to paste a user token into a display. Only the calls the original page already used are used here.

import { slugDomain } from './util.js';

export class HAClient {
  constructor({ base = '', getToken, onAuthFail }) {
    this.base = base.replace(/\/$/, '');
    this.getToken = getToken;
    this.onAuthFail = onAuthFail || (() => {});
    this.cache = new Map();
    this.tracked = new Set();
    this.listeners = [];
    this.live = false;
    this.ws = null;
    this.tries = 0;
    this.pingTimer = null;
    this.pingId = 0;
  }

  _headers() {
    return { Authorization: 'Bearer ' + this.getToken(), 'Content-Type': 'application/json' };
  }

  // Once Home Assistant has refused the login (or there is none), stop asking: every refused request is logged as a failed login, and
  // with a ban threshold set Home Assistant would ban the mirror's address. The sign-in screen takes over until a new login is saved.
  _refused() {
    if (!this.rejected) { this.rejected = true; this.onAuthFail(); }
  }

  async _fetch(path, opts = {}) {
    if (this.rejected || !this.getToken()) throw new Error('401');
    const r = await fetch(this.base + path, { ...opts, headers: this._headers(), cache: 'no-store' });
    if (r.status === 401) { this._refused(); throw new Error('401'); }
    return r;
  }

  onChange(fn) { this.listeners.push(fn); }

  track(ids) { ids.forEach((id) => id && this.tracked.add(id)); }

  async state(id) {
    if (!id) return null;
    this.tracked.add(id);
    if (this.live && this.cache.has(id)) return this.cache.get(id);
    try {
      const r = await this._fetch('/api/states/' + encodeURIComponent(id));
      if (r.status === 404) { this.cache.set(id, null); return null; }
      if (!r.ok) return null;
      const j = await r.json();
      this.cache.set(id, j);
      return j;
    } catch (e) {
      if (e.message === '401') throw e;
      return null;
    }
  }

  // The entity bindings (which entity feeds which widget). They live in the integration behind a login, so this uses the same
  // token as everything else. Returns null if the endpoint is not there (an older integration) or the request fails.
  // The address of an uploaded picture or video: a signed link that opens without a login, valid for days.
  // `fresh` skips the cache: a link stops working after a Home Assistant restart (its signing key changes) or after 7 days.
  async mediaUrl(id, fresh = false) {
    if (fresh || !(this._media && Date.now() - this._media.at < 1800000 && this._media.map.has(id))) {
      try {
        const r = await this._fetch('/api/glass_panes/media');
        if (r.ok) this._media = { at: Date.now(), map: new Map(((await r.json()).media || []).map((m) => [m.id, m.url])) };
      } catch (e) {
        if (e.message === '401') throw e;
      }
    }
    const url = this._media && this._media.map.get(id);
    return url ? this.base + url : null;
  }

  async bindings() {
    try {
      const r = await this._fetch('/api/glass_panes/bindings');
      return r.ok ? await r.json() : null;
    } catch (e) {
      if (e.message === '401') throw e;
      return null;
    }
  }

  // A pane's layout from the integration: a pane saved from the builder wins over the shipped one of the same id.
  // Returns null if there is no such pane or the endpoint is missing, so the caller can fall back to the shipped files.
  async pane(id) {
    try {
      const r = await this._fetch('/api/glass_panes/panes/' + encodeURIComponent(id));
      return r.ok ? await r.json() : null;
    } catch (e) {
      if (e.message === '401') throw e;
      return null;
    }
  }

  // One display: its name, timezone, current pane and the select entity that switches it.
  async display(id) {
    try {
      const r = await this._fetch('/api/glass_panes/displays/' + encodeURIComponent(id));
      return r.ok ? await r.json() : null;
    } catch (e) {
      if (e.message === '401') throw e;
      return null;
    }
  }

  async calendar(id, start, end) {
    const q = '?start=' + encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString());
    const r = await this._fetch('/api/calendars/' + encodeURIComponent(id) + q);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const list = await r.json();
    return Array.isArray(list) ? list : [];
  }

  // Services that return data (weather forecasts, to-do items). A plain fetch on purpose: if Home Assistant refuses one
  // of these, that must not be treated as a bad token.
  async service(domain, name, data) {
    try {
      const r = await fetch(this.base + '/api/services/' + domain + '/' + name + '?return_response', {
        method: 'POST', headers: this._headers(), body: JSON.stringify(data),
      });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  }

  connect() {
    if (this.ws || this.rejected || !this.getToken()) return;
    const origin = this.base || location.origin;
    const url = origin.replace(/^http/, 'ws') + '/api/websocket';
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this._retry(); return; }
    this.ws = ws;
    // A connection can die without closing (the Home Assistant host freezes, a router reboots, Wi-Fi drops). Then nothing arrives and
    // entity widgets would freeze while the clock keeps ticking. So: login must finish within 15 s, every ping must be answered within
    // 10 s, and 75 s of silence counts as dead. Message ids always increase (Home Assistant ignores a reused id).
    this.lastMsg = Date.now();
    this.nextId = 2;
    this.pendingPing = null;
    const authTimer = setTimeout(() => { if (this.ws === ws && !this.live) this._down(); }, 15000);
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (this.ws !== ws || !this.live) return;
      const late = this.pendingPing && Date.now() - this.pendingPing.at > 10000;
      if (late || Date.now() - this.lastMsg > 75000) this._down();
    }, 5000);
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      this.lastMsg = Date.now();
      if (m.type === 'pong' && this.pendingPing && m.id === this.pendingPing.id) { this.pendingPing = null; return; }
      if (m.type === 'result' && m.id === 1 && m.success === false) { this._down(); return; }   // the subscription was refused
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: this.getToken() }));
      else if (m.type === 'auth_ok') {
        clearTimeout(authTimer);
        this.generation = (this.generation || 0) + 1;      // counts connections: a new one after a drop may mean Home Assistant restarted
        ws.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }));
        this.cache.clear();
        this.live = true;
        this.tries = 0;
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          const id = this.nextId++;
          this.pendingPing = { id, at: Date.now() };
          try { ws.send(JSON.stringify({ id, type: 'ping' })); } catch (e) { /* closed */ }
        }, 30000);
        this.listeners.forEach((fn) => fn(null, null));   // everything may have changed while we were away
      } else if (m.type === 'auth_invalid') {
        this.live = false;
        this._refused();
      } else if (m.type === 'event' && m.event && m.event.data) {
        const d = m.event.data;
        if (!this.tracked.has(d.entity_id)) return;
        if (d.new_state) this.cache.set(d.entity_id, d.new_state); else this.cache.delete(d.entity_id);
        this.listeners.forEach((fn) => fn(d.entity_id, d.new_state));
      }
    };
    ws.onclose = ws.onerror = () => this._down();
  }

  _down() {
    this.live = false;
    this.cache.clear();
    clearInterval(this.pingTimer);
    clearInterval(this.watchdog);
    this.pendingPing = null;
    if (this.ws) {
      try { this.ws.onclose = this.ws.onerror = null; this.ws.close(); } catch (e) { /* already closed */ }
      this.ws = null;
    }
    this._retry();
  }

  _retry() {
    if (this.rejected) return;                     // a refused login is not retried (see _refused)
    // 2 s, 4 s, 8 s ... up to 60 s, each with up to 20 % random jitter so many displays don't all reconnect in the same instant
    const base = Math.min(60000, 2000 * Math.pow(2, Math.min(this.tries, 5)));
    setTimeout(() => this.connect(), base * (0.8 + Math.random() * 0.4));
    this.tries++;
  }
}

// ---------------------------------------------------------------------------------------------------------------

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return h;
}

// Made-up album art for the sample track: a plain square of colour with a few circles, drawn inline as an SVG data link,
// so previews never load a picture from anywhere.
export const MOCK_ALBUM_ART = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f4e79"/><stop offset="1" stop-color="#c0583a"/></linearGradient></defs>' +
  '<rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="150" r="90" fill="none" stroke="#f2e6c9" stroke-width="10"/>' +
  '<circle cx="150" cy="150" r="48" fill="#f2e6c9"/><circle cx="230" cy="70" r="22" fill="#e8b04a"/></svg>');

// A little round badge with the team's first letter, standing in for the team logo a real sensor would give.
function badge(name, color) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="' + color +
    '"/><text x="50" y="67" font-size="50" text-anchor="middle" fill="#fff" font-family="sans-serif">' + name.charAt(0) + '</text></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const TEAMS = [['Lions', 'Vikings'], ['Spurs', 'Jazz'], ['Red Wings', 'Bruins'], ['Cubs', 'Cardinals']];

export class MockClient {
  async mediaUrl() { return null; }          // nothing is uploaded in mock mode

  constructor(time) {
    this.time = time;
    this.live = true;
    this.over = {};        // states set by hand with set(), for testing pane switching
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }

  set(id, state) {
    this.over[id] = state;
    this.listeners.forEach((fn) => fn(id, this._state(id)));
  }

  track() { /* nothing to subscribe to */ }

  connect() { /* nothing to connect */ }

  async state(id) {
    return this._state(id);
  }

  _state(id) {
    if (id in this.over) return { entity_id: id, state: this.over[id], attributes: {}, last_changed: new Date().toISOString() };
    const domain = slugDomain(id), name = String(id).split('.')[1] || '', now = Date.now(), iso = (t) => new Date(t).toISOString();
    const make = (state, attributes = {}) => ({ entity_id: id, state, attributes, last_changed: iso(now - 3600000), last_updated: iso(now) });
    switch (domain) {
      case 'weather': return make('partlycloudy', { temperature: 61, friendly_name: 'Weather' });
      case 'person': {
        const home = hash(name) % 2 === 0;
        return make(home ? 'home' : 'not_home', { friendly_name: ['Alex Morgan', 'Sam Rivera', 'Jo Kim'][hash(name) % 3] });
      }
      case 'light': {
        if (name.endsWith('_all')) {
          return make('on', { entity_id: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => 'light.demo_' + n) });
        }
        return make(hash(name) % 2 ? 'on' : 'off');
      }
      case 'media_player': {
        // a widget's first made-up player (its name ends in _1) always plays, so a sample preview always has a track to show
        const first = /_1$/.test(name) || hash(name) % 3 === 0;
        return first
          ? make('playing', { friendly_name: 'Living room speaker', media_title: 'Blue in Green', media_artist: 'Miles Davis', media_album_name: 'Kind of Blue', app_name: 'Music', entity_picture: MOCK_ALBUM_ART })
          : make('idle', { friendly_name: 'Bedroom speaker' });
      }
      case 'input_text': case 'text': return make('Welcome home');
      case 'binary_sensor': return make(name === 'demo_a' ? 'on' : 'off', { friendly_name: name });
      case 'lock': return make('locked');
      case 'todo': return make('3');
      case 'calendar': return make('off');
      case 'event': {
        const n = 1 + hash(name) % 3, topics = ['Council approves the new transit budget', 'Senate votes on the spending bill', 'Mayor announces a downtown plan'];
        return make(iso(now - n * 3600000), {
          title: topics[(n - 1) % 3], link: 'https://example.invalid/story/' + name, friendly_name: 'Demo news',
          description: '<p>A short summary of the story that sits under the headline in the feed.</p>', content: '',
        });
      }
      case 'sensor': {
        const m = /^demo_team_(\d)$/.exec(name);
        if (m) return this._game(id, +m[1]);
        const v = (hash(name) % 700) / 10 + 20;
        return make(v.toFixed(1), { unit_of_measurement: '%', friendly_name: name });
      }
      default: return make('on');
    }
  }

  _game(id, n) {
    const now = Date.now(), h = 3600000, [team, opp] = TEAMS[(n - 1) % TEAMS.length];
    const base = { team_name: team, opponent_name: opp, team_logo: badge(team, '#3a7bd5'), opponent_logo: badge(opp, '#c0562b'), team_colors: ['#4a90d9'], tv_network: 'NET', league: 'DEMO', team_homeaway: n % 2 ? 'home' : 'away' };
    const kinds = {
      1: ['POST', now - 3 * h, { team_score: 27, opponent_score: 20, team_winner: true }],
      2: ['PRE', now + 2 * h, {}],
      3: ['IN', now - h, { team_score: 2, opponent_score: 1, clock: '5:12', quarter: 3 }],
      4: ['PRE', now + 30 * h, {}],
    };
    const [state, t, extra] = kinds[n] || kinds[4];
    return { entity_id: id, state, attributes: { ...base, ...extra, date: new Date(t).toISOString() }, last_changed: new Date(now).toISOString() };
  }

  async calendar(id, start) {
    const t = this.time, h = 3600000, p = t.parts(new Date(start.getTime() + 6 * h)), pad = (v) => String(v).padStart(2, '0');
    const date = p.y + '-' + pad(p.mo) + '-' + pad(p.d);
    const all = [
      { summary: 'Team standup', start: { dateTime: new Date(start.getTime() + 9 * h).toISOString() } },
      { summary: 'Dentist', start: { dateTime: new Date(start.getTime() + 14.5 * h).toISOString() } },
      { summary: 'Dinner with friends', start: { dateTime: new Date(start.getTime() + 18 * h).toISOString() } },
      { summary: 'Sam’s birthday', start: { date } },
    ];
    return hash(String(id)) % 2 ? all.slice(0, 3) : all.slice(1);
  }

  async service(domain, name, data) {
    const t = this.time, ent = data.entity_id;
    if (domain === 'weather') {
      const out = [];
      if (data.type === 'twice_daily') {
        for (let i = 0; i < 4; i++) {
          const day = t.dayStart(i), dt = new Date(day.getTime() + 7 * 3600000);
          out.push({ datetime: dt.toISOString(), is_daytime: true, temperature: 76 - i, condition: 'sunny' });
          out.push({ datetime: new Date(day.getTime() + 19 * 3600000).toISOString(), is_daytime: false, temperature: 58 - i, condition: 'clear-night' });
        }
      } else {
        for (let i = 0; i < 4; i++) out.push({ datetime: t.dayStart(i).toISOString(), temperature: 76 - i, templow: 58 - i, condition: 'sunny' });
      }
      return { service_response: { [ent]: { forecast: out } } };
    }
    if (domain === 'todo') {
      return { service_response: { [ent]: { items: ['Take out the recycling', 'Call the plumber', 'Buy milk', 'Water the plants'].map((s) => ({ summary: s })) } } };
    }
    return null;
  }
}

// For previews: invents a binding for every slot of every widget in a pane, so the whole pane has something to show.
export function mockBindings(registry, pane) {
  const widgets = {};
  for (const w of pane.widgets) {
    const slots = (registry[w.type] || {}).slots || {};
    const out = {};
    // a message with its own lines shows those lines in the preview too (its entity slot is optional)
    if (w.type === 'message' && w.options && Array.isArray(w.options.lines) && w.options.lines.length) continue;
    for (const [name, spec] of Object.entries(slots)) {
      const dom = (spec.domains && spec.domains[0]) || 'sensor';
      if (spec.kind === 'entity') out[name] = dom + '.demo_' + w.id;
      else if (spec.kind === 'entities') {
        if (w.type === 'sports') out[name] = [1, 2, 3, 4].map((n) => 'sensor.demo_team_' + n);
        else if (w.type === 'lights_summary') out[name] = ['light.demo_all'];
        else out[name] = [1, 2, 3].map((n) => dom + '.demo_' + w.id + '_' + n);
      } else if (spec.kind === 'checks') {
        out[name] = [
          { entity: 'binary_sensor.demo_a', name: 'Front door', bad: ['on'], text: 'is open' },
          { entity: 'binary_sensor.demo_b', name: 'Back door', bad: ['on'], text: 'is open' },
        ];
      } else if (spec.kind === 'feeds') {
        out[name] = [1, 2, 3].map((n) => ({ entity: 'event.demo_feed_' + n, name: 'Demo News', filter: 'all' }));
      }
    }
    if (Object.keys(out).length) widgets[w.id] = out;
  }
  return widgets;
}
