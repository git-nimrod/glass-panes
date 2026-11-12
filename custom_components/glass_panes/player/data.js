// Where the player gets Home Assistant data from. HAClient talks to a real Home Assistant (REST for reads, websocket for live changes).
// Its stand-in, MockClient (made-up data for previews), is in mock.js and has the same methods.
//
// Methods both have:  state(id), track(ids), onChange(fn), calendar(id, start, end), service(domain, name, data)
//
// The HAClient is the "developer" data path: it uses a long-lived access token that the owner creates and pastes
// once, the same way the original mirror page did. The planned per-display endpoint (build step 4) will replace it
// so nobody has to paste a user token into a display. Only the calls the original page already used are used here.

import { blobPicture, slugDomain } from './util.js';

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

  // The photos in a media folder, as addresses of copies the integration has already shrunk to w by h (a phone photo would be too big
  // for a small mirror). `fresh` is accepted for symmetry with mediaUrl; the integration signs new addresses on every call.
  async slideshowItems(folder, w, h) {
    try {
      const r = await this._fetch('/api/glass_panes/slideshow?folder=' + encodeURIComponent(folder) + '&w=' + w + '&h=' + h);
      if (r.ok) { const j = await r.json(); return { items: (j.items || []).map((u) => this.base + u), problem: j.problem || null }; }
    } catch (e) {
      if (e.message === '401') throw e;
    }
    return { items: [], problem: 'unavailable' };
  }

  // The current picture of an image or camera entity, shrunk by the integration. Returns something an <img> can show, or null.
  async picture(entity, w, h) {
    this._pics = this._pics || new Map();
    const key = entity + '|' + w + 'x' + h;
    return blobPicture(async (fresh) => {
      const known = this._pics.get(key);
      if (!fresh && known && Date.now() - known.at < 6 * 3600000) return known.url;
      const r = await this._fetch('/api/glass_panes/picture_url?entity=' + encodeURIComponent(entity) + '&w=' + w + '&h=' + h);
      if (!r.ok) return null;
      const url = this.base + (await r.json()).url;
      this._pics.set(key, { url, at: Date.now() });
      return url;
    });
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
