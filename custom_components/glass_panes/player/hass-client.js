// A data client for pages that run inside the Home Assistant frontend, such as the sidebar builder.
//
// It has the same methods as the player's clients (state, track, onChange, calendar, service, connect) but gets everything through
// the frontend's own logged-in connection (the `hass` object it hands to panels), so it needs no access token. States arrive
// already live: call setHass() with each new `hass` object and widgets watching a changed entity refresh.

import { blobPicture } from './util.js';

export class HassClient {
  constructor() {
    this.hass = null;
    this.tracked = new Set();
    this.listeners = [];
    this.live = true;
  }

  /** Give it the latest `hass` object. Entities it is tracking that changed are announced to the listeners. */
  setHass(hass) {
    const old = this.hass;
    this.hass = hass;
    if (!old) return;
    for (const id of this.tracked) {
      if (old.states[id] !== hass.states[id]) this.listeners.forEach((fn) => fn(id, hass.states[id] || null));
    }
  }

  onChange(fn) { this.listeners.push(fn); }

  track(ids) { (ids || []).forEach((id) => id && this.tracked.add(id)); }

  connect() { /* the frontend already holds the connection */ }

  async state(id) {
    if (!id) return null;
    this.tracked.add(id);
    return (this.hass && this.hass.states[id]) || null;
  }

  // The address of an uploaded picture or video (a signed link, so the preview needs no extra login).
  async mediaUrl(id) {
    if (!(this._media && Date.now() - this._media.at < 1800000 && this._media.map.has(id))) {
      try {
        const reply = await this.hass.callWS({ type: 'glass_panes/media/list' });
        this._media = { at: Date.now(), map: new Map(reply.media.map((m) => [m.id, m.url])) };
      } catch (e) { /* no library yet */ }
    }
    const url = this._media && this._media.map.get(id);
    return url ? (this.hass.hassUrl ? this.hass.hassUrl(url) : url) : null;
  }

  /** The photos in a media folder as addresses of copies shrunk to w by h. */
  async slideshowItems(folder, w, h) {
    try {
      const reply = await this.hass.callWS({ type: 'glass_panes/slideshow/list', folder, w, h });
      const abs = (u) => (this.hass.hassUrl ? this.hass.hassUrl(u) : u);
      return { items: (reply.items || []).map(abs), problem: reply.problem || null };
    } catch (e) {
      return { items: [], problem: 'unavailable' };
    }
  }

  /** The current picture of an image or camera entity (shrunk), as something an <img> can show. */
  async picture(entity, w, h) {
    return blobPicture(async () => {
      const reply = await this.hass.callWS({ type: 'glass_panes/picture/url', entity, w, h });
      return this.hass.hassUrl ? this.hass.hassUrl(reply.url) : reply.url;
    });
  }

  /** Forget the list of uploaded files (after one is added or removed). */
  forgetMedia() { this._media = null; }

  async calendar(id, start, end) {
    const q = '?start=' + encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString());
    const list = await this.hass.callApi('GET', 'calendars/' + id + q);
    return Array.isArray(list) ? list : [];
  }

  // Services that return data (weather forecasts, to-do items). A refused or unsupported call just gives null.
  async service(domain, name, data) {
    try {
      const reply = await this.hass.callWS({ type: 'call_service', domain, service: name, service_data: data, return_response: true });
      return { service_response: reply.response };
    } catch (e) {
      return null;
    }
  }
}
