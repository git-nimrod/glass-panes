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
import { MockClient, mockBindings } from '/glass_panes/player/data.js';
import { makeTime } from '/glass_panes/player/util.js';
import { CSS as PANEL_CSS } from '/glass_panes/panel/styles.js';
import * as ops from '/glass_panes/panel/ops.js';
import { THEMES } from '/glass_panes/player/themes.js';
import { ruleSection, RULES_CSS, forceControl } from '/glass_panes/panel/rules-ui.js';          // "Show when" and the preview on/off controls
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
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', check: 'M5 13l4 4L19 7',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13', copy: 'M9 9h10v10H9zM5 15V5h10',
  left: 'M4 4v16M8 8h12M8 14h7', center: 'M12 4v16M6 8h12M8 14h8', right: 'M20 4v16M4 8h12M9 14h7',
  top: 'M4 4h16M8 8v12M14 8v7', middle: 'M4 12h16M8 6v12M14 8v8', bottom: 'M4 20h16M8 4v12M14 9v7',
  'distribute-h': 'M4 4v16M20 4v16M10 8h4v8h-4z', 'distribute-v': 'M4 4h16M4 20h16M8 10v4h8v-4z',
  'same-width': 'M3 5v14M21 5v14M7 9h10M7 15h10', 'same-height': 'M5 3h14M5 21h14M9 7v10M15 7v10',
  align: 'M4 6h16M4 12h10M4 18h16', contrast: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
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
  clock: 'The time', date: 'Today’s date', text: 'Any words you type', image: 'A picture from your device', video: 'A looping video from your device',
  divider: 'A thin line between sections', message: 'Friendly lines that rotate',
};
// How the display sits in the mirror in Mirror view. Estimated from two photos of a real Lululemon Studio Mirror, so approximate, not measured:
// a very thin frame, the display close to the edges at the top and sides, a longer strip of plain glass below it (the display is roughly
// four fifths of the glass height), and an open rounded loop stand under the glass about 17% as tall as the glass.
// Shares are of the display's own width / height. One place to adjust (later this can be a per-display setting).
const MIRROR_GLASS = { left: 0.03, right: 0.03, top: 0.03, bottom: 0.22 };
const MIRROR_STAND = 0.17;                      // the loop's height as a share of the glass height
const COLORS = ['fg', 'dim', 'faint', 'accent', 'good', 'warn', 'bad'];
// the fonts a text item can use: [value in the pane file, name shown]. Same list as the schema's style.font and engine.js FONTS.
const FONT_CHOICES = [['inter', 'Inter'], ['outfit', 'Outfit'], ['jost', 'Jost'], ['space-grotesk', 'Space Grotesk'], ['jetbrains-mono', 'JetBrains Mono'],
  ['cormorant-garamond', 'Cormorant Garamond (formal serif)'], ['playfair-display', 'Playfair Display (formal serif)'], ['lora', 'Lora (book serif)'],
  ['dm-serif-display', 'DM Serif Display (headlines)'], ['montserrat', 'Montserrat'], ['system-sans', 'System sans'], ['system-serif', 'System serif'], ['system-mono', 'System mono']];
// on/off choices per widget type: [option, label, default]
const TOGGLES = {
  clock: [['show_seconds', 'Show seconds', false]],
  calendar_agenda: [['show_all_day', 'All-day events', true]],
  now_playing: [['show_art', 'Album art', true], ['burn_in_saver', 'Burn-in saver (very slow drift)', false]],
  people: [['show_avatar', 'Photos', true]],
  lights_summary: [['show_dots', 'Colour dots', true]],
  sports: [['show_logos', 'Team logos', true], ['show_next', 'Upcoming games', true], ['game_day_only', 'Only on game day', false], ['verbose_text', 'Spell out wins and losses', false]],
  news: [['show_source', 'Source name', false]],
  entity_value: [['show_label', 'Name label', true]],
};

// pick-one choices per widget type: [option, label, [[value, words], ...], default]
const CHOICES = {
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
    else if (this.state.tab === 'displays') this._renderRail(false);   // keep each display's "showing" selector in step with its select entity
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
      <style>${PANEL_CSS}${RULES_CSS}</style>
      <link rel="stylesheet" href="/glass_panes/player/player.css">
      <div class="app">
        <header class="top"><span id="menu"></span><div class="brand"><img class="logo-img" src="/glass_panes/player/logo-mark.png" alt="">Glass Panes</div><span class="spacer"></span><span id="status"></span><button class="btn sm" id="themebtn" title="Switch between the cream and dark look"></button></header>
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
            <div id="toast"></div>
          </main>
          <aside class="inspector" id="inspector"></aside>
          <div class="scrim" id="scrim"></div>
          <div class="drawer" id="drawer"></div>
        </div>
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
      b.append(icon('contrast'), dark ? 'Light mode' : 'Dark mode');            // says what a click will switch to
    };
    $('themebtn').addEventListener('click', () => { dark = !dark; applyTheme(); try { localStorage.setItem('glass_panes_dark', dark ? '1' : '0'); } catch (e) { /* ignore */ } });
    applyTheme();
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
  }

  _thumb(pane) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 1080 1920'); svg.setAttribute('preserveAspectRatio', 'none');
    const add = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); };
    add('rect', { width: 1080, height: 1920, fill: (pane && THEMES[pane.theme] && THEMES[pane.theme].bg) || (pane && pane.background) || '#000' });
    ((pane && pane.widgets) || []).forEach((w) => {
      if (w.type === 'video') add('rect', { x: w.x, y: w.y, width: w.w, height: w.h, fill: '#ffffff22' });
      else add('rect', { x: w.x, y: w.y, width: w.w, height: Math.max(w.h, 24), rx: 14, fill: w.type === 'divider' ? '#ffffff55' : '#ffffffaa', opacity: w.type === 'divider' ? 1 : 0.55 });
    });
    return svg;
  }

  _renderPanesTab(body) {
    this.state.panes.forEach((p) => {
      const label = p.source === 'user' ? (p.customized ? 'edited' : 'mine') : 'built in';
      const row = h('div', { class: 'pane' + (this.state.pane && this.state.pane.id === p.id ? ' on' : ''), onClick: () => this._guardedSelect(p.id) },
        h('div', { class: 'thumb' }, this._thumb(this.state.full[p.id])),
        h('div', { class: 'grow' }, h('div', { class: 'name', text: p.name }), h('div', { class: 'sub desc', text: p.description || p.widgets + ' items' })),
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
      body.append(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: d.name }), h('div', { class: 'sub', text: d.entity_id || d.id })),
          h('button', { class: 'btn sm ghost danger', title: 'Remove this display', onClick: () => this._removeDisplay(d) }, icon('trash'))),
        h('label', { class: 'lbl', text: 'Showing' }), sel,
        h('label', { class: 'lbl', text: 'Sign-in' }),
        d.has_login
          ? h('div', { class: 'row' }, h('span', { class: 'pill good' }, h('span', { class: 'dot' }), 'Login set up'),
              h('button', { class: 'btn sm', onClick: () => this._makeLogin(d, true) }, 'Replace…'),
              h('button', { class: 'btn sm danger', onClick: () => this._revokeLogin(d) }, 'Revoke'))
          : h('div', {}, h('button', { class: 'btn sm primary', onClick: () => this._makeLogin(d, false) }, 'Set up login…'),
              h('div', { class: 'hint', style: 'margin-top:6px', text: 'Lets this display read your data without you pasting a token.' })),
        this._mirrorSection(d),
        h('div', { style: 'margin-top:10px' }, h('a', { href: PLAYER + '?display=' + encodeURIComponent(d.id), target: '_blank', rel: 'noopener', text: 'Open this display’s player' }))));
    });
    if (!this.state.newDisplay && this.state.displays.length) {
      body.append(h('button', { class: 'btn newpane', onClick: () => { this.state.newDisplay = true; this._renderRail(true); } }, icon('plus'), 'Add display'));
      return;
    }
    const name = h('input', { class: 'field', placeholder: 'Display name, e.g. Kitchen tablet', maxlength: 80, required: true });
    const tz = h('input', { class: 'field', placeholder: 'Timezone (optional)', value: (this._hass.config && this._hass.config.time_zone) || '' });
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
    this.$('layout').append(modal);
  }

  async _setDisplayPane(id, pane) {
    try { await this.ws({ type: 'glass_panes/displays/save', display: { id, pane } }); this.toast('Display switched to ' + pane); } catch (e) { this.fail(e); }
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
    this.$('layout').append(modal);
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
    (pane.widgets || []).forEach((w) => { slots[w.id] = this._useMock(w) ? { ...(mock[w.id] || {}), ...whenSlots(bound[w.id]) } : (bound[w.id] || {}); });
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
      actions.append(h('label', { class: 'lbl', style: 'margin:0 6px 0 0', text: 'Theme' }), themeSel,
        h('span', { class: 'hint', style: 'margin-left:10px', text: 'Drag to move, corners to resize, shift-click to pick several. The dashed line is the safe zone.' }));
    }
    this._renderDock();
    this._renderInspector();
  }

  /** Set (or clear, with an empty value) the pane's colour theme. It goes through _commit, so it can be undone and shows at once. */
  _setTheme(id) {
    if (!this.edit) return;
    const pane = clone(this.edit.pane);
    if (id && THEMES[id]) pane.theme = id; else delete pane.theme;
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
      dock.append(h('button', { class: 'btn primary', onClick: () => this._startEdit() }, icon('edit'), 'Edit pane'), h('span', { class: 'sep' }), this._demoSwitch(), this._mirrorSwitch(), this._standSwitch(), this._forceButton());
      return;
    }
    const e = this.edit, many = e.selected.length > 1;
    const menu = h('div', { class: 'menu', id: 'alignmenu' }, ALIGN_BUTTONS.map(([mode, label]) =>
      h('button', { class: 'btn icon ghost', title: label, onClick: () => { this._align(mode); menu.classList.remove('open'); } }, icon(mode))));
    dock.append(
      h('button', { class: 'btn primary', onClick: () => this._openDrawer('add') }, icon('plus'), 'Add'),
      h('span', { class: 'sep' }),
      h('button', { class: 'btn icon ghost', title: 'Undo', disabled: !e.undo.length, onClick: () => this._undo() }, icon('undo')),
      h('button', { class: 'btn icon ghost', title: 'Redo', disabled: !e.redo.length, onClick: () => this._redo() }, icon('redo')),
      h('div', { class: 'menuwrap' }, h('button', { class: 'btn icon ghost', title: many ? 'Align' : 'Select two or more items to align them', disabled: !many, onClick: () => menu.classList.toggle('open') }, icon('align')), menu),
      h('span', { class: 'sep' }), this._demoSwitch(), this._mirrorSwitch(), this._standSwitch(), this._forceButton(), h('span', { class: 'sep' }),
      h('button', { class: 'btn', onClick: () => this._discard() }, 'Discard'),
      h('button', { class: 'btn primary', disabled: !e.dirty, onClick: () => this._save() }, icon('check'), 'Save'));
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
    const s = Math.max(0.05, Math.min(availW / (1080 + gl + gr), availH / ((1920 + gt + gb) * (1 + standShare))));
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
      ? h('span', { class: 'pill bad', title: bad.map((b) => b.widget).join(', ') }, bad.length + (bad.length > 1 ? ' items do' : ' item does') + ' not fit')
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
    const names = offenders.map((w) => w.name || w.type).join(', ');
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
    this.edit.pane.widgets.forEach((w) => {
      overlay.append(h('div', { class: 'box', 'data-id': w.id, title: 'Covered by another widget? Click it again (or Alt-click) to select the one underneath.' },
        h('span', { class: 'tagname', text: w.name || w.type }),
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
      const entityIds = this._boundIds(w.id);
      const explain = r.ghost && entityIds.length > 0 && !this.edit.sample.has(w.id);
      const opts = w.options || {};
      const noMedia = (w.type === 'image' && !opts.media && !opts.asset) || (w.type === 'video' && !opts.media && !(opts.sources || []).length);
      const status = this.renderer.statusOf(w.id);
      const ruleOff = !!status && status.state === 'off' && status.why === 'rule';         // switched off by its Show when rule
      box.classList.toggle('bound', explain || noMedia || ruleOff);
      if (explain || noMedia || ruleOff) {
        const why = box.querySelector('.why');
        const text = ruleOff ? 'Off right now: its Show when rule does not hold. Use the eye to preview it on.'
          : noMedia ? (w.type === 'video' ? 'Choose a video in the panel on the right' : 'Choose a picture in the panel on the right')
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
      const next = d.mode === 'move' ? ops.moved(w, rect, dx, dy) : ops.resized(w, rect, d.handle, dx, dy);
      const hh = next.auto_height ? rect.h : next.h;
      box.classList.add('dragging');
      box.style.left = next.x + 'px'; box.style.top = next.y + 'px'; box.style.width = next.w + 'px'; box.style.height = Math.max(hh, 36) + 'px';
    });
  }

  _pointerUp(e, cancelled) {
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    try { this.$('overlay').releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    this._dragging = false;
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
      if (d.mode === 'resize') return w.id === d.id ? ops.resized(w, rect, d.handle, dx, dy) : w;
      return ops.moved(w, rect, dx, dy);
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
      pane.widgets = pane.widgets.map((w) => (sel.includes(w.id) ? ops.moved(w, this._rectOf(w), step[0] * ops.GRID, step[1] * ops.GRID) : w));
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
      copy.x = Math.min(ops.snap(rect.x + ops.GRID), ops.CANVAS_W - copy.w); copy.y = Math.min(ops.snap(rect.y + ops.GRID), ops.CANVAS_H - copy.h);
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
    const made = ops.newWidget(type, label, pane.widgets, entityId, slot, kind);
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
          h('button', { class: 'btn sm danger', onClick: () => this._removeWidgets(this.edit.selected) }, icon('trash'), 'Remove')));
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

    box.append(h('button', { class: 'btn sm ghost', style: 'margin: -4px 0 6px -6px', onClick: () => this._selectWidgets([]) }, '← Add something'));
    box.append(
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h3', { text: w.name || reg.label }), h('div', { class: 'sub', text: reg.label })),
        h('button', { class: 'btn sm ghost', title: 'Duplicate', onClick: () => this._duplicateWidgets([w.id]) }, icon('copy')),
        h('button', { class: 'btn sm ghost danger', title: 'Remove', onClick: () => this._removeWidgets([w.id]) }, icon('trash'))),
      h('label', { class: 'lbl', text: 'Name' }), h('input', { class: 'field', value: w.name || '', maxlength: 80, onChange: (ev) => this._patch(w.id, (x) => { x.name = ev.target.value; }) }));

    if (w.type === 'text') {
      box.append(h('label', { class: 'lbl', text: 'Text' }), h('textarea', { class: 'field', rows: 3, onChange: (ev) => setOpt('text', ev.target.value) }, (w.options || {}).text || ''));
    }
    if (w.type === 'message') {
      box.append(h('label', { class: 'lbl', text: 'Lines (one per line)' }),
        h('textarea', { class: 'field', rows: 4, onChange: (ev) => setOpt('lines', ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean)) }, ((w.options || {}).lines || []).join('\n')));
    }

    if (w.type === 'image' || w.type === 'video') box.append(this._mediaPicker(w));

    // what feeds this widget
    Object.entries(reg.slots || {}).forEach(([slot, def]) => {
      const value = ((this.edit.bindings[w.id] || {})[slot]);
      const list = Array.isArray(value) ? value : value ? [value] : [];
      box.append(h('label', { class: 'lbl', text: def.label || slot }));
      if (def.kind === 'checks') { box.append(h('div', { class: 'hint', text: 'Checks (what is worth warning about) are set up in the rule editor, which is coming soon.' })); return; }
      box.append(h('div', { class: 'chips' }, list.map((v) => { const id = typeof v === 'string' ? v : v.entity; return h('span', { class: 'chip' }, h('span', { text: this._friendly(id), title: id }), h('button', { title: 'Remove', onClick: () => this._unbind(w.id, slot, id) }, icon('x'))); })));
      box.append(h('button', { class: 'btn sm', onClick: () => this._openDrawer('bind', { id: w.id, slot, def }) }, icon('plus'), def.kind === 'entity' ? (list.length ? 'Change' : 'Choose entity') : 'Add entity'));
    });

    box.append(h('label', { class: 'lbl', text: 'Position and size' }),
      h('div', { class: 'grid2' }, number('X', rect.x, setBox('x')), number('Y', rect.y, setBox('y')), number('Width', rect.w, setBox('w')), number('Height', rect.h, setBox('h'))),
      h('div', { class: 'hint', style: 'margin-top:6px', text: 'Snaps to a 40 px grid when you drag. Type a number for an exact spot.' }));

    if (w.type === 'video') box.append(h('div', { class: 'hint', style: 'margin-top:12px', text: 'A looping video is played by the display app itself, so it cannot be switched on and off by rules. Put it on its own pane.' }));
    else box.append(ruleSection(this._ruleCtx(w)));

    if (this._boundIds(w.id).length) {
      const sample = h('input', { type: 'checkbox', onChange: () => { if (sample.checked) this.edit.sample.add(w.id); else this.edit.sample.delete(w.id); this._draw(); } });
      sample.checked = this.edit.sample.has(w.id);
      box.append(h('label', { class: 'check', style: 'margin-top:12px', title: 'Only for this preview. Nothing is saved.' }, sample, 'Preview with sample data'));
    }
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
    (CHOICES[w.type] || []).forEach(([key, label, values, dflt]) => {
      const current = (w.options || {})[key] || dflt;
      box.append(h('label', { class: 'lbl', text: label }),
        h('select', { class: 'field', 'data-option': key, onChange: (ev) => this._patch(w.id, (x) => { x.options = { ...(x.options || {}) }; if (ev.target.value === dflt) delete x.options[key]; else x.options[key] = ev.target.value; }) },
          values.map(([v, text]) => h('option', { value: v, selected: v === current, text }))));
    });

    if (!['divider', 'image', 'video'].includes(w.type)) {
      box.append(h('label', { class: 'lbl', text: 'Text' }),
        h('label', { class: 'lbl', text: 'Font' }),
        h('select', { class: 'field', id: 'fontpick', onChange: (ev) => setStyle('font', ev.target.value || null) },
          h('option', { value: '', text: 'Default' }), FONT_CHOICES.map(([v, name]) => h('option', { value: v, selected: style.font === v, text: name }))),
        h('div', { class: 'grid2' }, number('Size', style.size || 32, (v) => setStyle('size', Math.max(8, Math.min(400, Math.round(v)))), { step: 2 }),
          h('div', {}, h('label', { class: 'lbl', text: 'Weight' }),
            h('select', { class: 'field', onChange: (ev) => setStyle('weight', ev.target.value ? parseInt(ev.target.value, 10) : null) },
              h('option', { value: '', text: 'Default' }), [200, 300, 400, 500, 700].map((n) => h('option', { value: n, selected: style.weight === n, text: n }))))),
        h('label', { class: 'lbl', text: 'Colour' }),
        h('select', { class: 'field', onChange: (ev) => setStyle('color', ev.target.value || null) },
          h('option', { value: '', text: 'Default' }), COLORS.map((c) => h('option', { value: c, selected: style.color === c, text: c })),
          style.color && !COLORS.includes(style.color) ? h('option', { value: style.color, selected: true, text: style.color }) : null),
        this._readabilityNote(w),
        h('label', { class: 'lbl', text: 'Alignment' }),
        h('div', { class: 'seg' }, ['left', 'center', 'right'].map((a) => h('button', { class: (style.align || 'left') === a ? 'on' : '', onClick: () => setStyle('align', a === 'left' ? null : a), text: a }))));
    }
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
      h, icon, w, widgets: e.pane.widgets, rect: this._rectOf(w),
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
      menu.append(h('div', { class: 'item' }, h('span', { class: 'name', text: w.name || w.type }), forceControl(h, this._forceMap()[w.id], (mode) => this._setForce(w.id, mode))));
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
    const r = ops.readability(st.color, this.edit.pane.background, { opacity: st.opacity == null ? 1 : st.opacity, size: st.size || 32, weight: st.weight || 400, theme: this.edit.pane.theme });
    if (r.level === 'unknown') return h('div', { class: 'hint', style: 'margin-top:8px', text: 'Readability can’t be checked against this kind of background.' });
    if (r.level === 'good') return document.createDocumentFragment();
    return h('div', { class: 'warnbox ' + r.level }, h('b', { text: r.level === 'poor' ? 'Hard to see. ' : 'Might be hard to see. ' }),
      'This colour is only ' + r.ratio + ':1 against the background' + (this.edit.pane.theme ? ' (the ' + THEMES[this.edit.pane.theme].label + ' theme)' : '') + (r.level === 'low' ? ', fine for large text but not for small.' : '.') + ' Try a lighter colour, a bigger size or a darker background.');
  }

  // ---------------------------------------------------------------- uploaded pictures and videos
  // A picture or video comes from the media library. "Upload" opens the device's own chooser: on a computer a file window, on a phone
  // the photo library, the camera or the files app. The file goes to Home Assistant's upload endpoint first, then Glass Panes takes it.
  async _uploadMedia(file) {
    if (!file) return null;
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
        ['entities', 'elements'].map((t) => h('button', { class: D.tab === t ? 'on' : '', text: t === 'entities' ? 'Your entities' : 'Facets', onClick: () => { D.tab = t; this._renderDrawer(D); } }))));
    }
    if (D.tab === 'entities') head.append(search);
    dr.append(head, h('div', { class: 'list', style: D.docked ? 'padding: 0' : '' }));
    this._renderDrawerList(D);
  }

  _renderDrawerList(D = this._drawer) {
    const list = D.host && D.host.querySelector('.list');
    if (!list) return;
    list.textContent = '';
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

customElements.define('glass-panes-panel', GlassPanesPanel);
