// The Glass Panes sidebar panel: see your panes, switch displays, and edit a pane by dragging things around.
//
// Home Assistant mounts this custom element as a full-screen panel and keeps giving it a fresh `hass` object. Everything is read and
// changed through the integration's websocket API (glass_panes/...), which is admin-only for changes. Panes are drawn with the very same
// engine the player uses, so the preview is what a display shows. Live data comes through the panel's own connection: no token.
//
// Editing (the "Edit pane" button) lays a transparent layer of boxes over the preview, one per widget. Dragging a box moves the widget
// (snapping to a 40px grid), the corner dots resize it, "+" opens a list of your own entities to add. The rules for moving, resizing,
// aligning and adding live in ops.js; this file is the screen and the wiring.

import { PaneRenderer } from '/glass_panes/player/engine.js';
import { HassClient } from '/glass_panes/player/hass-client.js';
import { validZone } from '/glass_panes/player/widgets.js';
import { MockClient, mockBindings } from '/glass_panes/player/mock.js';
import { makeTime } from '/glass_panes/player/util.js';
import { CSS as PANEL_CSS } from '/glass_panes/panel/styles.js';
import * as ops from '/glass_panes/panel/ops.js';
import { THEMES, themeIsDark, paneBackground } from '/glass_panes/player/themes.js';
import { openCatalogue, CATALOGUE_CSS } from '/glass_panes/panel/catalogue.js';
import { iconField } from '/glass_panes/panel/icon-picker.js';
import { warningsEditor, asCheck } from '/glass_panes/panel/warnings-ui.js';
import { ruleSection, styleRulesSection, RULES_CSS, forceControl } from '/glass_panes/panel/rules-ui.js';          // "Show when" and the preview on/off controls
import { findRuleLoops, foldShowIf, usesRules } from '/glass_panes/player/conditions.js';

const PLAYER = '/glass_panes/player/index.html';
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- small helpers for building the screen

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

// simple line icons, drawn here so the panel needs nothing else
const ICONS = {
  plus: 'M12 5v14M5 12h14', front: 'M12 19V5M6 11l6-6 6 6', back: 'M12 5v14M6 13l6 6 6-6', x: 'M6 6l12 12M18 6L6 18', check: 'M5 13l4 4L19 7',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13', copy: 'M9 9h10v10H9zM5 15V5h10',
  left: 'M4 4v16M8 8h12M8 14h7', center: 'M12 4v16M6 8h12M8 14h8', right: 'M20 4v16M4 8h12M9 14h7',
  top: 'M4 4h16M8 8v12M14 8v7', middle: 'M4 12h16M8 6v12M14 8v8', bottom: 'M4 20h16M8 4v12M14 9v7',
  'distribute-h': 'M4 4v16M20 4v16M10 8h4v8h-4z', 'distribute-v': 'M4 4h16M4 20h16M8 10v4h8v-4z',
  'same-width': 'M3 5v14M21 5v14M7 9h10M7 15h10', 'same-height': 'M5 3h14M5 21h14M9 7v10M15 7v10',
  align: 'M4 6h16M4 12h10M4 18h16', contrast: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18', gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
};
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'i');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ''); svg.append(p);
  return svg;
}
const ALIGN_BUTTONS = [['left', 'Align left'], ['center', 'Align centres'], ['right', 'Align right'], ['top', 'Align top'], ['middle', 'Align middles'],
  ['bottom', 'Align bottom'], ['distribute-h', 'Space evenly across'], ['distribute-v', 'Space evenly down'], ['same-width', 'Same width'], ['same-height', 'Same height']];

// the bundled fonts must be registered on the page itself (not inside the panel's shadow root)
function ensureFonts() {
  if (document.getElementById('glass-panes-fonts')) return;
  document.head.appendChild(h('link', { id: 'glass-panes-fonts', rel: 'stylesheet', href: '/glass_panes/player/fonts.css' }));
}

const hasBinding = (b) => !!b && Object.values(b).some((v) => (Array.isArray(v) ? v.length : v));
// slots named when_... hold the entities of "show when" conditions, not data for the widget itself
const isWhenSlot = (slot) => slot.startsWith('when_');
const hasEntityBinding = (b) => !!b && Object.entries(b).some(([k, v]) => !isWhenSlot(k) && (Array.isArray(v) ? v.length : v));
const whenSlots = (b) => Object.fromEntries(Object.entries(b || {}).filter(([k]) => isWhenSlot(k)));
const DOMAIN_ORDER = ['calendar', 'weather', 'media_player', 'todo', 'person', 'light', 'sensor', 'event', 'input_number', 'number', 'binary_sensor', 'switch', 'climate', 'cover'];
const ELEMENT_INFO = {
  clock: 'The time', date: 'Today’s date', text: 'Any words you type', image: 'A picture from your device, or an image or camera entity', slideshow: 'Photos from a media folder, one after another', video: 'A looping video from your device',
  divider: 'A thin line between sections', icon: 'A symbol from the icon library', message: 'Friendly lines that rotate',
};
// How the display sits in the mirror in Mirror view. Estimated from two photos of a real Lululemon Studio Mirror, so approximate, not measured:
// a very thin frame, the display close to the edges at the top and sides, a longer strip of plain glass below it (the display is roughly
// four fifths of the glass height), and an open rounded loop stand under the glass about 17% as tall as the glass.
// Shares are of the display's own width / height. One place to adjust (later this can be a per-display setting).
const MIRROR_GLASS = { left: 0.03, right: 0.03, top: 0.03, bottom: 0.22 };
const MIRROR_STAND = 0.17;                      // the loop's height as a share of the glass height
const COLORS = ['fg', 'dim', 'faint', 'accent', 'good', 'warn', 'bad'];
const HEX6 = /^#[0-9a-fA-F]{6}$/;                 // a colour the browser's picker can show
// the fonts a text item can use: [value in the pane file, name shown]. Same list as the schema's style.font and engine.js FONTS.
const FONT_CHOICES = [['inter', 'Inter'], ['outfit', 'Outfit'], ['jost', 'Jost'], ['space-grotesk', 'Space Grotesk'], ['jetbrains-mono', 'JetBrains Mono'],
  ['cormorant-garamond', 'Cormorant Garamond (formal serif)'], ['playfair-display', 'Playfair Display (formal serif)'], ['lora', 'Lora (book serif)'],
  ['dm-serif-display', 'DM Serif Display (headlines)'], ['montserrat', 'Montserrat'], ['system-sans', 'System sans'], ['system-serif', 'System serif'], ['system-mono', 'System mono']];
// on/off choices per widget type: [option, label, default]
const TOGGLES = {
  clock: [['show_seconds', 'Show seconds', false]],
  calendar_agenda: [['show_all_day', 'All-day events', true]],
  now_playing: [['show_art', 'Album art', true], ['cd_case', 'CD case beside the disc (CD look)', true], ['burn_in_saver', 'Burn-in saver (very slow drift)', false]],
  people: [['show_avatar', 'Photos', true]],
  lights_summary: [['show_dots', 'Colour dots', true]],
  sports: [['show_logos', 'Team logos', true], ['show_next', 'Upcoming games', true], ['game_day_only', 'Only on game day', false], ['verbose_text', 'Spell out wins and losses', false], ['head_top', 'Headline above the logos (narrow columns)', false]],
  news: [['show_source', 'Source name', false]],
  entity_value: [['show_label', 'Name label', true]],
};

// pick-one choices per widget type: [option, label, [[value, words], ...], default]
const CHOICES = {
  clock: [['style', 'Look', [['digital', 'Digital numbers'], ['analog', 'Traditional clock face'], ['alarm', 'Alarm clock']], 'digital'],
    ['face', 'Clock face', [['light', 'Light face'], ['dark', 'Dark face']], 'light', (o) => o.style === 'analog' || o.style === 'alarm']],
  now_playing: [['style', 'Look', [['card', 'Card (album art and words)'], ['vinyl', 'Vinyl record with tonearm'], ['cd', 'CD']], 'card']],
};

class GlassPanesPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._narrow = false;
    this.client = new HassClient();
    this.state = { mirror: false, stand: true, media: [], panes: [], full: {}, displays: [], bindings: { bindings: {} }, registry: {}, pane: null, source: '', demo: null, tab: 'panes', newPane: false, newDisplay: false };
    this.mirrorState = {};            // per display: what the "Display settings" section last read from its mirror (see _mirrorSection)
    this.edit = null;                 // while editing: { pane, bindings, undo, redo, selected, dirty }
    this._started = false;
    this._scale = 0;
    // note: a custom element's constructor must not add attributes (Home Assistant creates it with createElement), so tabindex is set in connectedCallback
  }

  // ---------------------------------------------------------------- properties Home Assistant sets
  set hass(hass) {
    this._hass = hass;
    this.client.setHass(hass);
    if (!this._started) this._start();
    else {
      // an automation can change what a display shows at any time: redraw the header strip and the pane tags, but only when that really changed
      if (this._loaded && ops.showingSignature(this._showingNow()) !== this._showSig) {
        this._renderStrip(false);
        if (this.state.tab === 'panes') this._renderRail(false);
      }
      if (this.state.tab === 'displays') this._renderRail(false);   // keep each display's "showing" selector in step with its select entity
    }
  }

  set narrow(v) { this._narrow = v; if (this._menu) this._menu.narrow = v; }

  set panel(v) { this._panel = v; }

  set route(v) { this._route = v; }

  connectedCallback() {
    ensureFonts();
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;       // lets the panel receive keyboard shortcuts (Delete, arrows, undo)
    if (this._built) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>${PANEL_CSS}${RULES_CSS}${CATALOGUE_CSS}</style>
      <link rel="stylesheet" href="/glass_panes/player/player.css">
      <div class="app">
        <header class="top"><span id="menu"></span><div class="brand"><img class="logo-img" src="/glass_panes/player/logo-mark.png" alt=""><span class="brandname">Glass Panes</span></div><div class="showing" id="showing"></div><span class="spacer"></span><span id="status"></span><button class="btn sm" id="catalogbtn" title="See every kind of widget, with a preview and what to bind to it">Widgets</button><button class="btn sm" id="settingsbtn" title="Settings for your mirror: presence, brightness, speaker volume"></button><button class="btn sm" id="themebtn" title="Switch between the cream and dark look"></button></header>
        <div class="layout" id="layout">
          <aside class="rail">
            <div class="tabs"><button class="tab on" data-tab="panes">Panes</button><button class="tab" data-tab="displays">Displays</button></div>
            <div class="railbody" id="railbody"></div>
          </aside>
          <main>
            <div class="stagebar"><span class="title" id="title">Choose a pane</span><span id="source"></span><span id="fit"></span><div class="actions" id="actions"></div></div>
            <form class="details card" id="details">
              <label class="lbl" style="margin-top:0">Name</label><input class="field" id="dname" maxlength="80" required>
              <label class="lbl">Description</label><textarea class="field" id="ddesc" rows="2" maxlength="400" placeholder="What is this pane for? (optional)"></textarea>
              <div class="hint" style="margin:8px 0">Its id <code id="did"></code> never changes, so automations that use it keep working.</div>
              <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="dcancel">Cancel</button></div>
            </form>
            <div id="wrap"><div id="device"><div id="glass"><div id="preview"><div class="gp-stage" id="stage"></div><div id="overlay"></div></div><span class="caption">Dashed line: the display. Everything around it is plain mirror glass.</span></div><div class="stand"></div></div></div>
            <div id="notice"></div>
            <div class="dock" id="dock"></div>
          </main>
          <aside class="inspector" id="inspector"></aside>
          <div class="scrim" id="scrim"></div>
          <div class="drawer" id="drawer"></div>
        </div>
        <section class="settingspage" id="settingspage" aria-label="Settings"></section>
        <div id="toast"></div>
      </div>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this.$ = $;
    // Moss & Cream is the default; the moon button switches to the dark moss look and remembers the choice on this device
    let dark = false;
    try { dark = localStorage.getItem('glass_panes_dark') === '1'; } catch (e) { /* no storage: stay cream */ }
    const applyTheme = () => {
      this.classList.toggle('dark', dark);
      const b = $('themebtn');
      b.textContent = '';
      b.append(icon('contrast'), h('span', { class: 'btntext', text: dark ? 'Light mode' : 'Dark mode' }));      // says what a click will switch to
      b.title = dark ? 'Switch to the light look' : 'Switch to the dark look';
    };
    $('themebtn').addEventListener('click', () => { dark = !dark; applyTheme(); try { localStorage.setItem('glass_panes_dark', dark ? '1' : '0'); } catch (e) { /* ignore */ } });
    applyTheme();
    const settingsBtn = $('settingsbtn');
    settingsBtn.append(icon('gear'), h('span', { class: 'btntext', text: 'Settings' }));
    settingsBtn.setAttribute('aria-pressed', 'false');
    $('catalogbtn').addEventListener('click', () => this._openCatalogue());
    settingsBtn.addEventListener('click', () => { if (this.state.view === 'settings') this._closeSettings(); else this._openSettings(); });
    this.shadowRoot.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { this.state.tab = t.dataset.tab; this._renderRail(true); }));
    $('dcancel').addEventListener('click', () => { $('details').style.display = 'none'; });
    $('details').addEventListener('submit', (e) => { e.preventDefault(); this._saveDetails(); });
    $('scrim').addEventListener('click', () => this._closeDrawer());
    const overlay = $('overlay');
    overlay.addEventListener('pointerdown', (e) => this._pointerDown(e));
    overlay.addEventListener('pointermove', (e) => this._pointerMove(e));
    overlay.addEventListener('pointerup', (e) => this._pointerUp(e));
    overlay.addEventListener('pointercancel', (e) => this._pointerUp(e, true));
    this.addEventListener('keydown', (e) => this._keyDown(e));
    $('wrap').addEventListener('wheel', (e) => {            // Ctrl + wheel zooms the editor (only while editing)
      if (!e.ctrlKey || !this.edit) return;
      e.preventDefault(); this._setZoom((this._zoom || 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
    this._ro = new ResizeObserver(() => this._fitPreview());
    this._ro.observe($('wrap'));
    // the sidebar button on narrow screens, if this version of the frontend provides the element
    if (customElements.get('ha-menu-button')) {
      this._menu = document.createElement('ha-menu-button');
      this._menu.hass = this._hass;
      this._menu.narrow = this._narrow;
      $('menu').appendChild(this._menu);
    }
    if (this._hass && !this._started) this._start();
  }

  disconnectedCallback() {
    if (this._ro) this._ro.disconnect();
    if (this.renderer) this.renderer.clear();
    clearTimeout(this._fitTimer);
    clearInterval(this._syncTimer);
  }

  // ---------------------------------------------------------------- talking to the integration
  ws(msg) { return this._hass.callWS(msg); }

  toast(text, isError = false) {
    const t = this.$('toast');
    t.textContent = text;
    t.className = 'show' + (isError ? ' error' : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.className = ''; }, isError ? 7000 : 2600);
  }

  fail(e) { this.toast((e && (e.message || e.error || e.code)) || String(e), true); }

  async _start() {
    if (this._started || !this._built) return;
    this._started = true;
    if (this._menu) this._menu.hass = this._hass;
    this.time = makeTime((this._hass.config && this._hass.config.time_zone) || undefined);
    this.mock = new MockClient(this.time);
    this.mock.mediaUrl = (id) => this.client.mediaUrl(id);       // uploaded files are real even when the rest of a preview is made-up
    this.renderer = new PaneRenderer({
      stage: this.$('stage'), client: this.client, time: this.time, onError: (w, e) => console.warn('[glass_panes]', w, e),
      pick: (w, slots) => this._clientFor(w, slots),
    });
    this.client.onChange((id) => this.renderer.notify(id));       // live values: a changed entity refreshes the widgets showing it
    try {
      await this._reload();
      const first = this.state.panes.find((p) => p.id === 'mirror') || this.state.panes[0];
      if (first) await this._select(first.id);
    } catch (e) {
      this.toast('Could not load Glass Panes: ' + (e.message || e), true);
    }
  }

  async _reload() {
    const [panes, displays, bindings, widgets] = await Promise.all([
      this.ws({ type: 'glass_panes/panes/list' }),
      this.ws({ type: 'glass_panes/displays/list' }),
      this.ws({ type: 'glass_panes/bindings/get' }),
      this.ws({ type: 'glass_panes/widgets/list' }),
    ]);
    this.state.panes = panes.panes;
    this.state.displays = displays.displays;
    this.state.bindings = bindings;
    this.state.registry = widgets.widgets;
    try { this.state.media = (await this.ws({ type: 'glass_panes/media/list' })).media; } catch (e) { this.state.media = []; }
    // the full layout of every pane draws the little wireframes in the list
    const full = {};
    await Promise.all(this.state.panes.map(async (p) => {
      try { full[p.id] = (await this.ws({ type: 'glass_panes/panes/get', pane_id: p.id })).pane; } catch (e) { /* no thumbnail */ }
    }));
    this.state.full = full;
    this._loaded = true;
    this._renderStrip(true);
    this._renderRail(true);
  }

  // ---------------------------------------------------------------- the left rail
  _renderRail(force) {
    const body = this.$('railbody');
    if (!body) return;
    const focused = this.shadowRoot.activeElement;
    if (!force && focused && /^(SELECT|INPUT|TEXTAREA)$/.test(focused.tagName)) return;     // do not rebuild under the user's hand
    this.shadowRoot.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === this.state.tab));
    body.textContent = '';
    if (this.state.tab === 'panes') this._renderPanesTab(body); else this._renderDisplaysTab(body);
    if (this.state.view === 'settings') this._renderSettings();          // the mirror part of the Settings page shares these refreshes
  }

  // ---------------------------------------------------------------- what each display is showing: a strip in the header (every tab) and tags on the pane cards
  _showingNow() { return ops.showingNow(this.state.displays, this._hass && this._hass.states, this.state.panes); }

  // one chip per display, "Name: pane v". Choosing a pane goes through the same path as the Showing choice on the Displays tab.
  _renderStrip(force) {
    const box = this.$('showing');
    if (!box) return;
    const focused = this.shadowRoot.activeElement;
    if (!force && focused && box.contains(focused)) return;            // do not rebuild under the user's hand
    const showing = this._showingNow();
    this._showSig = ops.showingSignature(showing);
    box.textContent = '';
    if (!showing.length) {
      box.append(h('button', { class: 'chip addchip', title: 'A display is any screen that shows panes', onClick: () => { this.state.tab = 'displays'; this._renderRail(true); } }, icon('plus'), 'Add a display'));
      return;
    }
    showing.forEach((s) => {
      const options = this.state.panes.map((p) => h('option', { value: p.id, selected: p.id === s.pane, text: p.name }));
      if (!s.known) options.push(h('option', { value: s.pane || '', selected: true, text: s.pane || '(nothing yet)' }));   // a pane that is not in the list
      const sel = h('select', { 'aria-label': 'What ' + s.name + ' is showing', onChange: () => this._setDisplayPane(s.id, sel.value) }, options);
      box.append(h('label', { class: 'chip', 'data-display': s.id, title: s.name + ' is showing ' + s.paneName }, h('span', { class: 'cname', text: s.name + ':' }), sel));
    });
  }

  // from a "Showing on ..." tag: open the Displays tab and point at that display's card
  _goDisplay(id) {
    this.state.tab = 'displays';
    this._renderRail(true);
    const card = this.shadowRoot.querySelector('.card[data-display="' + String(id).replace(/"/g, '') + '"]');
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1800);
    }
  }

  _thumb(pane) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 1080 1920'); svg.setAttribute('preserveAspectRatio', 'none');
    const add = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); };
    add('rect', { width: 1080, height: 1920, fill: paneBackground(pane) });
    ((pane && pane.widgets) || []).forEach((w) => {
      if (w.type === 'video') add('rect', { x: w.x, y: w.y, width: w.w, height: w.h, fill: '#ffffff22' });
      else add('rect', { x: w.x, y: w.y, width: w.w, height: Math.max(w.h, 24), rx: 14, fill: w.type === 'divider' ? '#ffffff55' : '#ffffffaa', opacity: w.type === 'divider' ? 1 : 0.55 });
    });
    return svg;
  }

  _renderPanesTab(body) {
    const showing = this._showingNow();
    this.state.panes.forEach((p) => {
      const label = p.source === 'user' ? (p.customized ? 'edited' : 'mine') : 'built in';
      const text = h('div', { class: 'grow' }, h('div', { class: 'name', text: p.name }), h('div', { class: 'sub desc', text: p.description || p.widgets + ' items' }));
      const on = ops.showingOn(p.id, showing);
      if (on.length) {      // a tag for every display that is showing this pane; clicking one jumps to that display
        text.append(h('div', { class: 'showtags' }, on.map((s) => h('button', { class: 'showtag', title: 'Open ' + s.name + ' in Displays', onClick: (e) => { e.stopPropagation(); this._goDisplay(s.id); } }, 'Showing on ' + s.name))));
      }
      const row = h('div', { class: 'pane' + (this.state.pane && this.state.pane.id === p.id ? ' on' : ''), onClick: () => this._guardedSelect(p.id) },
        h('div', { class: 'thumb' }, this._thumb(this.state.full[p.id])),
        text,
        h('span', { class: 'tag' + (p.source === 'user' ? ' mine' : ''), text: label }));
      body.append(row);
    });
    if (!this.state.newPane) {
      const picker = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onChange: () => { const f = picker.files && picker.files[0]; picker.value = ''; this._importPane(f); } });
      body.append(h('div', { class: 'row newpane' },
        h('button', { class: 'btn grow', onClick: () => { this.state.newPane = true; this._renderRail(true); } }, icon('plus'), 'New pane'),
        h('button', { class: 'btn', title: 'Add a pane someone shared as a file', onClick: () => picker.click() }, 'Import…'), picker));
      return;
    }
    const name = h('input', { class: 'field', placeholder: 'Pane name, e.g. Movie night', maxlength: 80, required: true });
    const from = h('select', { class: 'field' }, h('option', { value: '', text: 'Start blank' }), this.state.panes.map((p) => h('option', { value: p.id, text: 'Copy of ' + p.name })));
    body.append(h('form', { class: 'card newpane', onSubmit: (e) => { e.preventDefault(); this._addPane(name.value, from.value); } },
      name, h('div', { style: 'height:8px' }), from, h('div', { style: 'height:10px' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Create' }),
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => { this.state.newPane = false; this._renderRail(true); } }))));
    setTimeout(() => name.focus(), 0);
  }

  _renderDisplaysTab(body) {
    if (!this.state.displays.length) {
      body.append(h('div', { class: 'card', id: 'welcome' },
        h('h3', { style: 'margin:0 0 6px', text: 'Add your first display' }),
        h('div', { class: 'hint', text: 'A display is any screen that shows panes: a smart mirror, a tablet, a wall panel, even a laptop browser.' }),
        h('ol', { class: 'steps' },
          h('li', { text: 'Give it a name below and press Add display.' }),
          h('li', { text: 'Press Set up login on its card. You get a link, shown once.' }),
          h('li', { text: 'Open that link on the display. It signs itself in and shows a pane.' }),
          h('li', { text: 'Choose what it shows here, or switch it from an automation.' }))));
    }
    this.state.displays.forEach((d) => {
      // what the display is showing right now comes from its select entity when there is one (automations change it)
      const live = d.entity_id && this._hass && this._hass.states[d.entity_id];
      const showing = live && live.state && live.state !== 'unknown' ? live.state : d.pane;
      const sel = h('select', { class: 'field', onChange: () => this._setDisplayPane(d.id, sel.value) },
        this.state.panes.map((p) => h('option', { value: p.id, selected: p.id === showing, text: p.name })));
      body.append(h('div', { class: 'card', 'data-display': d.id },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: d.name }), h('div', { class: 'sub', text: d.entity_id || d.id })),
          h('button', { class: 'btn sm ghost danger', title: 'Remove this display', onClick: () => this._removeDisplay(d) }, icon('trash'))),
        h('label', { class: 'lbl', text: 'Showing' }), sel,
        this._displayZoneField(d),
        this._pairBox(d),
        h('label', { class: 'lbl', text: 'Sign-in' }),
        d.has_login
          ? h('div', { class: 'row' }, h('span', { class: 'pill good' }, h('span', { class: 'dot' }), 'Login set up'),
              h('button', { class: 'btn sm', onClick: () => this._makeLogin(d, true) }, 'Replace…'),
              h('button', { class: 'btn sm danger', onClick: () => this._revokeLogin(d) }, 'Revoke'))
          : h('div', {}, h('button', { class: 'btn sm primary', onClick: () => this._makeLogin(d, false) }, 'Set up login…'),
              h('div', { class: 'hint', style: 'margin-top:6px', text: 'Lets this display read your data without you pasting a token.' })),
        h('div', { style: 'margin-top:12px' },
          h('button', { class: 'btn sm', 'data-settings': 'open', onClick: () => this._openSettings(d.id) }, icon('gear'), 'Mirror settings…'),
          h('div', { class: 'hint', style: 'margin-top:6px', text: 'Presence, brightness, speaker volume and memory live on the Settings page now (the gear at the top).' })),
        h('div', { style: 'margin-top:10px' }, h('a', { href: PLAYER + '?display=' + encodeURIComponent(d.id), target: '_blank', rel: 'noopener', text: 'Open this display’s player' }))));
    });
    if (!this.state.newDisplay && this.state.displays.length) {
      body.append(h('button', { class: 'btn newpane', onClick: () => { this.state.newDisplay = true; this._renderRail(true); } }, icon('plus'), 'Add display'));
      return;
    }
    const name = h('input', { class: 'field', placeholder: 'Display name, e.g. Kitchen tablet', maxlength: 80, required: true });
    const tz = h('input', { class: 'field', placeholder: 'Time zone (optional: empty follows Home Assistant' + (this._hass.config && this._hass.config.time_zone ? ', ' + this._hass.config.time_zone : '') + ')' });
    body.append(h('form', { class: 'card newpane', onSubmit: (e) => { e.preventDefault(); this._addDisplay(name.value, tz.value); } },
      name, h('div', { style: 'height:8px' }), tz, h('div', { style: 'height:10px' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Add display' }),
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => { this.state.newDisplay = false; this._renderRail(true); } }))));
    setTimeout(() => name.focus(), 0);
  }

  // ---------------------------------------------------------------- Display settings (a display that has a mirror app behind it)
  // Home Assistant talks to the mirror for us (glass_panes/mirror/... commands, administrators only). This page never calls the mirror
  // itself and never sees its key: the key is typed once into the form and sent to Home Assistant, which only ever says "a key is saved".
  // Everything shown here was read from the mirror; nothing is estimated.

  _mirrorSt(id) {
    return (this.mirrorState[id] = this.mirrorState[id] || { status: null, error: '', busy: false, draft: null, connecting: false, result: null, measuring: false, requested: false });
  }

  _timeText(iso) { const t = new Date(iso); return isNaN(t) ? '' : t.toLocaleTimeString(); }

  /** Calls one mirror command. A mirror that cannot be reached comes back as ok:false with a reason, which is shown on the card. */
  async _mirrorCall(d, msg, { quiet = false } = {}) {
    const st = this._mirrorSt(d.id);
    st.busy = true;
    try {
      const r = await this.ws({ display_id: d.id, ...msg });
      if (r && r.ok === false) { st.error = r.error || 'The mirror did not accept that.'; if (!quiet) this.toast(st.error, true); } else st.error = '';
      return r;
    } catch (e) {
      st.error = (e && (e.message || e.error)) || String(e);
      this.toast(st.error, true);
      return null;
    } finally { st.busy = false; }
  }

  async _mirrorRefresh(d) {
    const st = this._mirrorSt(d.id);
    const r = await this._mirrorCall(d, { type: 'glass_panes/mirror/status' }, { quiet: true });
    if (r && r.ok) { st.status = r; st.draft = null; }
    this._renderRail(true);
  }

  async _mirrorAct(d, msg, doneText) {
    const r = await this._mirrorCall(d, msg);
    if (r && r.ok !== false && doneText) this.toast(doneText);
    await this._mirrorRefresh(d);
  }

  async _mirrorConnect(d, endpoint, key, clearKey) {
    const st = this._mirrorSt(d.id);
    const msg = { type: 'glass_panes/mirror/connect', display_id: d.id, endpoint: endpoint.trim() };
    if (key) msg.key = key;
    if (clearKey) msg.clear_key = true;
    try {
      await this.ws(msg);
      Object.assign(st, { connecting: false, requested: false, status: null, error: '', result: null, draft: null });
      this.toast(endpoint.trim() ? 'Mirror saved' : 'Mirror removed');
      await this._reload();
    } catch (e) { this.fail(e); }
  }

  _mirrorForm(d, st) {
    const known = st.status && st.status.endpoint ? st.status.endpoint : '';
    const endpoint = h('input', { class: 'field', placeholder: 'Mirror address, e.g. mirror.local:8099', value: known, autocomplete: 'off', 'data-mirror': 'endpoint' });
    const key = h('input', { class: 'field', type: 'password', placeholder: d.key_set ? 'A key is saved. Type a new one to replace it' : 'Key (only if you set one on the mirror)', autocomplete: 'off', 'data-mirror': 'key' });
    const clear = h('input', { type: 'checkbox' });
    return h('form', { class: 'mirrorform', onSubmit: (e) => { e.preventDefault(); this._mirrorConnect(d, endpoint.value, key.value, clear.checked); } },
      endpoint, h('div', { style: 'height:8px' }), key,
      d.key_set ? h('label', { class: 'hint', style: 'display:block;margin-top:6px' }, clear, ' Remove the saved key') : null,
      h('div', { class: 'hint', style: 'margin:6px 0 10px', text: 'Just the host and port of the mirror app (port 8099 if you leave it out). Home Assistant talks to the mirror for you, so this page never sees the key. The key is only saved, never shown again.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Save' }),
        d.has_mirror ? h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => { st.connecting = false; this._renderRail(true); } }) : null,
        d.has_mirror ? h('button', { class: 'btn danger', type: 'button', text: 'Disconnect', onClick: () => { if (confirm('Forget the mirror address and key for "' + d.name + '"?')) this._mirrorConnect(d, '', '', true); } }) : null));
  }

  _mirrorSection(d) {
    const st = this._mirrorSt(d.id);
    const box = h('div', { class: 'mirrorbox', 'data-display': d.id }, h('label', { class: 'lbl', text: 'Display settings' }));
    if (!d.has_mirror || st.connecting) {
      if (!d.has_mirror && !st.connecting) {
        box.append(h('div', { class: 'hint', text: 'If a Mirror Kiosk app runs behind this display, connect it to see its status, switch presence on or off, and see what it costs in memory.' }),
          h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm', onClick: () => { st.connecting = true; this._renderRail(true); } }, 'Connect a mirror…')));
      } else box.append(this._mirrorForm(d, st));
      return box;
    }
    if (!st.requested) { st.requested = true; this._mirrorRefresh(d); }
    const s = st.status;
    if (st.error) box.append(h('div', { class: 'warnbox poor', 'data-mirror': 'error', text: st.error }));
    if (!s) {
      box.append(h('div', { class: 'row', style: 'margin-top:6px' }, h('div', { class: 'hint grow', text: st.busy ? 'Asking the mirror…' : 'No reading yet.' }),
        h('button', { class: 'btn sm', disabled: st.busy, onClick: () => this._mirrorRefresh(d) }, 'Try again')));
    } else {
      const settings = s.presence.settings;
      const on = settings.enabled;
      box.append(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin-top:6px' },
        h('span', { class: 'pill ' + (s.page_ok ? 'good' : 'bad'), text: s.page_ok ? 'Page loaded' : 'Page not loaded' }),
        h('span', { class: 'pill ' + (on ? 'on' : ''), text: 'Presence ' + (on ? 'on' : 'off') + (s.presence.state ? ' (' + s.presence.state + ')' : '') }),
        s.presence.present != null ? h('span', { class: 'pill', text: s.presence.present ? 'Someone is there' : 'Nobody there' }) : null,
        h('button', { class: 'btn sm ghost', title: 'Read the mirror again', onClick: () => this._mirrorRefresh(d) }, 'Refresh')),
        h('div', { class: 'hint', text: 'Last report to Home Assistant: ' + (s.presence.last_report || 'none') + '. Read at ' + this._timeText(s.measured_at) + (s.version ? ' (app ' + s.version + ')' : '') }));
      // presence on/off
      const sw = h('input', { type: 'checkbox', 'data-mirror': 'presence', checked: !!on, disabled: st.busy || st.measuring, onChange: () => this._mirrorAct(d, { type: 'glass_panes/mirror/presence', enabled: sw.checked }, 'Presence ' + (sw.checked ? 'on' : 'off')) });
      box.append(h('div', { style: 'margin-top:10px' }, h('label', { class: 'switch', style: 'padding:0' }, sw, 'Presence detection (the camera notices movement; no pictures are kept)')));
      // presence settings
      const draft = st.draft = st.draft || { scans: settings.scans_per_min, hold: settings.hold_s, thr: settings.threshold, report: settings.report_interval_s, vscans: settings.video_scans_per_min, fps: settings.preview_fps };
      const field = (key, label, lo, hi, help) => {
        const input = h('input', { class: 'field', type: 'number', min: lo, max: hi, step: 1, value: draft[key] == null ? '' : draft[key], 'data-mirror': key, onInput: () => { draft[key] = input.value === '' ? null : Number(input.value); } });
        return h('div', {}, h('label', { class: 'lbl', text: label + ' (' + lo + ' to ' + hi + ')' }), input, h('div', { class: 'hint', text: help }));
      };
      box.append(h('div', { class: 'mirrorsettings' },
        field('scans', 'Looks per minute', 1, 240, 'How often the camera checks for movement. More is quicker to notice you but uses more of the mirror.'),
        field('hold', 'Seconds to stay present', 5, 600, 'How long after the last movement it still says someone is there.'),
        field('thr', 'Sensitivity', 2, 60, 'How big a change counts as movement. Lower notices smaller movement.'),
        field('report', 'Seconds between reports', 10, 3600, 'How often it tells Home Assistant it is still there.'),
        h('details', {}, h('summary', { class: 'hint', text: 'More settings' }),
          field('vscans', 'Looks per minute while a video plays', 1, 240, 'The mirror is tightest on memory while playing video.'),
          field('fps', 'Camera frame rate', 0, 30, '0 means the slowest the camera offers.'))));
      box.append(h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm primary', 'data-mirror': 'apply', disabled: st.busy,
        onClick: () => { const v = {}; for (const [k, x] of Object.entries(draft)) if (x != null) v[k] = x; this._mirrorAct(d, { type: 'glass_panes/mirror/tune', ...v }, 'Presence settings saved'); } }, 'Apply settings')));
      // brightness
      const level = s.brightness != null && s.brightness >= 0 ? s.brightness : 50;
      const out = h('span', { class: 'hint', text: level + '%' });
      const slider = h('input', { type: 'range', min: 0, max: 100, value: level, 'data-mirror': 'brightness', style: 'width:100%', onInput: () => { out.textContent = slider.value + '%'; }, onChange: () => this._mirrorAct(d, { type: 'glass_panes/mirror/brightness', level: Number(slider.value) }, 'Brightness set') });
      box.append(h('label', { class: 'lbl', text: 'Brightness' }), h('div', { class: 'row' }, slider, out));
      // memory: only what the mirror measured
      const m = s.memory;
      const mb = (v) => (v == null ? 'not reported' : v + ' MB');
      box.append(h('label', { class: 'lbl', text: 'Memory (measured on the mirror at ' + this._timeText(s.measured_at) + ')' }),
        h('div', { class: 'memtable' },
          ...[['Total', mb(m.total_mb)], ['Available to apps', mb(m.available_mb)], ['Used by the mirror app', mb(m.app_total_pss_mb)],
            ['Android calls it low below', mb(m.threshold_mb)], ['Android says low on memory', m.low_memory == null ? 'not reported' : (m.low_memory ? 'yes' : 'no')]]
            .map(([k, v]) => h('div', { class: 'row' }, h('div', { class: 'grow', text: k }), h('div', { text: v })))),
        h('div', { class: 'warnbox' + (s.verdict.level === 'low' ? ' poor' : ''), 'data-mirror': 'verdict', text: s.verdict.text }));
      // what presence costs
      box.append(h('label', { class: 'lbl', text: 'What presence costs' }));
      if (st.result) {
        box.append(h('div', { class: 'warnbox', 'data-mirror': 'cost', text: st.result.difference.text }),
          h('div', { class: 'hint', text: 'Presence on, read at ' + this._timeText(st.result.before.measured_at) + '. Presence off, read at ' + this._timeText(st.result.after.measured_at) + '.' }));
      } else box.append(h('div', { class: 'hint', text: 'Not measured yet. The button switches presence off for about 20 seconds, reads the memory before and after, and switches it back on.' }));
      box.append(h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm', 'data-mirror': 'measure', disabled: st.busy || st.measuring || !on, title: on ? '' : 'Presence is off. Turn it on first.', onClick: () => this._mirrorMeasureDialog(d) },
        st.measuring ? 'Measuring… (about half a minute)' : 'Measure what presence costs…')));
    }
    box.append(h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn sm ghost', onClick: () => { st.connecting = true; this._renderRail(true); } }, 'Change connection…'),
      h('span', { class: 'hint', text: d.key_set ? 'A key is saved (never shown).' : 'No key saved.' })));
    return box;
  }

  /**
   * The table's columns: each says what to show for every row (the row's entity name, its state, one attribute, or fixed words), how to
   * format it, and, optionally, colours by value. Every change is one undoable step through _patch.
   */
  _tableColumns(box, w) {
    const cols = (w.options && w.options.columns) || [];
    const change = (fn) => this._patch(w.id, (x) => { x.options = JSON.parse(JSON.stringify(x.options || {})); x.options.columns = x.options.columns || []; fn(x.options); });
    box.append(h('label', { class: 'lbl', text: 'Columns' }),
      h('div', { class: 'hint', text: 'Each entity you bind below is one row. Each column shows something about the row’s entity.' }));
    const SOURCES = [['name', 'Its name'], ['state', 'Its state'], ['attribute', 'One attribute'], ['text', 'Fixed words']];
    const FORMATS = [['auto', 'As is'], ['time', 'Time'], ['date', 'Date'], ['datetime', 'Date and time'], ['relative', 'Relative (in 5 min)'], ['duration', 'Duration (1 h 15 min)'], ['number', 'Number'], ['raw', 'Exactly as stored']];
    cols.forEach((c, i) => {
      const card = h('div', { class: 'rulecard', 'data-column': i + 1 });
      const set = (key, value) => change((o) => { if (value === '' || value == null) delete o.columns[i][key]; else o.columns[i][key] = value; });
      card.append(h('div', { class: 'row' },
        h('input', { class: 'field', style: 'flex:1', 'data-field': 'header', type: 'text', maxlength: 40, placeholder: 'Column title (optional)', value: c.header || '', onChange: (ev) => set('header', ev.target.value.trim()) }),
        h('button', { class: 'btn sm ghost', title: 'Move left', disabled: i === 0, onClick: () => change((o) => { const [m] = o.columns.splice(i, 1); o.columns.splice(i - 1, 0, m); }) }, '\u2190'),
        h('button', { class: 'btn sm ghost', title: 'Move right', disabled: i === cols.length - 1, onClick: () => change((o) => { const [m] = o.columns.splice(i, 1); o.columns.splice(i + 1, 0, m); }) }, '\u2192'),
        h('button', { class: 'btn sm ghost danger', title: 'Remove this column', disabled: cols.length < 2, onClick: () => change((o) => { o.columns.splice(i, 1); }) }, icon('x'))));
      card.append(h('select', { class: 'field', 'data-field': 'source', onChange: (ev) => change((o) => {
        const col = o.columns[i]; col.source = ev.target.value;
        if (col.source !== 'attribute') delete col.attribute;
        if (col.source !== 'text') delete col.text;
        if (col.source === 'attribute' && !col.attribute) col.attribute = 'value';
        if (col.source === 'text' && !col.text) col.text = 'text';
        if (col.source === 'name' || col.source === 'text') { delete col.format; delete col.decimals; delete col.unit; delete col.duration_unit; }
      }) }, SOURCES.map(([v, t]) => h('option', { value: v, selected: c.source === v, text: t }))));
      if (c.source === 'attribute') card.append(h('input', { class: 'field', 'data-field': 'attribute', type: 'text', maxlength: 64, spellcheck: false, placeholder: 'Attribute name, like leave_by', value: c.attribute || '',
        onChange: (ev) => { const v = ev.target.value.trim().toLowerCase(); if (/^[a-z0-9_]{1,64}$/.test(v)) set('attribute', v); else this.toast('An attribute name uses lower case letters, digits and _ only.', true); } }));
      if (c.source === 'text') card.append(h('input', { class: 'field', 'data-field': 'text', type: 'text', maxlength: 80, placeholder: 'Words shown in every row', value: c.text || '', onChange: (ev) => set('text', ev.target.value.trim()) }));
      if (c.source === 'state' || c.source === 'attribute') {
        card.append(h('div', { class: 'grid2' },
          h('select', { class: 'field', 'data-field': 'format', title: 'How the value is shown', onChange: (ev) => set('format', ev.target.value === 'auto' ? '' : ev.target.value) }, FORMATS.map(([v, t]) => h('option', { value: v, selected: (c.format || 'auto') === v, text: t }))),
          h('select', { class: 'field', 'data-field': 'align', title: 'Alignment', onChange: (ev) => set('align', ev.target.value === 'left' ? '' : ev.target.value) }, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([v, t]) => h('option', { value: v, selected: (c.align || 'left') === v, text: t }))),
          h('input', { class: 'field', 'data-field': 'decimals', type: 'number', min: 0, max: 6, placeholder: 'Decimals', value: c.decimals != null ? c.decimals : '', onChange: (ev) => { const n = parseInt(ev.target.value, 10); set('decimals', Number.isFinite(n) ? Math.max(0, Math.min(6, n)) : ''); } }),
          h('input', { class: 'field', 'data-field': 'unit', type: 'text', maxlength: 20, placeholder: 'Unit', value: c.unit || '', onChange: (ev) => set('unit', ev.target.value.trim()) })));
        if (c.format === 'duration') card.append(h('select', { class: 'field', 'data-field': 'duration_unit', title: 'What the number counts', onChange: (ev) => set('duration_unit', ev.target.value === 'minutes' ? '' : ev.target.value) },
          [['minutes', 'The number is minutes'], ['seconds', 'The number is seconds'], ['hours', 'The number is hours']].map(([v, t]) => h('option', { value: v, selected: (c.duration_unit || 'minutes') === v, text: t }))));
      }
      if (c.source === 'state' || c.source === 'attribute') {
        const sec = styleRulesSection({ h, icon, w: { ...w, options: { columns: cols } }, noEntityHint: true, title: 'Colours by value (this column)', owner: (x) => x.options.columns[i],
          edit: (fn) => change((o) => { fn({ options: o }); }), styleOpen: this._styleOpen === w.id + ':' + i, setStyleOpen: (on) => { this._styleOpen = on ? w.id + ':' + i : null; } }, true);
        if (sec) card.append(sec);
      }
      box.append(card);
    });
    if (cols.length < 8) box.append(h('button', { class: 'btn sm', 'data-field': 'add-column', onClick: () => change((o) => { o.columns.push({ source: 'state' }); }) }, icon('plus'), 'Add a column'));
    box.append(h('label', { class: 'check', style: 'margin-top:8px' }, h('input', { type: 'checkbox', 'data-field': 'show-header', checked: (w.options || {}).show_header !== false,
      onChange: (ev) => change((o) => { if (ev.target.checked) delete o.show_header; else o.show_header = false; }) }), 'Show the column titles'));
  }

  // ---------------------------------------------------------------- reusable widget groups
  /** "Save these as a group": a name and a button. The group keeps the widgets, their look and what they are bound to. */
  _saveGroupBox() {
    const name = h('input', { class: 'field', 'data-field': 'group-name', type: 'text', maxlength: 80, placeholder: 'Group name, like Trips table' });
    return h('div', { style: 'margin-top:14px' }, h('label', { class: 'lbl', text: 'Reuse these' }), name,
      h('button', { class: 'btn sm', style: 'margin-top:6px', 'data-field': 'group-save', onClick: () => this._saveGroup(name.value) }, icon('plus'), 'Save as a group'),
      h('div', { class: 'hint', text: 'Find it again under Add, Groups. Links to widgets outside the group are left out.' }));
  }

  async _saveGroup(name) {
    name = name.trim();
    if (!name) { this.toast('Give the group a name first.', true); return; }
    const made = ops.groupFrom(this.edit.pane.widgets, this.edit.selected, this.edit.bindings);
    if (!made) return;
    try {
      const r = await this.ws({ type: 'glass_panes/groups/save', name, widgets: made.widgets, bindings: made.bindings });
      this.state.groups = r.groups;
      this.toast('Saved the group “' + name + '”');
      this._renderInspector();
    } catch (e) { this.fail(e); }
  }

  async _loadGroups() {
    try { this.state.groups = (await this.ws({ type: 'glass_panes/groups/list' })).groups; } catch (e) { this.state.groups = this.state.groups || []; }
    if (this._drawer) this._renderDrawerList();
  }

  _dropGroup(group) {
    const pane = clone(this.edit.pane), bindings = clone(this.edit.bindings);
    const placed = ops.groupDrop(group, pane.widgets, this._grid());
    if (pane.widgets.length + placed.widgets.length > 64) { this.toast('A pane holds at most 64 widgets.', true); return; }
    pane.widgets.push(...placed.widgets);
    Object.assign(bindings, placed.bindings);
    this.edit.selected = placed.ids;
    this._commit(pane, bindings);
    this._closeDrawer();
    this.toast('Added the group “' + group.name + '”');
  }

  async _deleteGroup(group) {
    try { this.state.groups = (await this.ws({ type: 'glass_panes/groups/delete', group_id: group.id })).groups; this._renderDrawerList(); } catch (e) { this.fail(e); }
  }

  /** The widget catalogue over the builder. While editing, each card can add its widget to the pane. */
  _openCatalogue() {
    if (this._closeCatalogue) this._closeCatalogue();
    this._closeCatalogue = openCatalogue({
      h, icon, root: this.shadowRoot, registry: this.state.registry, time: this.time,
      onAdd: this.edit ? (type, label) => this._addWidget(type, label) : null,
    });
  }

  // ---------------------------------------------------------------- the Settings page (the gear next to Dark mode)
  // A page of its own, one card per part of the mirror: the speaker, then everything Display settings used to show inside the
  // Displays tab (presence, brightness, memory, the address), then what is planned but not built yet. It uses the same mirror
  // commands as before; nothing here reaches the mirror except through Home Assistant.

  _openSettings(displayId) {
    this.state.view = 'settings';
    if (displayId) this.state.settingsDisplay = displayId;
    this.classList.add('insettings');
    const b = this.$('settingsbtn');
    if (b) b.setAttribute('aria-pressed', 'true');
    this._renderSettings();
  }

  _closeSettings() {
    this.state.view = 'main';
    this.classList.remove('insettings');
    const b = this.$('settingsbtn');
    if (b) b.setAttribute('aria-pressed', 'false');
  }

  /** The speaker: ask the mirror's player what it is doing, or tell it (pause, resume, stop, volume). Its own errors, so a speaker that is
   *  too old for audio never spoils the presence part of the page. */
  async _audioCall(d, msg, { quiet = false } = {}) {
    const st = this._mirrorSt(d.id);
    try {
      const r = await this.ws({ type: 'glass_panes/mirror/audio', display_id: d.id, ...msg });
      st.audioError = r && r.ok === false ? (r.error || 'The speaker did not accept that.') : '';
      if (r && r.audio) st.audio = r.audio;
    } catch (e) {
      st.audioError = (e && (e.message || e.error)) || String(e);
      if (!quiet) this.toast(st.audioError, true);
    }
    this._renderSettings();
  }

  async _audioAct(d, msg) {
    await this._audioCall(d, msg);
    await this._audioCall(d, { action: 'status' }, { quiet: true });      // an action only says "ok", so read the player again
  }

  _speakerCard(d) {
    const st = this._mirrorSt(d.id);
    const card = h('div', { class: 'card', 'data-settings': 'speaker' }, h('h3', { text: 'Speaker' }));
    if (!d.has_mirror) {
      card.append(h('div', { class: 'hint', text: 'Connect the mirror first (the Display settings card below). Then its speaker shows here, and Home Assistant gets a media player for it that Music Assistant can use.' }));
      return card;
    }
    if (!st.audioRequested) { st.audioRequested = true; this._audioCall(d, { action: 'status' }, { quiet: true }); }
    const a = st.audio;
    const word = a ? ({ idle: 'Idle', playing: 'Playing', paused: 'Paused', error: 'Problem' }[a.state] || a.state) : (st.audioError ? 'Unavailable' : 'Reading…');
    card.append(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
      h('span', { class: 'pill ' + (a && a.state === 'playing' ? 'on' : (st.audioError ? 'bad' : '')), 'data-settings': 'speaker-state', text: word }),
      a && (a.title || a.artist) ? h('span', { class: 'hint grow', text: [a.title, a.artist].filter(Boolean).join(' · ') }) : null));
    if (st.audioError) card.append(h('div', { class: 'warnbox poor', 'data-settings': 'speaker-error', text: st.audioError }));
    const level = a && a.volume != null ? a.volume : 50;
    const out = h('span', { class: 'hint', 'data-settings': 'volume-out', text: level + '%' });
    const slider = h('input', { type: 'range', class: 'vol', min: 0, max: 100, step: 1, value: level, 'data-settings': 'volume',
      disabled: !a, title: 'Speaker volume', onInput: () => { out.textContent = slider.value + '%'; },
      onChange: () => this._audioAct(d, { action: 'volume', level: Number(slider.value) }) });
    card.append(h('label', { class: 'lbl', text: 'Volume' }), h('div', { class: 'row' }, slider, out));
    const playing = a && a.state === 'playing', paused = a && a.state === 'paused';
    card.append(h('div', { class: 'row', style: 'margin-top:8px;gap:6px' },
      playing ? h('button', { class: 'btn sm', 'data-settings': 'pause', onClick: () => this._audioAct(d, { action: 'pause' }) }, 'Pause') : null,
      paused ? h('button', { class: 'btn sm', 'data-settings': 'resume', onClick: () => this._audioAct(d, { action: 'resume' }) }, 'Resume') : null,
      playing || paused ? h('button', { class: 'btn sm', 'data-settings': 'stop', onClick: () => this._audioAct(d, { action: 'stop' }) }, 'Stop') : null,
      h('button', { class: 'btn sm ghost', title: 'Read the speaker again', onClick: () => this._audioCall(d, { action: 'status' }) }, 'Refresh')));
    card.append(h('div', { class: 'hint', style: 'margin-top:8px', text: 'To play music, send it to this display’s speaker from Home Assistant (a media player named after the display). Music Assistant can use it once Music Assistant’s Home Assistant players option is on.' }));
    return card;
  }

  /** What is planned and not built: shown so it is not a surprise later, with nothing to switch on yet. */
  _futureCard() {
    const row = (name, text) => h('div', { class: 'futurerow' },
      h('div', { class: 'grow' }, h('div', { class: 'name', text: name }), h('div', { class: 'hint', text })),
      h('span', { class: 'pill', text: 'Not built yet' }));
    return h('div', { class: 'card', 'data-settings': 'future' }, h('h3', { text: 'Planned' }),
      row('Bluetooth proxy', 'Let Home Assistant use the mirror’s Bluetooth radio to reach nearby Bluetooth devices. The radio passed its first test on one mirror; the proxy itself is planned for a later app version.'),
      row('Voice assistant', 'Use the mirror’s microphone and speaker as a voice satellite for Home Assistant. The microphone passed its first test on one mirror; this is planned for a later app version and will be off until you turn it on.'));
  }

  _renderSettings() {
    const page = this.$('settingspage');
    if (!page || this.state.view !== 'settings') return;
    const focused = this.shadowRoot.activeElement;
    if (focused && page.contains(focused) && /^(INPUT|TEXTAREA)$/.test(focused.tagName) && focused.type !== 'range') return;      // do not rebuild under the user's typing
    const scroll = page.scrollTop;
    page.textContent = '';
    const displays = this.state.displays;
    const d = displays.find((x) => x.id === this.state.settingsDisplay) || displays.find((x) => x.has_mirror) || displays[0];
    if (d) this.state.settingsDisplay = d.id;
    const inner = h('div', { class: 'settingsinner' },
      h('div', { class: 'row settingshead' }, h('h2', { text: 'Settings' }), h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm', 'data-settings': 'close', onClick: () => this._closeSettings() }, 'Back to panes')));
    if (!d) {
      inner.append(h('div', { class: 'card' }, h('div', { class: 'hint', text: 'Add a display first (the Displays tab). Settings belong to a display with a Mirror Kiosk app behind it.' })), this._futureCard());
      page.append(inner);
      return;
    }
    if (displays.length > 1) {
      const pick = h('select', { class: 'field', 'data-settings': 'display', onChange: () => { this.state.settingsDisplay = pick.value; this._renderSettings(); } },
        displays.map((x) => h('option', { value: x.id, selected: x.id === d.id, text: x.name })));
      inner.append(h('div', { class: 'card' }, h('label', { class: 'lbl', style: 'margin-top:0', text: 'Display' }), pick));
    }
    inner.append(this._speakerCard(d), h('div', { class: 'card' }, this._mirrorSection(d)), this._futureCard());
    page.append(inner);
    page.scrollTop = scroll;
  }

  _mirrorMeasureDialog(d) {
    const st = this._mirrorSt(d.id);
    const modal = h('div', { class: 'modal' }, h('div', { class: 'dialog' },
      h('h2', { text: 'Measure what presence costs?' }),
      h('div', { class: 'warnbox', text: 'This switches presence OFF on "' + d.name + '" for about 20 seconds. While it is off the mirror will not notice anyone in front of it.' }),
      h('p', { text: 'Steps: read the mirror’s memory, switch presence off, wait about 20 seconds, read the memory again, then switch presence back on. It is switched back on even if something goes wrong, and you are told if that fails.' }),
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', { class: 'btn primary', 'data-mirror': 'confirm-measure', onClick: async () => {
          modal.remove(); st.measuring = true; st.result = null; this._renderRail(true);
          const r = await this._mirrorCall(d, { type: 'glass_panes/mirror/measure', confirm: true });
          st.measuring = false;
          if (r && r.ok) { st.result = r; this.toast('Measured'); }
          await this._mirrorRefresh(d);
        } }, 'Yes, measure'),
        h('button', { class: 'btn', text: 'Cancel', onClick: () => modal.remove() }))));
    this.shadowRoot.querySelector('.app').append(modal);       // the top level, so it also shows over the Settings page
  }

  async _setDisplayPane(id, pane) {
    try { await this.ws({ type: 'glass_panes/displays/save', display: { id, pane } }); this.toast('Display switched to ' + pane); } catch (e) { this.fail(e); }
    await this._reload();
  }

  /**
   * Pair a mirror from the code on its screen (app 0.12.0+). Home Assistant makes the display's login and sends it to the mirror
   * itself, so nobody copies a token. The builder only carries the six digits, the mirror's address and the address of Home Assistant
   * that the MIRROR can reach (an internal http address, not the browser's cloud address).
   */
  _pairBox(d) {
    const open = this.state.pairing === d.id;
    if (!open) {
      return h('div', { style: 'margin-top:10px' },
        h('button', { class: 'btn sm', 'data-field': 'pair-open', onClick: () => { this.state.pairing = d.id; this._renderRail(true); } }, d.has_login && d.has_mirror ? 'Pair again…' : 'Pair a mirror…'),
        h('div', { class: 'hint', style: 'margin-top:6px', text: 'A mirror that is not set up shows a six-digit code on its screen. Enter it here and Home Assistant sets the mirror up for you.' }));
    }
    const cfg = this._hass.config || {};
    const base = cfg.internal_url || location.origin;
    const code = h('input', { class: 'field', 'data-field': 'pair-code', type: 'text', inputmode: 'numeric', maxlength: 7, placeholder: 'Code on the mirror, like 482 913', autocomplete: 'off' });
    const mirror = h('input', { class: 'field', 'data-field': 'pair-mirror', type: 'text', maxlength: 100, placeholder: 'Mirror address shown under the code, like mirror.local', value: d.has_mirror ? '' : '', autocomplete: 'off', spellcheck: 'false' });
    const ha = h('input', { class: 'field', 'data-field': 'pair-base', type: 'text', maxlength: 200, value: base, autocomplete: 'off', spellcheck: 'false' });
    const go = h('button', { class: 'btn sm primary', 'data-field': 'pair-go', onClick: async () => {
      go.disabled = true;
      try {
        await this.ws({ type: 'glass_panes/mirror/pair', display_id: d.id, endpoint: mirror.value.trim(), code: code.value.trim(), base_url: ha.value.trim() });
        this.state.pairing = null;
        this.toast('The mirror is set up. Its pane should appear in a moment.');
        await this._reload();
      } catch (e) { this.fail(e); go.disabled = false; }
    } }, 'Pair');
    return h('div', { class: 'rulecard', style: 'margin-top:10px', 'data-pair': d.id },
      h('label', { class: 'lbl', text: 'Code' }), code,
      h('label', { class: 'lbl', text: 'Mirror address' }), mirror,
      h('label', { class: 'lbl', text: 'Home Assistant address, as the mirror reaches it' }), ha,
      base.startsWith('https') ? h('div', { class: 'warnbox poor', text: 'This is an https address. Older mirrors cannot use one: type your local http address, like http://homeassistant.local:8123.' }) : null,
      h('div', { class: 'row', style: 'margin-top:8px' }, go, h('button', { class: 'btn sm ghost', onClick: () => { this.state.pairing = null; this._renderRail(true); } }, 'Cancel')),
      h('div', { class: 'hint', text: 'The login goes from Home Assistant to the mirror over your home network. You never see or copy it.' }));
  }

  /** The time zone of one display: type a place, or leave it empty to follow Home Assistant's own zone (so a daylight-saving change just works). */
  _displayZoneField(d) {
    const ha = d.ha_timezone || (this._hass.config && this._hass.config.time_zone) || '';
    let zones;
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney', 'UTC']; }
    const input = h('input', { class: 'field', type: 'text', list: 'gp-tzlist', 'data-display-zone': d.id, value: d.timezone || '', autocomplete: 'off', spellcheck: 'false',
      placeholder: ha ? 'Follows Home Assistant (' + ha + ')' : 'Follows Home Assistant',
      onChange: () => this._setDisplayZone(d, input) });
    return h('div', {}, h('label', { class: 'lbl', text: 'Time zone' }), input,
      h('datalist', { id: 'gp-tzlist' }, zones.map((z) => h('option', { value: z }))),
      h('div', { class: 'hint', text: d.timezone ? 'This display keeps its own zone. Empty the box to follow Home Assistant' + (ha ? ' (' + ha + ')' : '') + '.'
        : 'Following Home Assistant' + (ha ? ' (' + ha + ')' : '') + ', so a daylight-saving change is picked up. Type a place to give this display its own.' }));
  }

  async _setDisplayZone(d, input) {
    const v = input.value.trim();
    if (v && !validZone(v)) { this.toast('“' + v + '” is not a time zone name. Try one like America/Chicago.', true); input.value = d.timezone || ''; return; }
    try { await this.ws({ type: 'glass_panes/displays/save', display: { id: d.id, timezone: v } }); this.toast(v ? 'Time zone set to ' + v : 'Following Home Assistant’s time zone'); } catch (e) { this.fail(e); }
    await this._reload();
  }

  async _addDisplay(name, tz) {
    name = name.trim();
    if (!name) return;
    const display = { name };
    if (tz.trim()) display.timezone = tz.trim();
    try { const r = await this.ws({ type: 'glass_panes/displays/save', display }); this.toast('Added ' + r.display.name); this.state.newDisplay = false; } catch (e) { this.fail(e); }
    await this._reload();
  }

  // A display signs in as its own limited user with its own long-lived token. The token is made here, shown once, and kept nowhere.
  async _makeLogin(d, replacing) {
    if (replacing && !confirm('Make a new login for "' + d.name + '"? The current one stops working, so the display has to be set up again.')) return;
    try {
      const reply = await this.ws({ type: 'glass_panes/displays/login/create', display_id: d.id });
      await this._reload();
      this._showLoginDialog(d, reply);
    } catch (e) { this.fail(e); }
  }

  async _revokeLogin(d) {
    if (!confirm('Remove the login for "' + d.name + '"? The display will ask to sign in again until you set up a new one.')) return;
    try { await this.ws({ type: 'glass_panes/displays/login/revoke', display_id: d.id }); this.toast('Login removed'); await this._reload(); } catch (e) { this.fail(e); }
  }

  _showLoginDialog(d, reply) {
    const link = location.origin + PLAYER + '?display=' + encodeURIComponent(d.id) + '#t=' + reply.token;
    const copyButton = (text) => {
      const b = h('button', { class: 'btn sm', onClick: async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Select the text and copy it'; } } }, icon('copy'), 'Copy');
      return b;
    };
    const box = (text, rows) => h('textarea', { class: 'field mono', readonly: true, rows, onClick: (ev) => ev.target.select() }, text);
    const modal = h('div', { class: 'modal' }, h('div', { class: 'dialog' },
      h('h2', { text: 'Login for ' + d.name }),
      h('div', { class: 'warnbox', text: 'This is shown once. Anyone who has it can read your Home Assistant data, so treat it like a password.' }),
      h('label', { class: 'lbl', text: '1. Open this link on the display' }),
      box(link, 4), h('div', { style: 'margin-top:6px' }, copyButton(link)),
      h('div', { class: 'hint', style: 'margin-top:6px', text: 'Type or send it to the display’s browser. The display saves the login on itself and then removes it from the address.' }),
      h('label', { class: 'lbl', text: 'Or paste just the token on the display’s sign-in screen' }),
      box(reply.token, 3), h('div', { style: 'margin-top:6px' }, copyButton(reply.token)),
      h('label', { class: 'lbl', text: 'What this login is' }),
      h('div', { class: 'hint', text: 'A separate ordinary user called “' + reply.user + '”. It can read and control your devices like any ordinary user (it cannot change settings), and can only sign in from your home network. Home Assistant cannot limit a user to certain entities, so it can read what any ordinary user can. Remove it any time with Revoke.' }),
      h('label', { class: 'lbl', text: 'Prefer to make a token yourself?' }),
      h('ol', { class: 'steps' }, h('li', { text: 'In Home Assistant, click your name at the bottom of the sidebar.' }), h('li', { text: 'Open the Security tab, then Long-lived access tokens, then Create token.' }),
        h('li', { text: 'Copy it and paste it on the display’s sign-in screen.' })),
      h('div', { class: 'row', style: 'margin-top:16px' }, h('button', { class: 'btn primary', onClick: () => modal.remove() }, 'Done'))));
    this.shadowRoot.querySelector('.app').append(modal);       // the top level, so it also shows over the Settings page
  }

  // Sharing: a pane is just layout (no entities), so it can go in a file. Uploaded pictures and videos stay behind: they live on this Home Assistant.
  _exportPane() {
    if (!this.state.pane) return;
    const pane = clone(this.state.pane);
    pane.widgets.forEach((w) => { if (w.options && w.options.media) { w.options = { ...w.options }; delete w.options.media; } });
    const blob = new Blob([JSON.stringify({ glass_panes_pane: 1, pane }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = pane.id + '.glass-pane.json';
    this.shadowRoot.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    this.toast('Saved ' + link.download + '. Pictures and videos are not included.');
  }

  async _importPane(file) {
    if (!file) return;
    let doc;
    try { doc = JSON.parse(await file.text()); } catch (e) { this.toast('That is not a Glass Panes file (it is not valid JSON).', true); return; }
    if (!doc || doc.glass_panes_pane !== 1 || !doc.pane || typeof doc.pane !== 'object' || !Array.isArray(doc.pane.widgets)) {
      this.toast('That file is not an exported Glass Panes pane.', true);
      return;
    }
    const pane = doc.pane;
    const taken = new Set(this.state.panes.map((p) => p.id));
    const original = String(pane.id || 'pane');
    let id = original, n = 2;
    while (taken.has(id)) id = original + '_' + n++;
    if (id !== original) pane.name = String(pane.name || original) + ' (imported)';
    pane.id = id;
    try {
      await this.ws({ type: 'glass_panes/panes/save', pane });
      this.toast('Imported ' + pane.name);
      await this._reload();
      await this._select(id);
    } catch (e) { this.fail(e); }          // the same checks as the builder: a pane that is not valid is refused with the reason
  }

  async _removeDisplay(d) {
    if (!confirm('Remove the display "' + d.name + '" and its select entity?')) return;
    try { await this.ws({ type: 'glass_panes/displays/delete', display_id: d.id }); this.toast('Removed ' + d.name); } catch (e) { this.fail(e); }
    await this._reload();
  }

  // ---------------------------------------------------------------- managing panes
  _current() { return this.state.panes.find((p) => this.state.pane && p.id === this.state.pane.id) || null; }

  async _addPane(name, copyFrom) {
    name = name.trim();
    if (!name) return;
    const msg = { type: 'glass_panes/panes/create', name };
    if (copyFrom) msg.copy_from = copyFrom;
    try {
      const r = await this.ws(msg);
      this.state.newPane = false;
      this.toast('Added ' + r.pane.name);
      await this._reload();
      await this._select(r.pane.id);
    } catch (e) { this.fail(e); }
  }

  async _duplicatePane() {
    const cur = this._current();
    if (!cur) return;
    try {
      const r = await this.ws({ type: 'glass_panes/panes/create', name: cur.name + ' copy', description: cur.description || '', copy_from: cur.id });
      this.toast('Made ' + r.pane.name);
      await this._reload();
      await this._select(r.pane.id);
    } catch (e) { this.fail(e); }
  }

  _openDetails() {
    const cur = this._current();
    if (!cur) return;
    this.$('dname').value = cur.name;
    this.$('ddesc').value = cur.description || '';
    this.$('did').textContent = cur.id;
    this.$('details').style.display = 'block';
    this.$('dname').focus();
  }

  async _saveDetails() {
    const cur = this._current();
    if (!cur) return;
    try {
      await this.ws({ type: 'glass_panes/panes/update', pane_id: cur.id, name: this.$('dname').value, description: this.$('ddesc').value });
      this.$('details').style.display = 'none';
      this.toast('Saved');
      await this._reload();
      await this._select(cur.id);
    } catch (e) { this.fail(e); }
  }

  // a pane of your own is deleted; a built-in one you changed goes back to the original; an untouched built-in one cannot be removed
  async _deletePane() {
    const cur = this._current();
    if (!cur || cur.source !== 'user') return;
    const reset = cur.customized;
    if (!confirm(reset ? 'Put "' + cur.name + '" back to the built-in version? Your changes to it are lost.' : 'Delete the pane "' + cur.name + '"?')) return;
    try {
      await this.ws({ type: 'glass_panes/panes/delete', pane_id: cur.id });
      this.toast(reset ? 'Put back to the built-in version' : 'Deleted ' + cur.name);
      await this._reload();
      await this._select(reset ? cur.id : (this.state.panes.find((p) => p.id === 'mirror') || this.state.panes[0]).id);
    } catch (e) { this.fail(e); }       // for example: it is showing on a display
  }

  // ---------------------------------------------------------------- the preview
  _guardedSelect(id) {
    if (this.edit && this.edit.dirty && !confirm('Leave without saving your changes?')) return;
    this._select(id);
  }

  async _select(id) {
    try {
      const r = await this.ws({ type: 'glass_panes/panes/get', pane_id: id });
      this._stopEdit(true);
      this.state.pane = r.pane;
      this.state.source = r.source;
      this.state.demo = null;                                           // decide again for this pane
      this.$('details').style.display = 'none';
      this._renderRail(true);
      this._draw();
    } catch (e) { this.fail(e); }
  }

  _boundSlots() {
    const all = (this.state.bindings && this.state.bindings.bindings) || {};
    return (this.state.pane && all[this.state.pane.id]) || {};
  }

  _shownPane() { return this.edit ? this.edit.pane : this.state.pane; }

  _shownBindings() { return this.edit ? this.edit.bindings : this._boundSlots(); }

  // which data a widget reads: its own entities when it has some (or when demo data is off), made-up data otherwise
  _useMock(w) { return (this.state.demo && !hasEntityBinding(this._shownBindings()[w.id])) || !!(this.edit && this.edit.sample.has(w.id)); }

  _clientFor(w) { return this._useMock(w) ? this.mock : this.client; }

  _draw() {
    const pane = this._shownPane();
    if (!pane || !this.renderer) return;
    const bound = this._shownBindings();
    if (this.state.demo === null) this.state.demo = !Object.values(bound).some(hasEntityBinding);       // nothing bound yet: show made-up data so it is not blank
    const mock = mockBindings(this.state.registry, pane);
    const slots = {};
    // a condition's entity is always the real one (made-up data would just answer for any name), even where the widget shows demo data
    // a widget bound to an image or camera entity keeps that entity in demo mode too (the demo client draws a made-up picture for it)
    const keep = (w) => (bound[w.id] && /^(camera|image)\./.test(String(bound[w.id].entity || '')) ? { entity: bound[w.id].entity } : {});
    (pane.widgets || []).forEach((w) => { slots[w.id] = this._useMock(w) ? { ...(mock[w.id] || {}), ...keep(w), ...whenSlots(bound[w.id]) } : (bound[w.id] || {}); });
    this.renderer.time = this.time;
    this.renderer.force = new Map(Object.entries(this._forceMap()));          // preview only: the eye controls
    this.renderer.show(pane, slots);
    this._renderChrome();
    this._fitPreview();
    this._buildOverlay();
    clearTimeout(this._fitTimer);
    this._fitTimer = setTimeout(() => this._reportFit(), 1800);
  }

  // the title, badges, buttons and dock that depend on what you are doing
  _renderChrome() {
    const pane = this._shownPane();
    const cur = this._current();
    const editing = !!this.edit;
    this.$('layout').classList.toggle('editing', editing);
    this.$('layout').classList.toggle('has-inspector', editing);
    this.$('title').textContent = pane ? pane.name : 'Choose a pane';
    const src = this.$('source');
    src.textContent = '';
    if (pane) src.append(h('span', { class: 'pill' + (editing ? ' on' : this.state.source === 'user' ? ' on' : ''), text: editing ? 'Editing' : this.state.source === 'user' ? 'Saved' : 'Built in' }));
    const st = this.$('status');
    st.textContent = '';
    if (editing && this.edit.dirty) st.append(h('span', { class: 'pill warn' }, h('span', { class: 'dot' }), 'Unsaved changes'));

    const actions = this.$('actions');
    actions.textContent = '';
    actions.classList.remove('panebar');
    if (!editing && pane) {
      actions.append(
        h('button', { class: 'btn sm ghost', onClick: () => this._openDetails() }, 'Name & description'),
        h('button', { class: 'btn sm ghost', onClick: () => this._duplicatePane() }, icon('copy'), 'Duplicate'),
        h('button', { class: 'btn sm ghost', title: 'Save this pane as a file you can share', onClick: () => this._exportPane() }, 'Export'));
      if (cur && cur.source === 'user') actions.append(h('button', { class: 'btn sm ghost danger', onClick: () => this._deletePane() }, icon('trash'), cur.customized ? 'Reset to built-in' : 'Delete'));
    } else if (editing) {
      // the pane's colour theme: choosing one repaints the preview straight away; "Original" removes the theme (the plain background)
      const themeSel = h('select', { id: 'themepick', class: 'field', style: 'width:auto;padding:5px 9px', title: 'Colours for this whole pane',
        onChange: (ev) => this._setTheme(ev.target.value) },
      h('option', { value: '', text: 'Original' }), Object.entries(THEMES).map(([id, t]) => h('option', { value: id, selected: pane.theme === id, text: t.label })));
      // background: used with no theme, or with a dark theme whose own background is switched off (true black stays behind the theme's colours).
      // Pure black is see-through on a mirror; the theme's own background is lit, so it shows up as a visible rectangle there.
      const lightTheme = !!pane.theme && !themeIsDark(pane.theme);
      const useThemeBg = !!pane.theme && (pane.own_background !== true || lightTheme);
      const themeBgBox = pane.theme ? h('label', { class: 'check', style: 'margin:0 0 0 8px', title: lightTheme ? 'A light theme needs its own light background (its text is dark)' : 'Tick to use the theme\'s own lit background. Untick for your own, true black by default: black is see-through on a mirror.' },
        h('input', { type: 'checkbox', id: 'themebgpick', checked: useThemeBg, disabled: lightTheme, onChange: (ev) => this._setPaneField('own_background', ev.target.checked ? null : true) }), 'Theme background') : null;
      const bg = h('input', { type: 'color', class: 'swatch', id: 'bgpick', value: HEX6.test(pane.background || '') ? pane.background : '#000000', disabled: useThemeBg,
        title: useThemeBg ? 'The theme sets the background. Untick Theme background to pick your own.' : 'Background. Pure black is see-through on a two-way mirror.',
        onChange: (ev) => this._setPaneField('background', ev.target.value.toLowerCase() === '#000000' ? null : ev.target.value.toLowerCase()) });
      // brightness: what the display's backlight is asked for while this pane shows ("As is" leaves it alone)
      const bright = h('select', { id: 'brightpick', class: 'field', style: 'width:auto;padding:5px 9px', title: 'Backlight while this pane shows',
        onChange: (ev) => this._setPaneField('brightness', ev.target.value === '' ? null : parseInt(ev.target.value, 10)) },
      h('option', { value: '', text: 'As is' }), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => h('option', { value: n, selected: pane.brightness === n, text: n + '%' })),
      pane.brightness != null && pane.brightness % 10 ? h('option', { value: pane.brightness, selected: true, text: pane.brightness + '%' }) : null);
      const ctl = (...kids) => h('span', { class: 'ctl' }, ...kids);         // a label and its control never wrap apart
      actions.classList.add('panebar');
      actions.append(ctl(h('label', { class: 'lbl', text: 'Theme' }), themeSel, ...(themeBgBox ? [themeBgBox] : [])),
        ctl(h('label', { class: 'lbl', text: 'Background' }), bg, h('span', { class: 'hint', text: 'Black is see-through on a mirror.' })),
        ctl(h('label', { class: 'lbl', text: 'Brightness' }), bright),
        ctl(h('label', { class: 'lbl', text: 'Grid' }), h('select', { id: 'gridpick', class: 'field', style: 'width:auto;padding:5px 9px', title: 'Snap size while you drag (kept in this browser)',
          onChange: (ev) => { try { localStorage.setItem('glass_panes_grid', ev.target.value); } catch (e) { /* ignore */ } this._renderInspector(); } },
        ops.GRID_CHOICES.map((n) => h('option', { value: n, selected: this._grid() === n, text: n ? n + ' px' : 'Off' })))),
        ctl(h('label', { class: 'lbl', text: 'Zoom' }),
          h('button', { class: 'btn sm ghost', id: 'zoomout', title: 'Zoom out', onClick: () => this._setZoom((this._zoom || 1) / 1.25) }, '−'),
          h('button', { class: 'btn sm ghost', id: 'zoomlbl', title: 'Fit to screen', onClick: () => this._setZoom(1) }, this._zoom > 1 ? Math.round(this._zoom * 100) + '%' : 'Fit'),
          h('button', { class: 'btn sm ghost', id: 'zoomin', title: 'Zoom in (or Ctrl + mouse wheel)', onClick: () => this._setZoom((this._zoom || 1) * 1.25) }, '+')),
        // fade: widgets switched by "show when" rules fade in and out instead of popping
        h('label', { class: 'check', title: 'Widgets switched by "Show when" rules fade in and out' },
          h('input', { type: 'checkbox', id: 'fadepick', checked: !!(pane.motion && pane.motion.widgets === 'fade'), onChange: (ev) => this._setPaneField('motion', ev.target.checked ? { widgets: 'fade' } : null) }), 'Fade'),
        h('label', { class: 'check', title: 'The whole pane drifts a few pixels over 40 minutes, so a screen left on never holds the same pixels' },
          h('input', { type: 'checkbox', id: 'driftpick', checked: pane.burn_in_saver === true, onChange: (ev) => this._setPaneField('burn_in_saver', ev.target.checked ? true : null) }), 'Burn-in drift'));
    }
    this._renderDock();
    this._renderInspector();
  }

  /** Set (or clear, with an empty value) the pane's colour theme. It goes through _commit, so it can be undone and shows at once. */
  _setTheme(id) {
    if (!this.edit) return;
    const pane = clone(this.edit.pane);
    if (id && THEMES[id]) {
      pane.theme = id;
      // a dark theme starts on true black (see-through on a mirror) with the theme's text colours; a light theme needs its own light background
      if (!themeIsDark(id)) delete pane.own_background; else if (pane.own_background === undefined) pane.own_background = true;
    } else { delete pane.theme; delete pane.own_background; }
    this._commit(pane);
  }

  /** Set (or clear, with null) one pane-level field such as background or brightness. Undoable, like every edit. */
  _setPaneField(key, value) {
    if (!this.edit) return;
    const pane = clone(this.edit.pane);
    if (value == null) delete pane[key]; else pane[key] = value;
    this._commit(pane);
  }

  _mirrorSwitch() {
    const box = h('input', { type: 'checkbox', onChange: () => { this.state.mirror = box.checked; this._scale = 0; this._applyMirror(); } });
    box.checked = !!this.state.mirror;
    return h('label', { class: 'switch', title: 'See it on a mirror: the display sits behind glass, with its edges marked' }, box, 'Mirror view');
  }

  // the cream wall and the stand, only offered while Mirror view is on
  _standSwitch() {
    if (!this.state.mirror) return document.createDocumentFragment();
    const box = h('input', { type: 'checkbox', onChange: () => { this.state.stand = box.checked; this._scale = 0; this._applyMirror(); } });
    box.checked = !!this.state.stand;
    return h('label', { class: 'switch', title: 'Show the cream wall and the stand the mirror rests on' }, box, 'Stand & wall');
  }

  _applyMirror() {
    this.$('layout').classList.toggle('mirrorview', !!this.state.mirror);
    this.$('layout').classList.toggle('room', !!this.state.mirror && !!this.state.stand);
    this._renderDock();
    this._fitPreview();
  }

  _demoSwitch() {
    const box = h('input', { type: 'checkbox', onChange: () => { this.state.demo = box.checked; this._draw(); } });
    box.checked = !!this.state.demo;
    return h('label', { class: 'switch', title: 'Fill empty widgets with made-up data' }, box, 'Demo data');
  }

  _renderDock() {
    const dock = this.$('dock');
    dock.textContent = '';
    if (!this._shownPane()) return;
    if (!this.edit) {
      dock.append(h('div', { class: 'grp' }, h('button', { class: 'btn primary', onClick: () => this._startEdit() }, icon('edit'), 'Edit pane')),
        h('div', { class: 'grp' }, this._demoSwitch(), this._mirrorSwitch(), this._standSwitch(), this._forceButton()));
      return;
    }
    const e = this.edit, many = e.selected.length > 1;
    const menu = h('div', { class: 'menu', id: 'alignmenu' }, ALIGN_BUTTONS.map(([mode, label]) =>
      h('button', { class: 'btn icon ghost', title: label, onClick: () => { this._align(mode); menu.classList.remove('open'); } }, icon(mode))));
    dock.append(h('div', { class: 'grp tools' },
      h('button', { class: 'btn primary', onClick: () => this._openDrawer('add') }, icon('plus'), 'Add'),
      h('button', { class: 'btn icon ghost', title: 'Undo', disabled: !e.undo.length, onClick: () => this._undo() }, icon('undo')),
      h('button', { class: 'btn icon ghost', title: 'Redo', disabled: !e.redo.length, onClick: () => this._redo() }, icon('redo')),
      h('div', { class: 'menuwrap' }, h('button', { class: 'btn icon ghost', title: many ? 'Align' : 'Select two or more items to align them', disabled: !many, onClick: () => menu.classList.toggle('open') }, icon('align')), menu),
      ),
      h('div', { class: 'grp view' }, this._demoSwitch(), this._mirrorSwitch(), this._standSwitch(), this._forceButton()),
      h('div', { class: 'grp save' },
        h('button', { class: 'btn', onClick: () => this._discard() }, 'Discard'),
        h('button', { class: 'btn primary', disabled: !e.dirty, onClick: () => this._save() }, icon('check'), 'Save')));
  }

  /** The snap grid in pixels (10, 20, 40, or 0 for off). A builder setting kept in this browser, not in the pane file. */
  _grid() {
    try { const v = parseInt(localStorage.getItem('glass_panes_grid'), 10); if (ops.GRID_CHOICES.includes(v)) return v; } catch (e) { /* no storage: default */ }
    return ops.GRID;
  }

  /** Zoom the editor: 1 is "fit to screen"; the view then scrolls. Handles keep their screen size through --inv. */
  _setZoom(z) {
    this._zoom = z == null ? 1 : Math.min(ops.ZOOM_MAX, Math.max(1, Math.round(z * 100) / 100));
    this._scale = 0; this._fitPreview();
    const lbl = this.$('zoomlbl'); if (lbl) lbl.textContent = this._zoom === 1 ? 'Fit' : Math.round(this._zoom * 100) + '%';
  }

  _fitPreview() {
    const wrap = this.$('wrap'), preview = this.$('preview'), stage = this.$('stage'), overlay = this.$('overlay');
    if (!wrap || !preview) return;
    const cs = getComputedStyle(wrap);
    const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 18;
    const standShare = this.state.mirror && this.state.stand ? MIRROR_STAND : 0;       // the loop under the glass takes room too
    const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 18;
    // in mirror view the glass reaches past the display on every side
    const g = this.state.mirror ? MIRROR_GLASS : { left: 0, right: 0, top: 0, bottom: 0 };       // glass around the display, as a share of the display's size
    const gl = 1080 * g.left, gr = 1080 * g.right, gt = 1920 * g.top, gb = 1920 * g.bottom;
    const s = Math.max(0.05, Math.min(availW / (1080 + gl + gr), availH / ((1920 + gt + gb) * (1 + standShare)))) * (this._zoom || 1);
    if (Math.abs(s - this._scale) < 0.0005) return;
    this._scale = s;
    preview.style.width = Math.floor(1080 * s) + 'px';
    preview.style.height = Math.floor(1920 * s) + 'px';
    // the frame, the stand's metal and its corners are sized from the mirror's own width, so they scale with the view like the real thing
    const dev = this.$('device'), mirrorW = (1080 + gl + gr) * s;
    const thick = Math.max(3, Math.min(16, Math.round(mirrorW * 0.028)));
    dev.style.setProperty('--stand-h', Math.round((1920 + gt + gb) * standShare * s) + 'px');
    dev.style.setProperty('--stand-t', thick + 'px');
    dev.style.setProperty('--stand-r', Math.round(thick * 1.8) + 'px');
    dev.style.setProperty('--join', Math.max(3, Math.round(thick * 0.6)) + 'px');
    dev.style.setProperty('--frame', Math.max(2, Math.min(8, Math.round(mirrorW * 0.012))) + 'px');
    const glass = this.$('glass');
    glass.style.padding = this.state.mirror ? [gt, gr, gb, gl].map((v) => Math.round(v * s) + 'px').join(' ') : '';
    stage.style.cssText += `;position:absolute;left:0;top:0;transform-origin:top left;transform:scale(${s})`;
    overlay.style.transform = `scale(${s})`;
    overlay.style.setProperty('--inv', String(1 / s));          // lets handles and outlines keep the same size on screen at any zoom
  }

  _reportFit() {
    if (!this.renderer) return;
    const bad = this.renderer.checkOverflow();
    const el = this.$('fit');
    el.textContent = '';
    if (!this._shownPane()) return;
    el.append(bad.length
      ? h('span', { class: 'pill bad', title: ops.misfitNames(bad, (this._shownPane() || {}).widgets || [], (w) => this._label(w)).join(', ') }, bad.length + (bad.length > 1 ? ' items do' : ' item does') + ' not fit')
      : h('span', { class: 'pill good' }, h('span', { class: 'dot' }), 'Everything fits'));
  }

  // ---------------------------------------------------------------- edit mode
  _startEdit() {
    if (!this.state.pane) return;
    this.edit = { pane: clone(this.state.pane), bindings: clone(this._boundSlots()), undo: [], redo: [], selected: [], dirty: false, edgeOk: new Set(), sample: new Set() };
    this._draw();
    clearInterval(this._syncTimer);
    this._syncTimer = setInterval(() => this._syncOverlay(), 450);
    this.focus();
  }

  _stopEdit(quiet) {
    clearInterval(this._syncTimer);
    this.edit = null;
    if (this._zoom > 1) this._setZoom(1);                  // the zoom controls live in the edit toolbar, so the viewer goes back to Fit
    this._closeDrawer();
    if (!quiet) this._draw();
  }

  _discard() {
    if (this.edit.dirty && !confirm('Throw away your changes to this pane?')) return;
    this._stopEdit();
  }

  async _save() {
    const e = this.edit;
    if (!e || !e.dirty) return;
    const loops = findRuleLoops(e.pane.widgets);
    if (loops.length) {
      const name = (id) => { const x = e.pane.widgets.find((y) => y.id === id); return x ? (x.name || x.type) : id; };
      this.toast('These widgets wait on each other, so the pane cannot be saved: ' + loops[0].map(name).join(' → ') + '. Change one of the Show when rules.', true);
      return;
    }
    try {
      const id = e.pane.id;
      await this.ws({ type: 'glass_panes/panes/save', pane: e.pane });
      // keep only the entities of widgets that still exist
      const mine = {};
      e.pane.widgets.forEach((w) => { if (hasBinding(e.bindings[w.id])) mine[w.id] = e.bindings[w.id]; });
      const all = clone((this.state.bindings && this.state.bindings.bindings) || {});
      if (Object.keys(mine).length) all[id] = mine; else delete all[id];
      await this.ws({ type: 'glass_panes/bindings/set', bindings: all });
      this.toast('Saved');
      const demo = this.state.demo;
      this._stopEdit(true);
      await this._reload();
      await this._select(id);
      this.state.demo = demo;                  // keep the Demo data setting you had while editing
      this._draw();
    } catch (err) { this.fail(err); }
  }

  /** Record a change: remember the old state for undo, then show the new one. */
  _commit(pane, bindings) {
    const e = this.edit;
    e.undo.push(JSON.stringify({ pane: e.pane, bindings: e.bindings }));
    if (e.undo.length > 100) e.undo.shift();
    e.redo = [];
    const before = new Map(e.pane.widgets.map((w) => [w.id, w]));
    const changed = pane.widgets.filter((w) => { const o = before.get(w.id); return !o || ['x', 'y', 'w', 'h', 'auto_height'].some((k) => o[k] !== w[k]); }).map((w) => w.id);
    e.pane = pane;
    if (bindings) e.bindings = bindings;
    e.dirty = true;
    const ids = new Set(pane.widgets.map((w) => w.id));
    e.selected = e.selected.filter((id) => ids.has(id));
    this._draw();
    this._showNotice([]);
    if (changed.length) setTimeout(() => this._checkEdges(changed), 150);       // once the engine has placed everything
  }

  // Items may go to the very edge. Anything reaching into the outer strip gets a heads-up, because a mirror's frame can hide it.
  _checkEdges(ids) {
    const e = this.edit;
    if (!e) return;
    const offenders = [];
    ids.forEach((id) => {
      const w = this._widget(id);
      if (!w) return;
      const outside = ops.outsideSafe(this._rectOf(w));
      if (!outside) e.edgeOk.delete(id);
      else if (!e.edgeOk.has(id)) offenders.push(w);
    });
    this._showNotice(offenders);
  }

  _showNotice(offenders) {
    const box = this.$('notice');
    box.textContent = '';
    if (!offenders.length) return;
    const names = offenders.map((w) => this._label(w)).join(', ');
    box.append(h('div', { class: 'notice' },
      h('b', { text: 'Outside the safe zone' }),
      h('div', { class: 'hint', text: names + (offenders.length > 1 ? ' reach' : ' reaches') + ' into the outer ' + ops.SAFE + ' px, which the mirror’s frame or rounded corners can hide. You can still keep it right at the edge.' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary sm', onClick: () => { offenders.forEach((w) => this.edit.edgeOk.add(w.id)); this._showNotice([]); } }, 'Keep at the edge'),
        h('button', { class: 'btn sm', onClick: () => {
          const pane = clone(this.edit.pane);
          pane.widgets = pane.widgets.map((w) => (offenders.some((o) => o.id === w.id) ? ops.pulledInside(w, this._rectOf(w)) : w));
          this._commit(pane);
        } }, 'Pull inside'))));
  }

  _restore(json) {
    const e = this.edit, s = JSON.parse(json);
    e.pane = s.pane; e.bindings = s.bindings; e.dirty = true;
    const ids = new Set(e.pane.widgets.map((w) => w.id));
    e.selected = e.selected.filter((id) => ids.has(id));
    this._draw();
  }

  _undo() {
    const e = this.edit;
    if (!e || !e.undo.length) return;
    e.redo.push(JSON.stringify({ pane: e.pane, bindings: e.bindings }));
    this._restore(e.undo.pop());
  }

  _redo() {
    const e = this.edit;
    if (!e || !e.redo.length) return;
    e.undo.push(JSON.stringify({ pane: e.pane, bindings: e.bindings }));
    this._restore(e.redo.pop());
  }

  _selectWidgets(ids) {
    this.edit.selected = ids;
    this._syncOverlay();
    this._renderChrome();
  }

  _boundIds(widgetId) {
    const b = (this.edit && this.edit.bindings[widgetId]) || {};
    return Object.entries(b).filter(([slot]) => !isWhenSlot(slot)).map(([, v]) => v).flat().map((v) => (typeof v === 'string' ? v : v && v.entity)).filter(Boolean);
  }

  // where a widget really is right now (the engine places flowing and self-sizing widgets), in canvas pixels
  _rectOf(w) {
    const inst = this.renderer.mounted.find((m) => m.spec.id === w.id);
    const r = inst && inst.root;
    // a widget switched off keeps its place (the engine hides it, it does not remove it), so it is shown as a dashed ghost where it would be
    if (r && r.offsetWidth > 0 && r.offsetHeight > 0) return { x: r.offsetLeft, y: r.offsetTop, w: r.offsetWidth, h: r.offsetHeight, ghost: r.classList.contains('gp-hidden') };
    return { x: w.x, y: w.y, w: w.w, h: Math.max(w.h, 40), ghost: true };
  }

  _buildOverlay() {
    const overlay = this.$('overlay');
    overlay.textContent = '';
    if (!this.edit) return;
    overlay.append(h('div', { class: 'safe', title: 'Safe zone' }));
    // the mirror app plays a video full screen over everything, whatever its box: show that honestly (pointer events pass through)
    if (this.edit.pane.widgets.some((w) => w.type === 'video')) {
      overlay.append(h('div', { class: 'vidfull' }, h('span', { text: 'On the mirror the video plays full screen, over everything on this pane' })));
    }
    this.edit.pane.widgets.forEach((w) => {
      overlay.append(h('div', { class: 'box', 'data-id': w.id, title: 'Covered by another widget? Click it again (or Alt-click) to select the one underneath.' },
        h('span', { class: 'tagname', text: this._label(w) }),
        h('span', { class: 'why' }),
        h('button', { class: 'x', title: 'Remove' }, icon('x')),
        h('button', { class: 'eye', title: 'Preview this widget on or off (Auto, then Hidden, then Shown). Only changes the preview; nothing is saved.' }, icon('eye')),
        ['nw', 'ne', 'sw', 'se'].map((c) => h('span', { class: 'handle', 'data-h': c }))));
    });
    this._syncOverlay();
  }

  _syncOverlay() {
    if (!this.edit || this._dragging) return;
    const overlay = this.$('overlay');
    overlay.classList.toggle('jiggle', this.edit.selected.length === 0);
    const byId = new Map(this.edit.pane.widgets.map((w) => [w.id, w]));
    overlay.querySelectorAll('.box').forEach((box) => {
      const w = byId.get(box.dataset.id);
      if (!w) return;
      const r = this._rectOf(w);
      box.style.left = r.x + 'px'; box.style.top = r.y + 'px'; box.style.width = r.w + 'px'; box.style.height = Math.max(r.h, 36) + 'px';
      box.classList.toggle('ghost', r.ghost);
      this._syncEye(box, w);
      box.classList.toggle('sel', this.edit.selected.includes(w.id));
      this.$('overlay').classList.toggle('multi', this.edit.selected.length > 1);
      const entityIds = this._boundIds(w.id);
      const explain = r.ghost && entityIds.length > 0 && !this.edit.sample.has(w.id);
      const opts = w.options || {};
      const noMedia = (w.type === 'image' && !opts.media && !opts.asset && !this._boundIds(w.id).length) || (w.type === 'slideshow' && !opts.folder) || (w.type === 'video' && !opts.media && !(opts.sources || []).length);
      const needs = this._useMock(w) ? '' : ops.missingBinding(w, this.edit.bindings[w.id], this.state.registry);
      const status = this.renderer.statusOf(w.id);
      const ruleOff = !!status && status.state === 'off' && status.why === 'rule';         // switched off by its Show when rule
      box.classList.toggle('bound', explain || noMedia || ruleOff || !!needs);
      if (explain || noMedia || ruleOff || needs) {
        const why = box.querySelector('.why');
        const text = ruleOff ? 'Off right now: its Show when rule does not hold. Use the eye to preview it on.'
          : needs ? needs.charAt(0).toUpperCase() + needs.slice(1) + '. Pick it in the panel on the right.'
          : noMedia ? (w.type === 'video' ? 'Choose a video in the panel on the right' : w.type === 'slideshow' ? 'Type a photo folder in the panel on the right' : 'Choose a picture in the panel on the right')
            : ops.whyEmpty(w.type, entityIds, (this._hass && this._hass.states) || {});
        if (why.textContent !== text) why.textContent = text;
      }
    });
  }

  // ---------------------------------------------------------------- dragging
  _pointerDown(e) {
    if (!this.edit || e.button > 0) return;
    const box = e.target.closest('.box');
    if (!box) { this._selectWidgets([]); return; }
    const id = box.dataset.id;
    if (e.target.closest('.x')) { this._removeWidgets([id]); e.preventDefault(); return; }
    if (e.target.closest('.eye')) { this._cycleForce(id); e.preventDefault(); return; }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let sel = this.edit.selected;
    // Widgets can sit on top of each other (an empty one, like Now playing with nothing playing, is easily covered by the one that slid up
    // into its place). Everything under the pointer, in a fixed order, so clicking again steps through all of them.
    const order = new Map(this.edit.pane.widgets.map((x, i) => [x.id, i]));
    const under = this.shadowRoot.elementsFromPoint(e.clientX, e.clientY)
      .filter((n) => n.classList && n.classList.contains('box')).map((n) => n.dataset.id).sort((a, b) => order.get(a) - order.get(b));
    const stacked = under.length > 1 && !additive ? under : null;
    if (e.altKey && stacked) {                                           // Alt-click: straight to the next one underneath
      const at = sel.length === 1 ? stacked.indexOf(sel[0]) : -1;
      this._selectWidgets([stacked[(at + 1) % stacked.length]]);
      e.preventDefault();
      return;
    }
    const cycle = stacked && sel.length === 1 && sel[0] === id ? stacked : null;   // a plain click on the one already selected
    if (additive) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else if (!sel.includes(id)) sel = [id];
    this._selectWidgets(sel);
    if (!sel.includes(id)) return;
    const handle = e.target.closest('.handle');
    const rects = new Map();
    sel.forEach((sid) => { const w = this.edit.pane.widgets.find((x) => x.id === sid); if (w) rects.set(sid, this._rectOf(w)); });
    this._drag = { mode: handle ? 'resize' : 'move', handle: handle && handle.dataset.h, id, x: e.clientX, y: e.clientY, rects, active: false, cycle };
    try { this.$('overlay').setPointerCapture(e.pointerId); } catch (err) { /* the drag still works without capture */ }
    e.preventDefault();
  }

  _pointerMove(e) {
    const d = this._drag;
    if (!d) return;
    const dx = (e.clientX - d.x) / this._scale, dy = (e.clientY - d.y) / this._scale;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.active = true; this._dragging = true;
      this.$('overlay').classList.remove('jiggle');
    }
    const overlay = this.$('overlay');
    const widgets = this.edit.pane.widgets;
    d.rects.forEach((rect, id) => {
      if (d.mode === 'resize' && id !== d.id) return;
      const w = widgets.find((x) => x.id === id);
      const box = overlay.querySelector('.box[data-id="' + id.replace(/"/g, '') + '"]');
      if (!w || !box) return;
      const next = d.mode === 'move' ? ops.moved(w, rect, dx, dy, this._grid(), ops.followsAny(w, [...d.rects.keys()])) : ops.resized(w, rect, d.handle, dx, dy, this._grid());
      const hh = next.auto_height ? rect.h : next.h;
      box.classList.add('dragging');
      box.style.left = next.x + 'px'; box.style.top = next.y + 'px'; box.style.width = next.w + 'px'; box.style.height = Math.max(hh, 36) + 'px';
      // the real widget follows a move (a transform only: nothing is saved and nothing re-renders until the drop)
      if (d.mode === 'move') {
        const real = this.$('stage').querySelector('[data-widget="' + id.replace(/"/g, '') + '"]');
        if (real) { real.style.translate = (next.x - rect.x) + 'px ' + (next.y - rect.y) + 'px'; d.moved = d.moved || new Set(); d.moved.add(real); }
      }
    });
  }

  _pointerUp(e, cancelled) {
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    try { this.$('overlay').releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    this._dragging = false;
    if (d.moved) d.moved.forEach((el) => { el.style.translate = ''; });
    if (!d.active || cancelled) {
      if (!cancelled && !d.active && d.cycle && !d.handle) this._selectWidgets([d.cycle[(d.cycle.indexOf(d.id) + 1) % d.cycle.length]]);   // clicked again, did not drag: the next one underneath
      this._buildOverlay();
      return;
    }
    const dx = (e.clientX - d.x) / this._scale, dy = (e.clientY - d.y) / this._scale;
    const pane = clone(this.edit.pane);
    pane.widgets = pane.widgets.map((w) => {
      const rect = d.rects.get(w.id);
      if (!rect) return w;
      if (d.mode === 'resize') return w.id === d.id ? ops.resized(w, rect, d.handle, dx, dy, this._grid()) : w;
      return ops.moved(w, rect, dx, dy, this._grid(), ops.followsAny(w, [...d.rects.keys()]));
    });
    this._commit(pane);
  }

  _keyDown(e) {
    if (!this.edit) return;
    const t = e.composedPath()[0];
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this._redo(); else this._undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this._redo(); return; }
    if (e.key === 'Escape') { if (this.$('drawer').classList.contains('open')) this._closeDrawer(); else this._selectWidgets([]); return; }
    const sel = this.edit.selected;
    if (!sel.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this._removeWidgets(sel); return; }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step) {
      e.preventDefault();
      const pane = clone(this.edit.pane);
      pane.widgets = pane.widgets.map((w) => (sel.includes(w.id) ? ops.moved(w, this._rectOf(w), step[0] * (this._grid() || 1), step[1] * (this._grid() || 1), this._grid(), ops.followsAny(w, sel)) : w));
      this._commit(pane);
    }
  }

  // ---------------------------------------------------------------- changing widgets
  _widget(id) { return this.edit.pane.widgets.find((w) => w.id === id); }

  _patch(id, fn) {
    const pane = clone(this.edit.pane);
    const w = pane.widgets.find((x) => x.id === id);
    if (!w) return;
    fn(w);
    this._commit(pane);
  }

  _removeWidgets(ids) {
    const pane = clone(this.edit.pane), bindings = clone(this.edit.bindings);
    ids.forEach((id) => { pane.widgets = ops.removeWidget(pane.widgets, id); delete bindings[id]; });
    this.edit.selected = [];
    this._commit(pane, bindings);
  }

  /**
   * "More options": every option of the widget's type that has no hand-made control above, built from the pane schema
   * (ops.optionFields). The schema is fetched once; until it arrives the section is simply not there.
   */
  /** The Time zone box of a Clock or Date widget: type a place (the browser suggests the names), or leave it empty for the display's own zone. */
  _timezoneField(box, w) {
    let zones;
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney', 'UTC']; }
    const current = (w.options || {}).timezone || '';
    const input = h('input', { class: 'field', type: 'text', list: 'gp-tzlist', 'data-option': 'timezone', value: current, autocomplete: 'off', spellcheck: 'false',
      placeholder: 'The display’s own time zone',
      onChange: () => {
        const v = input.value.trim();
        if (v && !validZone(v)) { this.toast('“' + v + '” is not a time zone name. Try one like America/Chicago.', true); input.value = current; return; }
        this._patch(w.id, (x) => { x.options = { ...(x.options || {}) }; if (!v) delete x.options.timezone; else x.options.timezone = v; });
      } });
    box.append(h('label', { class: 'lbl', text: 'Time zone' }), input,
      h('datalist', { id: 'gp-tzlist' }, zones.map((z) => h('option', { value: z }))),
      h('div', { class: 'hint', text: 'Empty shows the display’s own time zone. Type a place such as America/Chicago or Asia/Tokyo; the list suggests names.' }));
  }

  _moreOptions(box, w) {
    if (!this._schemaDefs) {
      if (!this._schemaLoading) {
        this._schemaLoading = fetch('/glass_panes/schema/pane.schema.json').then((r) => r.json())
          .then((s) => { this._schemaDefs = s.$defs || {}; this._renderInspector(); }).catch(() => { this._schemaLoading = null; });
      }
      return;
    }
    const skip = ['text', 'lines', 'media', 'asset', 'sources', 'folder', 'icon', 'columns']
      .concat((TOGGLES[w.type] || []).map((t) => t[0]), (CHOICES[w.type] || []).map((c) => c[0]), w.type === 'clock' || w.type === 'date' ? ['timezone'] : []);
    const fields = ops.optionFields(this._schemaDefs['opt_' + w.type], skip);
    if (!fields.length) return;
    const opts = w.options || {};
    const apply = (f, raw) => {
      const v = ops.optionValue(f, raw);
      if (v === null) { this.toast(f.label + ': that does not fit. ' + f.hint); this._renderInspector(); return; }
      this._patch(w.id, (x) => { x.options = { ...(x.options || {}) }; if (v === undefined) delete x.options[f.key]; else x.options[f.key] = v; });
    };
    const shown = (f) => (opts[f.key] !== undefined ? opts[f.key] : f.dflt);
    const words = (v) => String(v).replace(/_/g, ' ');
    // remember open/closed the moment the heading is clicked (the 'toggle' event comes a little later, and a quick edit
    // re-draws the inspector before it: the section would close under the person's hands)
    const more = h('details', { class: 'more', open: this._moreOpen === true },
      h('summary', { class: 'lbl', text: 'More options (' + fields.length + ')', onClick: () => { this._moreOpen = !more.open; } }));
    more.addEventListener('toggle', () => { if (more.isConnected) this._moreOpen = more.open; });
    fields.forEach((f) => {
      const row = h('div', { class: 'opt', 'data-opt': f.key });
      if (f.kind === 'bool') {
        row.append(h('label', { class: 'check', title: f.hint }, h('input', { type: 'checkbox', checked: !!shown(f), onChange: (ev) => apply(f, ev.target.checked) }), f.label));
      } else {
        row.append(h('label', { class: 'lbl', text: f.label }));
        if (f.kind === 'enum') {
          const cur = shown(f);
          row.append(h('select', { class: 'field', onChange: (ev) => (ev.target.value === '' ? apply(f, undefined) : apply(f, ev.target.value)) },
            f.dflt === undefined ? h('option', { value: '', text: 'Default', selected: cur === undefined }) : null,
            f.values.map((v, i) => h('option', { value: i, selected: v === cur, text: words(v) + (v === f.dflt ? ' (default)' : '') }))));
        } else if (f.kind === 'int' || f.kind === 'number') {
          row.append(h('input', { class: 'field', type: 'number', min: f.min, max: f.max, step: f.kind === 'int' ? 1 : 'any', value: opts[f.key] !== undefined ? opts[f.key] : '',
            placeholder: f.dflt !== undefined ? String(f.dflt) : 'Auto', onChange: (ev) => apply(f, ev.target.value) }));
        } else if (f.kind === 'text') {
          row.append(h('input', { class: 'field', type: 'text', maxlength: f.max, value: opts[f.key] || '', placeholder: f.dflt !== undefined ? String(f.dflt) : '', onChange: (ev) => apply(f, ev.target.value) }));
        } else if (f.kind === 'multi') {
          const cur = shown(f) || [];
          row.append(h('div', { class: 'grid2' }, f.values.map((v) => h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: cur.includes(v), onChange: (ev) => apply(f, ev.target.checked ? cur.concat(v) : cur.filter((x) => x !== v)) }), words(v)))));
        } else if (f.kind === 'list') {
          row.append(h('textarea', { class: 'field', rows: 3, placeholder: 'One per line', onChange: (ev) => apply(f, ev.target.value) }, (opts[f.key] || []).join('\n')));
        }
        if (f.hint) row.append(h('div', { class: 'hint', text: f.hint }));
      }
      more.append(row);
    });
    box.append(more);
  }

  /** Bring a widget over ('up') or under ('down') the widgets it overlaps, as one undoable step (ops.restacked). */
  _restack(id, dir) {
    if (!this.edit) return;
    const pane = clone(this.edit.pane);
    const rects = new Map(pane.widgets.map((w) => [w.id, this._rectOf(w)]));
    pane.widgets = ops.restacked(pane.widgets, id, rects, dir);
    this._commit(pane);
  }

  _duplicateWidgets(ids) {
    const pane = clone(this.edit.pane), bindings = clone(this.edit.bindings);
    const made = [];
    ids.forEach((id) => {
      const src = pane.widgets.find((w) => w.id === id);
      if (!src) return;
      const copy = clone(src);
      copy.id = ops.uniqueWidgetId(src.id, pane.widgets);
      delete copy.flow;
      const rect = this._rectOf(src);
      copy.x = Math.min(ops.snap(rect.x + (this._grid() || ops.GRID), this._grid()), ops.CANVAS_W - copy.w); copy.y = Math.min(ops.snap(rect.y + (this._grid() || ops.GRID), this._grid()), ops.CANVAS_H - copy.h);
      pane.widgets.push(copy);
      if (bindings[id]) bindings[copy.id] = clone(bindings[id]);
      made.push(copy.id);
    });
    this.edit.selected = made;
    this._commit(pane, bindings);
  }

  _align(mode) {
    const e = this.edit;
    if (e.selected.length < 2) return;
    const rects = {};
    e.selected.forEach((id) => { const w = this._widget(id); if (w) rects[id] = this._rectOf(w); });
    const pane = clone(e.pane);
    pane.widgets = ops.keptOnCanvas(ops.aligned(pane.widgets, e.selected, rects, mode));
    this._commit(pane);
  }

  _addWidget(type, label, entityId, slot, kind) {
    const pane = clone(this.edit.pane), bindings = clone(this.edit.bindings);
    const made = ops.newWidget(type, label, pane.widgets, entityId, slot, kind, this._grid());
    pane.widgets.push(made.widget);
    if (hasBinding(made.binding)) bindings[made.widget.id] = made.binding;
    this.edit.selected = [made.widget.id];
    this._commit(pane, bindings);
    this._closeDrawer();
    this.toast('Added ' + label);
  }

  _bindEntity(widgetId, slot, kind, entityId) {
    const bindings = clone(this.edit.bindings);
    const cur = bindings[widgetId] || {};
    if (kind === 'entity') cur[slot] = entityId;
    else cur[slot] = [...new Set([...(Array.isArray(cur[slot]) ? cur[slot] : []), entityId])];
    bindings[widgetId] = cur;
    this._commit(clone(this.edit.pane), bindings);
    this._closeDrawer();
  }

  _unbind(widgetId, slot, entityId) {
    const bindings = clone(this.edit.bindings);
    const cur = bindings[widgetId] || {};
    if (Array.isArray(cur[slot])) cur[slot] = cur[slot].filter((v) => (typeof v === 'string' ? v : v.entity) !== entityId);
    else delete cur[slot];
    if (hasBinding(cur)) bindings[widgetId] = cur; else delete bindings[widgetId];
    this._commit(clone(this.edit.pane), bindings);
  }

  // ---------------------------------------------------------------- the inspector (the panel on the right)
  /** A readable label for a widget: its name, or its kind plus a hint of what it shows (ops.widgetLabel). */
  _label(w) {
    if (!w) return '';
    const b = this.edit ? (this.edit.bindings[w.id] || {}) : {};
    const first = Object.values(b).map((v) => (Array.isArray(v) ? v[0] : v)).find((v) => typeof v === 'string' || (v && v.entity));
    return ops.widgetLabel(w, this.state.registry, first ? this._friendly(typeof first === 'string' ? first : first.entity) : null);
  }

  _friendly(id) {
    const s = this._hass && this._hass.states[id];
    return (s && s.attributes && s.attributes.friendly_name) || id;
  }

  _renderInspector() {
    const box = this.$('inspector');
    box.textContent = '';
    if (!this.edit) return;
    if (!this.edit.selected.length) { this._renderAddPanel(box); return; }
    const sel = this.edit.selected.map((id) => this._widget(id)).filter(Boolean);
    if (sel.length > 1) {
      box.append(h('h3', { text: sel.length + ' items selected' }), h('div', { class: 'hint', text: 'Line them up, or press Delete to remove them.' }),
        h('div', { class: 'grid2', style: 'margin-top:12px' }, ALIGN_BUTTONS.map(([mode, label]) => h('button', { class: 'btn sm', onClick: () => this._align(mode) }, icon(mode), label.replace('Align ', '').replace('Space evenly ', 'Spread ')))),
        h('div', { class: 'row', style: 'margin-top:14px' },
          h('button', { class: 'btn sm', onClick: () => this._duplicateWidgets(this.edit.selected) }, icon('copy'), 'Duplicate'),
          h('button', { class: 'btn sm danger', onClick: () => this._removeWidgets(this.edit.selected) }, icon('trash'), 'Remove')),
        this._saveGroupBox());
      return;
    }
    const w = sel[0];
    if (!w) return;
    const reg = this.state.registry[w.type] || { label: w.type, slots: {} };
    const rect = this._rectOf(w);
    const style = w.style || {};
    const number = (label, value, apply, extra) => h('div', {}, h('label', { class: 'lbl', text: label }),
      h('input', { class: 'field', type: 'number', value: Math.round(value), step: 10, ...(extra || {}), onChange: (ev) => { const v = parseFloat(ev.target.value); if (!isNaN(v)) apply(v); } }));
    // typed numbers: pin the widget where it is shown, then apply the one number that changed
    const setBox = (k) => (v) => this._patch(w.id, (x) => {
      const r = this._rectOf(w);
      const next = { x: r.x, y: r.y, w: r.w, h: x.auto_height ? x.h : r.h, [k]: Math.round(v) };
      next.w = Math.max(40, Math.min(next.w, ops.CANVAS_W)); next.h = Math.max(10, Math.min(next.h, ops.CANVAS_H));
      next.x = Math.max(0, Math.min(next.x, ops.CANVAS_W - next.w)); next.y = Math.max(0, Math.min(next.y, ops.CANVAS_H - next.h));
      delete x.flow;
      x.x = next.x; x.y = next.y; x.w = next.w; x.h = next.h;
      if (k === 'h') delete x.auto_height;
    });
    const setStyle = (k, v) => this._patch(w.id, (x) => { x.style = { ...(x.style || {}) }; if (v === '' || v == null) delete x.style[k]; else x.style[k] = v; if (!Object.keys(x.style).length) delete x.style; });
    const setOpt = (k, v) => this._patch(w.id, (x) => { x.options = { ...(x.options || {}) }; x.options[k] = v; });

    box.append(h('button', { class: 'btn sm ghost backlink', onClick: () => this._selectWidgets([]) }, '← Add something'));
    const shownName = this._label(w), typeName = reg.label || w.type;
    box.append(
      h('h3', { text: shownName }),
      ...(shownName.trim().toLowerCase() !== String(typeName).trim().toLowerCase() ? [h('div', { class: 'sub', text: typeName })] : []),      // the type only when the name differs
      h('div', { class: 'wactions' },
        h('button', { class: 'btn sm', title: 'Bring forward (over what it overlaps)', 'data-act': 'front', onClick: () => this._restack(w.id, 'up') }, icon('front'), 'Forward'),
        h('button', { class: 'btn sm', title: 'Send back (under what it overlaps)', 'data-act': 'back', onClick: () => this._restack(w.id, 'down') }, icon('back'), 'Back'),
        h('button', { class: 'btn sm', title: 'Duplicate', onClick: () => this._duplicateWidgets([w.id]) }, icon('copy'), 'Copy'),
        h('button', { class: 'btn sm danger', title: 'Remove', onClick: () => this._removeWidgets([w.id]) }, icon('trash'), 'Remove')),
      h('label', { class: 'lbl', text: 'Name' }), h('input', { class: 'field', value: w.name || '', maxlength: 80, onChange: (ev) => this._patch(w.id, (x) => { x.name = ev.target.value; }) }));

    if (w.type === 'text') {
      box.append(h('label', { class: 'lbl', text: 'Text' }), h('textarea', { class: 'field', rows: 3, onChange: (ev) => setOpt('text', ev.target.value) }, (w.options || {}).text || ''));
    }
    if (w.type === 'icon' || w.type === 'entity_value') {
      const current = (w.options || {}).icon || '';
      box.append(h('label', { class: 'lbl', text: 'Icon' }), iconField(h, {
        value: current, auto: true, emptyLabel: w.type === 'icon' ? 'The entity’s own icon, if one is bound' : 'No icon',
        onPick: (name) => this._patch(w.id, (x) => { x.options = { ...(x.options || {}) }; if (name) x.options.icon = name; else delete x.options.icon; }),
      }));
    }
    if (w.type === 'table') this._tableColumns(box, w);
    if (w.type === 'message') {
      box.append(h('label', { class: 'lbl', text: 'Lines (one per line)' }),
        h('textarea', { class: 'field', rows: 4, onChange: (ev) => setOpt('lines', ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean)) }, ((w.options || {}).lines || []).join('\n')));
    }

    if (w.type === 'image' || w.type === 'video') box.append(this._mediaPicker(w));
    if (w.type === 'slideshow') {
      const folder = (w.options || {}).folder || '';
      const input = h('input', { class: 'field', type: 'text', value: folder, placeholder: 'photos/family', maxlength: 240, spellcheck: false,
        onChange: (ev) => { const v = ev.target.value.trim(); this._patch(w.id, (x) => { x.options = { ...(x.options || {}) }; if (v) x.options.folder = v; else delete x.options.folder; }); } });
      box.append(h('label', { class: 'lbl', text: 'Photo folder' }), input,
        h('div', { class: 'hint', text: 'A folder inside a Home Assistant media folder (Settings, System, Storage shows your network storage; it appears under /media). Photos are shrunk to this widget’s size before the mirror gets them, so full-size photos are fine.' }));
    }

    // what feeds this widget
    Object.entries(reg.slots || {}).forEach(([slot, def]) => {
      const value = ((this.edit.bindings[w.id] || {})[slot]);
      const list = Array.isArray(value) ? value : value ? [value] : [];
      box.append(h('label', { class: 'lbl', text: def.label || slot }));
      if (def.kind === 'checks') {
        box.append(warningsEditor({
          h, icon, checks: list, friendly: (id) => this._friendly(id),
          add: () => this._openDrawer('bind', { id: w.id, slot, def }),
          edit: (fn) => {
            const bindings = clone(this.edit.bindings), cur = bindings[w.id] || {};
            const rows = (Array.isArray(cur[slot]) ? cur[slot] : []).map(asCheck);
            fn(rows);
            const kept = rows.map((r) => (Object.keys(r).length === 1 ? r.entity : r));          // a check with only an entity goes back to a plain id
            if (kept.length) cur[slot] = kept; else delete cur[slot];
            if (hasBinding(cur)) bindings[w.id] = cur; else delete bindings[w.id];
            this._commit(clone(this.edit.pane), bindings);
          },
        }));
        return;
      }
      box.append(h('div', { class: 'chips' }, list.map((v) => { const id = typeof v === 'string' ? v : v.entity; return h('span', { class: 'chip' }, h('span', { text: this._friendly(id), title: id }), h('button', { title: 'Remove', onClick: () => this._unbind(w.id, slot, id) }, icon('x'))); })));
      box.append(h('button', { class: 'btn sm', onClick: () => this._openDrawer('bind', { id: w.id, slot, def }) }, icon('plus'), def.kind === 'entity' ? (list.length ? 'Change' : 'Choose entity') : 'Add entity'));
    });

    const toggles = TOGGLES[w.type];
    if (toggles) {
      box.append(h('label', { class: 'lbl', text: 'Show' }));
      toggles.forEach(([key, label, dflt]) => {
        const on = (w.options || {})[key] === undefined ? dflt : !!(w.options || {})[key];
        const input = h('input', { type: 'checkbox', onChange: () => setOpt(key, input.checked) });
        input.checked = on;
        box.append(h('label', { class: 'check' }, input, label));
      });
    }

    // pick-one options (for example Now playing's Look). Choosing the default removes the option so the pane file stays tidy.
    (CHOICES[w.type] || []).forEach(([key, label, values, dflt, when]) => {
      if (when && !when(w.options || {})) return;          // a choice that only matters for some looks (the clock face) appears with them
      const current = (w.options || {})[key] || dflt;
      box.append(h('label', { class: 'lbl', text: label }),
        h('select', { class: 'field', 'data-option': key, onChange: (ev) => this._patch(w.id, (x) => { x.options = { ...(x.options || {}) }; if (ev.target.value === dflt) delete x.options[key]; else x.options[key] = ev.target.value; }) },
          values.map(([v, text]) => h('option', { value: v, selected: v === current, text }))));
    });

    if (w.type === 'clock' || w.type === 'date') this._timezoneField(box, w);

    if (!['divider', 'image', 'video'].includes(w.type)) {
      box.append(h('div', { class: 'section', text: 'Text style' }),
        h('label', { class: 'lbl', text: 'Font' }),
        h('select', { class: 'field', id: 'fontpick', onChange: (ev) => setStyle('font', ev.target.value || null) },
          h('option', { value: '', text: 'Default' }), FONT_CHOICES.map(([v, name]) => h('option', { value: v, selected: style.font === v, text: name }))),
        h('div', { class: 'grid2' }, number('Size', style.size || 32, (v) => setStyle('size', Math.max(8, Math.min(400, Math.round(v)))), { step: 2 }),
          h('div', {}, h('label', { class: 'lbl', text: 'Weight' }),
            h('select', { class: 'field', onChange: (ev) => setStyle('weight', ev.target.value ? parseInt(ev.target.value, 10) : null) },
              h('option', { value: '', text: 'Default' }), [200, 300, 400, 500, 700].map((n) => h('option', { value: n, selected: style.weight === n, text: n }))))),
        h('label', { class: 'lbl', text: 'Colour' }),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' },
          h('select', { class: 'field', style: 'flex:1', onChange: (ev) => setStyle('color', ev.target.value || null) },
            h('option', { value: '', text: 'Default' }), COLORS.map((c) => h('option', { value: c, selected: style.color === c, text: c })),
            style.color && !COLORS.includes(style.color) ? h('option', { value: style.color, selected: true, text: style.color }) : null),
          // any colour: the browser's own colour picker, stored as #rrggbb
          h('input', { type: 'color', class: 'swatch', title: 'Pick any colour', value: HEX6.test(style.color || '') ? style.color : '#ffffff', onChange: (ev) => setStyle('color', ev.target.value.toLowerCase()) })),
        this._readabilityNote(w),
        h('label', { class: 'lbl', text: 'Alignment' }),
        h('div', { class: 'seg' }, ['left', 'center', 'right'].map((a) => h('button', { class: (style.align || 'left') === a ? 'on' : '', onClick: () => setStyle('align', a === 'left' ? null : a), text: a }))),
        h('details', { class: 'fold textmore', open: this._textOpen === true }, h('summary', { class: 'hint', text: 'More text options', onClick: (ev) => { this._textOpen = !ev.currentTarget.parentElement.open; } }),      // stays open while you edit
        h('div', { class: 'grid2', style: 'margin-top:8px' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!style.italic, onChange: (ev) => setStyle('italic', ev.target.checked || null) }), 'Italic'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!style.uppercase, onChange: (ev) => setStyle('uppercase', ev.target.checked || null) }), 'ALL CAPS')),
        h('div', { class: 'grid2' },
          h('div', {}, h('label', { class: 'lbl', text: 'Letter spacing (px)' }),
            h('input', { class: 'field', type: 'number', min: -10, max: 40, step: 0.5, value: style.letter_spacing != null ? style.letter_spacing : 0,
              onChange: (ev) => { const v = parseFloat(ev.target.value); setStyle('letter_spacing', isNaN(v) || v === 0 ? null : Math.max(-10, Math.min(40, v))); } })),
          h('div', {}, h('label', { class: 'lbl', text: 'Line height' }),
            h('input', { class: 'field', type: 'number', min: 0.8, max: 3, step: 0.05, value: style.line_height != null ? style.line_height : '', placeholder: 'Auto',
              onChange: (ev) => { const v = parseFloat(ev.target.value); setStyle('line_height', isNaN(v) ? null : Math.max(0.8, Math.min(3, v))); } })))));
    }
    if (w.type !== 'video') {
      const pct = Math.round((style.opacity == null ? 1 : style.opacity) * 100);
      const out = h('span', { class: 'hint', text: pct + '%' });
      box.append(h('label', { class: 'lbl', text: 'Opacity' }),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:nowrap' },
          h('input', { type: 'range', min: 10, max: 100, step: 5, value: pct, style: 'flex:1',
            onInput: (ev) => { out.textContent = ev.target.value + '%'; },
            onChange: (ev) => { const v = parseInt(ev.target.value, 10); setStyle('opacity', v >= 100 ? null : v / 100); } }), out));
    }

    box.append(h('label', { class: 'lbl', text: 'Position and size' }),
      h('div', { class: 'grid2' }, number('X', rect.x, setBox('x')), number('Y', rect.y, setBox('y')), number('Width', rect.w, setBox('w')), number('Height', rect.h, setBox('h'))),
      h('div', { class: 'hint', style: 'margin-top:6px', text: (this._grid() ? 'Snaps to a ' + this._grid() + ' px grid when you drag.' : 'Grid is off: drags land on any pixel.') + ' Type a number for an exact spot.' }));


    // "Show when" and the layout rules: folded away until needed, open by itself when this widget already uses one (or after you opened it)
    const inUse = !!w.show_when || !!w.flow || !!w.auto_height || w.when_hidden != null;
    const rules = h('details', { class: 'fold rulesbox', open: inUse || this._rulesOpen === true },
      h('summary', { onClick: (ev) => { this._rulesOpen = !ev.currentTarget.parentElement.open; } }, h('span', { class: 'lbl', style: 'display:inline;margin:0', text: 'Show when and layout' })));
    if (w.type === 'video') rules.append(h('div', { class: 'hint', style: 'margin-top:12px', text: 'A looping video is played by the display app itself, so it cannot be switched on and off by rules. Put it on its own pane.' }));
    else rules.append(ruleSection(this._ruleCtx(w)));

    if (this._boundIds(w.id).length) {
      const sample = h('input', { type: 'checkbox', onChange: () => { if (sample.checked) this.edit.sample.add(w.id); else this.edit.sample.delete(w.id); this._draw(); } });
      sample.checked = this.edit.sample.has(w.id);
      rules.append(h('label', { class: 'check', style: 'margin-top:12px', title: 'Only for this preview. Nothing is saved.' }, sample, 'Preview with sample data'));
    }
    box.append(rules);
    // colours and sizes that change with the entity's value (only for a widget that has an `entity` slot to look at)
    const slots = ((this.state.registry || {})[w.type] || {}).slots || {};
    const styled = styleRulesSection({ ...this._ruleCtx(w), styleOpen: this._styleOpen === w.id, setStyleOpen: (on) => { this._styleOpen = on ? w.id : null; } }, !!slots.entity && slots.entity.kind === 'entity');
    if (styled) box.append(styled);
    this._moreOptions(box, w);
  }

  // ---------------------------------------------------------------- "Show when" rules and the preview on/off controls (rules-ui.js draws them)
  // The preview controls (Auto / Shown / Hidden) never touch the pane or the bindings: they live in this.state.forceByPane only.

  _forceMap() { const p = this.state.pane; return (p && (this.state.forceByPane || {})[p.id]) || {}; }

  _setForce(id, mode) {
    const p = this.state.pane;
    if (!p) return;
    const all = this.state.forceByPane || (this.state.forceByPane = {});
    const map = { ...(all[p.id] || {}) };
    if (mode === 'show' || mode === 'hide') map[id] = mode; else delete map[id];
    all[p.id] = map;
    if (this.renderer) this.renderer.setForce(map);                     // no redraw: the engine just lays out again
    this._syncOverlay();
    if (this.edit) this._renderInspector();
    this._renderForceMenu();
  }

  _cycleForce(id) { const next = { undefined: 'hide', hide: 'show', show: null }[this._forceMap()[id]]; this._setForce(id, next || null); }

  // the little eye on a widget's box shows the preview state and whether the widget has a rule
  _syncEye(box, w) {
    const mode = this._forceMap()[w.id] || '';
    const status = this.renderer && this.renderer.statusOf(w.id);
    box.classList.toggle('ruled', usesRules(w) || !!mode);
    box.classList.toggle('off', !!status && status.state === 'off');
    const eye = box.querySelector('.eye');
    if (eye && eye.dataset.mode !== mode) eye.dataset.mode = mode;
  }

  // the facts the Show when section needs about one widget
  _ruleCtx(w) {
    const e = this.edit;
    const slotEntity = (slot) => ((e.bindings[w.id] || {})[slot]);
    return {
      h, icon, w, widgets: e.pane.widgets, rect: this._rectOf(w), label: (x) => this._label(x),
      entityName: (slot) => { const id = slotEntity(slot); return id ? this._friendly(typeof id === 'string' ? id : id.entity) : null; },
      chooseEntity: (slot) => this._openDrawer('bind', { id: w.id, slot, def: { kind: 'entity', domains: [], label: 'Entity for this condition' } }),
      edit: (fn) => this._editRule(w.id, fn),
      open: this._ruleOpen === w.id, setOpen: (on) => { this._ruleOpen = on ? w.id : null; this._renderInspector(); },
      force: this._forceMap()[w.id] || 'auto',
      setForce: (mode) => this._setForce(w.id, mode),
      status: this.renderer && this.renderer.statusOf(w.id),
    };
  }

  // change a widget's rule (and, with it, the bindings of its entity conditions) as one undoable step; flow.show_if is folded into the rule first
  _editRule(id, fn) {
    const pane = clone(this.edit.pane), bindings = clone(this.edit.bindings);
    const at = pane.widgets.findIndex((x) => x.id === id);
    if (at < 0) return;
    pane.widgets[at] = foldShowIf(pane.widgets[at]);
    fn(pane.widgets[at], bindings);
    this._commit(pane, bindings);
  }

  // Preview on/off for every widget that can change, reachable without editing too (the "viewer" side of the same control)
  _renderForceMenu() {
    const menu = this.shadowRoot.getElementById('rulemenu');
    if (!menu) return;
    const pane = this._shownPane();
    menu.textContent = '';
    (pane ? pane.widgets : []).filter((w) => usesRules(w) || w.auto_height).forEach((w) => {
      menu.append(h('div', { class: 'item' }, h('span', { class: 'name', text: this._label(w) }), forceControl(h, this._forceMap()[w.id], (mode) => this._setForce(w.id, mode))));
    });
  }

  _forceButton() {
    const pane = this._shownPane();
    if (!pane || !pane.widgets.some((w) => usesRules(w) || w.auto_height)) return document.createDocumentFragment();
    const menu = h('div', { class: 'rulemenu', id: 'rulemenu' });
    const btn = h('button', { class: 'btn', id: 'forcebtn', title: 'Preview widgets switched on or off. Never saved.', onClick: () => menu.classList.toggle('open') }, icon('eye'), 'Preview on/off');
    setTimeout(() => this._renderForceMenu(), 0);
    return h('div', { class: 'menuwrap' }, btn, menu);
  }

  // a warning when the text could get lost in the background
  _readabilityNote(w) {
    const st = w.style || {};
    const r = ops.readability(st.color, this.edit.pane.background, { opacity: st.opacity == null ? 1 : st.opacity, size: st.size || 32, weight: st.weight || 400, theme: this.edit.pane.theme, ownBackground: this.edit.pane.own_background === true });
    if (r.level === 'unknown') return h('div', { class: 'hint', style: 'margin-top:8px', text: 'Readability can’t be checked against this kind of background.' });
    if (r.level === 'good') return document.createDocumentFragment();
    return h('div', { class: 'warnbox ' + r.level }, h('b', { text: r.level === 'poor' ? 'Hard to see. ' : 'Might be hard to see. ' }),
      'This colour is only ' + r.ratio + ':1 against the background' + (this.edit.pane.theme ? ' (the ' + THEMES[this.edit.pane.theme].label + ' theme)' : '') + (r.level === 'low' ? ', fine for large text but not for small.' : '.') + ' Try a lighter colour, a bigger size or a darker background.');
  }

  // ---------------------------------------------------------------- uploaded pictures and videos
  // A picture or video comes from the media library. "Upload" opens the device's own chooser: on a computer a file window, on a phone
  // the photo library, the camera or the files app. The file goes to Home Assistant's upload endpoint first, then Glass Panes takes it.
  /** Width, height and (for a video) duration, read in this browser before uploading. Missing values just mean fewer checks. */
  async _measureMedia(file) {
    const kind = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name) ? 'video' : 'image';
    const info = { kind, type: file.type, name: file.name, size: file.size };
    const url = URL.createObjectURL(file);
    try {
      await Promise.race([new Promise((done) => {
        if (kind === 'video') {
          const v = document.createElement('video');
          v.preload = 'metadata'; v.muted = true;
          v.onloadedmetadata = () => { info.width = v.videoWidth; info.height = v.videoHeight; info.duration = v.duration; done(); };
          v.onerror = done; v.src = url;
        } else {
          const img = new Image();
          img.onload = () => { info.width = img.naturalWidth; info.height = img.naturalHeight; done(); };
          img.onerror = done; img.src = url;
        }
      }), new Promise((done) => setTimeout(done, 5000))]);
    } finally { URL.revokeObjectURL(url); }
    return info;
  }

  async _uploadMedia(file) {
    if (!file) return null;
    const warnings = ops.mediaWarnings(await this._measureMedia(file).catch(() => ({})));
    if (warnings.length && !confirm('A heads-up about ' + file.name + ':\n\n• ' + warnings.join('\n\n• ') + '\n\nUpload it anyway?')) return null;
    try {
      if (!this._hass.fetchWithAuth) throw new Error('This version of Home Assistant cannot upload from here');
      this.toast('Uploading ' + file.name + '…');
      const form = new FormData();
      form.append('file', file);
      const response = await this._hass.fetchWithAuth('/api/file_upload', { method: 'POST', body: form });
      if (!response.ok) throw new Error(response.status === 413 ? 'That file is too big (the limit is 100 MB)' : 'The upload failed (' + response.status + ')');
      const { file_id: fileId } = await response.json();
      const reply = await this.ws({ type: 'glass_panes/media/add', file_id: fileId, name: file.name.replace(/\.[^.]+$/, '') });
      this.state.media = reply.all;
      this.client.forgetMedia();
      this.toast('Uploaded');
      return reply.media;
    } catch (e) { this.fail(e); return null; }
  }

  async _deleteMedia(m) {
    if (this.edit && this.edit.pane.widgets.some((x) => (x.options || {}).media === m.id)) { this.toast('"' + m.name + '" is used on this pane. Choose something else for that item first.', true); return; }
    if (!confirm('Delete "' + m.name + '" from your uploads?')) return;
    try {
      const reply = await this.ws({ type: 'glass_panes/media/delete', media_id: m.id });
      this.state.media = reply.all;
      this.client.forgetMedia();
      this._renderInspector();
    } catch (e) { this.fail(e); }              // for example: a pane still uses it
  }

  _mediaPicker(w) {
    const kind = w.type === 'video' ? 'video' : 'image';
    const current = (w.options || {}).media || null;
    const pick = (id) => this._patch(w.id, (x) => { x.options = { ...(x.options || {}) }; if (id) x.options.media = id; else delete x.options.media; });
    const input = h('input', {
      type: 'file', style: 'display:none',
      accept: kind === 'video' ? 'video/mp4,video/quicktime,video/webm,video/*' : 'image/jpeg,image/png,image/webp,image/gif,image/*',
      onChange: async () => { const file = input.files && input.files[0]; input.value = ''; const made = await this._uploadMedia(file); if (made) pick(made.id); },
    });
    const items = this.state.media.filter((m) => m.kind === kind);
    const tiles = items.map((m) => h('div', { class: 'mtile' + (m.id === current ? ' on' : ''), title: m.name, onClick: () => pick(m.id) },
      kind === 'video' ? h('video', { src: m.url + '#t=0.1', muted: true, preload: 'metadata', playsinline: true }) : h('img', { src: m.url, alt: '' }),
      h('span', { class: 'mname', text: m.name }),
      h('button', { class: 'mdel', title: 'Delete this file', onClick: (ev) => { ev.stopPropagation(); this._deleteMedia(m); } }, icon('x'))));
    return h('div', {},
      h('label', { class: 'lbl', text: kind === 'video' ? 'Video' : 'Picture' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', onClick: () => input.click() }, icon('plus'), 'Upload from this device…'),
        current ? h('button', { class: 'btn sm', onClick: () => pick(null) }, 'Clear') : document.createDocumentFragment()),
      input,
      items.length ? h('div', { class: 'media-grid' }, tiles) : h('div', { class: 'hint', style: 'margin-top:8px', text: 'Nothing uploaded yet.' }),
      h('div', { class: 'hint', text: kind === 'video'
        ? 'MP4 (H.264) plays on the widest range of displays. Up to 100 MB. On a phone, this opens your photos or files.'
        : 'JPEG, PNG, WebP or GIF, up to 25 MB. On a phone, this opens your photos or files.' }));
  }

  // ---------------------------------------------------------------- the Add panel and the entity chooser
  // While editing with nothing selected, the right-hand column IS the Add panel. Choosing an entity for one widget's slot opens a slide-over.
  _renderAddPanel(box) {
    const D = this._addState || (this._addState = { mode: 'add', docked: true, tab: 'entities', query: '', open: null });
    D.host = box;
    this._renderDrawer(D);
  }

  _openDrawer(mode, target) {
    if (mode === 'add') {                                         // "+ Add": let go of the selection so the Add panel shows
      if (!this.edit) return;
      this._selectWidgets([]);
      setTimeout(() => { const q = this.$('inspector').querySelector('input'); if (q) q.focus(); }, 60);
      return;
    }
    this._drawer = { mode, target, host: this.$('drawer'), tab: 'entities', query: '', open: null };
    this._renderDrawer(this._drawer);
    this.$('scrim').classList.add('open');
    this.$('drawer').classList.add('open');
    setTimeout(() => { const q = this.$('drawer').querySelector('input'); if (q) q.focus(); }, 60);
  }

  _closeDrawer() {
    if (!this._built) return;
    this.$('scrim').classList.remove('open');
    this.$('drawer').classList.remove('open');
  }

  _renderDrawer(D = this._drawer) {
    const dr = D.host;
    dr.textContent = '';
    const bind = D.mode === 'bind';
    const search = h('input', { class: 'field', placeholder: 'Search your entities…', value: D.query, onInput: (ev) => { D.query = ev.target.value; this._renderDrawerList(D); } });
    const head = h('header', D.docked ? { style: 'padding: 0 0 8px' } : {},
      h('h2', {}, bind ? 'Choose an entity' : 'Add to this pane', D.docked ? null : h('button', { class: 'btn icon ghost', title: 'Close', onClick: () => this._closeDrawer() }, icon('x'))));
    if (!bind) {
      head.append(h('div', { class: 'seg' },
        ['entities', 'elements', 'groups'].map((t) => h('button', { class: D.tab === t ? 'on' : '', text: t === 'entities' ? 'Your entities' : t === 'groups' ? 'Groups' : 'Facets', onClick: () => { D.tab = t; this._renderDrawer(D); } }))));
    }
    if (!bind && D.docked) head.append(h('div', { class: 'hint', text: 'Drag to move, corners to resize, shift-click to pick several. The dashed line is the safe zone.' }));
    if (D.tab === 'entities') head.append(search);
    dr.append(head, h('div', { class: 'list', style: D.docked ? 'padding: 0' : '' }));
    this._renderDrawerList(D);
  }

  _renderDrawerList(D = this._drawer) {
    const list = D.host && D.host.querySelector('.list');
    if (!list) return;
    list.textContent = '';
    if (D.tab === 'groups') {
      if (!this.state.groups) { this._loadGroups(); list.append(h('div', { class: 'hint', style: 'padding:8px 6px', text: 'Loading…' })); return; }
      if (!this.state.groups.length) list.append(h('div', { class: 'hint', style: 'padding:8px 6px', text: 'No groups yet. Select two or more widgets, then press Save as a group in the panel on the right.' }));
      this.state.groups.forEach((g) => list.append(h('div', { class: 'row', 'data-group': g.id },
        h('button', { class: 'tile grow', onClick: () => this._dropGroup(g) }, h('b', { text: g.name }), h('span', { class: 'sub', text: g.widgets.length + (g.widgets.length === 1 ? ' widget' : ' widgets') })),
        h('button', { class: 'btn sm ghost danger', title: 'Delete this group', onClick: () => this._deleteGroup(g) }, icon('trash')))));
      return;
    }
    if (D.tab === 'elements') {
      list.append(h('div', { class: 'tiles' }, ops.plainElements(this.state.registry).map((el) =>
        h('button', { class: 'tile', onClick: () => this._addWidget(el.type, el.label) }, h('b', { text: el.label }), h('span', { class: 'sub', text: ELEMENT_INFO[el.type] || '' })))));
      list.append(h('div', { class: 'hint', style: 'padding:8px 6px', text: 'Facets need no entity. Widgets that show Home Assistant data (calendar, weather, sports…) come from “Your entities”: pick an entity and Glass Panes suggests the right one.' }));
      return;
    }
    const states = (this._hass && this._hass.states) || {};
    const q = D.query.trim().toLowerCase();
    const domains = D.mode === 'bind' && D.target.def.domains && D.target.def.domains.length ? D.target.def.domains : null;
    let ids = Object.keys(states).filter((id) => !domains || domains.includes(id.split('.')[0]));
    if (q) ids = ids.filter((id) => id.includes(q) || this._friendly(id).toLowerCase().includes(q));
    const rank = (id) => { const i = DOMAIN_ORDER.indexOf(id.split('.')[0]); return i < 0 ? 99 : i; };
    ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    if (!ids.length) { list.append(h('div', { class: 'empty', text: q ? 'Nothing matches “' + D.query + '”.' : 'No entities of this kind found in Home Assistant yet.' })); return; }
    const shown = ids.slice(0, q ? 120 : 80);
    let group = null;
    shown.forEach((id) => {
      const domain = id.split('.')[0];
      if (domain !== group) { group = domain; list.append(h('div', { class: 'group', text: domain.replace(/_/g, ' ') })); }
      const s = states[id];
      const cands = D.mode === 'add' ? ops.candidatesFor(id, s, this.state.registry) : [];
      const row = h('div', { class: 'ent', onClick: () => {
        if (D.mode === 'bind') { this._bindEntity(D.target.id, D.target.slot, D.target.def.kind, id); return; }
        if (cands.length === 1) { this._addWidget(cands[0].type, cands[0].label, id, cands[0].slot, cands[0].kind); return; }
        D.open = D.open === id ? null : id; this._renderDrawerList(D);
      } },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: this._friendly(id) }), h('div', { class: 'sub', text: id })), h('span', { class: 'sub', text: String(s.state).slice(0, 18) })));
      if (D.open === id && cands.length > 1) {
        row.append(h('div', { class: 'add' }, cands.map((c, i) => h('button', { class: 'btn sm' + (i === 0 ? ' primary' : ''), onClick: (ev) => { ev.stopPropagation(); this._addWidget(c.type, c.label, id, c.slot, c.kind); } }, 'Add as ' + c.label))));
      }
      list.append(row);
    });
    if (ids.length > shown.length) list.append(h('div', { class: 'hint', style: 'padding:12px 8px', text: (ids.length - shown.length) + ' more. Type in the search box to narrow it down.' }));
  }
}

if (!customElements.get('glass-panes-panel')) customElements.define('glass-panes-panel', GlassPanesPanel);      // a second load of this file (a panel reload after an update) must not throw
