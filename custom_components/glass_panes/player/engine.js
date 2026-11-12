// Glass Panes rendering engine: turns a pane (its layout) plus its bindings into widgets inside a 1080x1920 stage element.
//
// The player page and the sidebar builder both use this, so what you see in the builder is what the display shows.
// It knows nothing about where data comes from (a `client` with state/calendar/service/track is passed in) and nothing about
// Home Assistant addresses or tokens.

import { widgets } from './widgets.js';
import { applyTheme, paneBackground } from './themes.js';
import { widgetShouldShow, conditionsOf, entitySlots, usesClock, clockOf, evaluateCondition, nextMinuteDelay, styledFor, STYLE_SLOT } from './conditions.js';
import { isSeparator } from './util.js';

export const COLORS = { fg: 'var(--gp-fg)', dim: 'var(--gp-dim)', faint: 'var(--gp-faint)', accent: 'var(--gp-accent)', warn: 'var(--gp-warn)', good: 'var(--gp-good)', bad: 'var(--gp-bad)' };
export const FONTS = {
  inter: "'Inter', system-ui, sans-serif", outfit: "'Outfit', system-ui, sans-serif", jost: "'Jost', system-ui, sans-serif",
  'space-grotesk': "'Space Grotesk', system-ui, sans-serif", 'jetbrains-mono': "'JetBrains Mono', ui-monospace, monospace",
  'cormorant-garamond': "'Cormorant Garamond', Georgia, serif", 'playfair-display': "'Playfair Display', Georgia, serif",
  montserrat: "'Montserrat', system-ui, sans-serif", lora: "'Lora', Georgia, serif", 'dm-serif-display': "'DM Serif Display', Georgia, serif",
  'system-sans': 'system-ui, sans-serif', 'system-serif': "Georgia, 'Times New Roman', serif", 'system-mono': 'ui-monospace, Menlo, Consolas, monospace',
};
const LINE_HEIGHT = { clock: 1, date: 1.2, message: 1.25, entity_value: 1.1, text: 1.15 };

export class PaneRenderer {
  /**
   * @param {object} o
   * @param {HTMLElement} o.stage      the 1080x1920 element widgets are placed in
   * @param {object} o.client          data source: state(id), track(ids), calendar(id,start,end), service(domain,name,data)
   * @param {object} o.time            time helpers for the display's timezone (see util.makeTime)
   * @param {string} [o.assetBase]     where images and videos named in a pane live
   * @param {boolean} [o.kiosk]        inside the kiosk app: video is played natively through it
   * @param {string} [o.appUrl]        the kiosk app's control address
   * @param {boolean} [o.debug]        outline widgets whose content does not fit
   * @param {function} [o.onError]     called with (where, error)
   * @param {function} [o.pick]        (widget, slots) -> the data client that widget should use (the builder mixes demo and live data)
   */
  constructor(o) {
    this.stage = o.stage;
    this.client = o.client;
    this.time = o.time;
    this.assetBase = o.assetBase || '../assets/';
    this.kiosk = !!o.kiosk;
    this.appUrl = o.appUrl || 'http://127.0.0.1:8099';
    this.debug = !!o.debug;
    this.pick = o.pick || null;
    this.onError = o.onError || ((where, err) => console.error('[glass_panes]', where, err));
    this.mounted = [];
    this.watchers = new Map();
    this.resizer = null;
    this.layoutQueued = false;
    // "show when" rules (see conditions.js)
    this.entityStates = new Map();   // entity id -> its state, or null when it does not exist; missing = not fetched yet
    this.slotsFor = {};              // widget id -> its bindings, where the entities of entity conditions are found
    this.ruleFns = [];               // [entity id, fn] watchers to undo in clear()
    this.ruleTimer = null;           // the once-a-minute check for time and day rules
    this.clockSig = '';
    this.force = new Map();          // preview only: widget id -> 'show' | 'hide', overrides the widget's rule; never saved
    this.generation = 0;             // bumped by clear() so a late answer for an old pane is ignored
  }

  // ---------------------------------------------------------------- showing a pane

  /** Draw a pane. `slotsFor` maps widget id -> its entity bindings ({slot: entity | [entities] | [rules]}). */
  show(pane, slotsFor = {}) {
    this.clear();
    // a theme (if the pane has one) supplies the colours, and its background unless the pane keeps its own (own_background: true, for true black on a mirror)
    applyTheme(this.stage, pane.theme);
    this.stage.style.background = paneBackground(pane);
    // pane.motion.widgets "fade": widgets switched by show-when rules fade instead of popping (player.css; off with reduced motion)
    this.stage.classList.toggle('gp-fade', !!(pane.motion && pane.motion.widgets === 'fade'));
    // pane.burn_in_saver: the whole pane wanders 6 px over 40 minutes (player.css). `translate`, so the stage's own scale transform is kept.
    this.stage.classList.toggle('gp-pane-drift', pane.burn_in_saver === true);
    this.slotsFor = slotsFor;
    (pane.widgets || []).forEach((w) => this.mounted.push(this._mount(pane, w, slotsFor[w.id] || {})));
    this._startRules(pane);
    this.resizer = new ResizeObserver(() => this.scheduleLayout());
    this.mounted.forEach((inst) => { if (inst.spec.auto_height) this.resizer.observe(inst.root); });
    this.layout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.scheduleLayout());
  }

  /** Remove everything that is drawn and stop every timer and watcher. */
  clear() {
    this.mounted.forEach((inst) => {
      inst.alive = false;
      inst.timers.forEach(clearInterval);
      inst.fns.forEach(([id, fn]) => { const set = this.watchers.get(id); if (set) set.delete(fn); });
      inst.destroy.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
      inst.root.remove();
    });
    this.mounted = [];
    if (this.resizer) { this.resizer.disconnect(); this.resizer = null; }
    this.generation++;
    clearTimeout(this.ruleTimer);
    this.ruleFns.forEach(([id, fn]) => { const set = this.watchers.get(id); if (set) set.delete(fn); });
    this.ruleFns = [];
    this.entityStates.clear();
  }

  /** The data source says an entity changed (null = everything may have, e.g. after a reconnect). */
  notify(entityId) {
    if (entityId === null || entityId === undefined) this.watchers.forEach((set) => set.forEach((fn) => fn()));
    else (this.watchers.get(entityId) || []).forEach((fn) => fn());
  }

  // ---------------------------------------------------------------- styling

  _applyStyle(node, type, st) {
    const s = node.style;
    s.fontFamily = FONTS[st.font] || '';
    s.fontSize = st.size ? st.size + 'px' : '';             // cleared when absent, so a style rule that stops matching puts the old look back
    s.fontWeight = st.weight || '';
    s.color = st.color ? (COLORS[st.color] || st.color) : '';
    s.opacity = st.opacity != null ? st.opacity : '';
    if (st.align) s.textAlign = st.align;
    node.dataset.align = st.align || 'left';   // lets the CSS line up lists, rows and flex layouts the same way
    if (st.italic) s.fontStyle = 'italic';
    if (st.uppercase) s.textTransform = 'uppercase';
    if (st.letter_spacing != null) s.letterSpacing = st.letter_spacing + 'px';
    s.lineHeight = st.line_height || LINE_HEIGHT[type] || 1.3;
  }

  // ---------------------------------------------------------------- widget lifecycle

  _addWatcher(id, fn) {
    if (!this.watchers.has(id)) this.watchers.set(id, new Set());
    this.watchers.get(id).add(fn);
  }

  _mount(pane, w, slots) {
    const root = document.createElement('div');
    root.className = 'gp-widget';
    root.dataset.widget = w.id;
    const s = root.style;
    s.left = w.x + 'px'; s.top = w.y + 'px'; s.width = w.w + 'px'; s.height = w.h + 'px';
    if (w.z != null) s.zIndex = w.z;
    if (w.auto_height) s.height = 'auto';
    this._applyStyle(root, w.type, w.style || {});
    this.stage.appendChild(root);

    const self = this;
    const inst = { root, spec: w, timers: [], fns: [], destroy: [], alive: true, styleFns: [] };
    const debounced = (fn) => {
      let t = null;
      return () => { clearTimeout(t); t = setTimeout(fn, 250); };
    };
    const ctx = {
      root, data: this.pick ? this.pick(w, slots) : this.client, time: this.time, slots, opts: w.options || {}, style: w.style || {}, w: w.w, h: w.h,
      paneId: pane.id, widgetId: w.id, assetBase: this.assetBase, kiosk: this.kiosk, appUrl: this.appUrl,
      onDestroy: (fn) => inst.destroy.push(fn),
      onStyle: (fn) => inst.styleFns.push(fn),          // called with the style the widget wears now (its own plus a matching style rule)
      refresh(fn, ids, ms) {
        const run = () => { if (inst.alive) Promise.resolve().then(fn).catch((e) => self.onError(w.type + '/' + w.id, e)); };
        run();
        const onChange = debounced(run);
        (ids || []).filter(Boolean).forEach((id) => { self.client.track([id]); self._addWatcher(id, onChange); inst.fns.push([id, onChange]); });
        if (ms) inst.timers.push(setInterval(run, ms));
      },
      every(ms, fn) { ctx.refresh(fn, [], ms); },
    };
    const render = widgets[w.type];
    if (!render) { this.onError('unknown widget type', w.type); return inst; }
    try { render(ctx); } catch (e) { this.onError(w.type + '/' + w.id, e); }
    return inst;
  }

  // ---------------------------------------------------------------- "show when" rules
  // A widget may carry a rule (conditions.js). The engine only gathers the facts: the state of each entity a rule names, the clock,
  // and what the other widgets are showing. It asks again when an entity changes, when a widget's size changes (that goes through
  // layout) and once a minute for time rules. Nothing runs per frame.

  _entityOf(widgetId, slot) {
    let v = (this.slotsFor[widgetId] || {})[slot];
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === 'object') v = v.entity;
    return typeof v === 'string' ? v : null;
  }

  _startRules(pane) {
    const ids = new Set();
    let clock = false;
    (pane.widgets || []).forEach((w) => {
      entitySlots(w).forEach((slot) => { const id = this._entityOf(w.id, slot); if (id) ids.add(id); });
      if (w.style_rules && w.style_rules.length) { const id = this._entityOf(w.id, STYLE_SLOT); if (id) ids.add(id); }      // conditional formatting reads the entity too
      if (usesClock(w)) clock = true;
    });
    const gen = this.generation;
    ids.forEach((id) => {
      const load = () => {
        Promise.resolve(this.client.state(id)).then((s) => {
          if (gen !== this.generation) return;
          this.entityStates.set(id, s || null);
          this._restyleAll();
          this.scheduleLayout();
        }).catch(() => { /* keep the last known state */ });
      };
      this.client.track([id]);
      this._addWatcher(id, load);
      this.ruleFns.push([id, load]);
      load();
    });
    clearTimeout(this.ruleTimer);
    if (clock) {
      this.clockSig = this._clockSignature();
      const tick = () => {
        const sig = this._clockSignature();
        if (sig !== this.clockSig) { this.clockSig = sig; this.scheduleLayout(); }     // only lay out again if a time rule flipped
        this.ruleTimer = setTimeout(tick, nextMinuteDelay(Date.now()));
      };
      this.ruleTimer = setTimeout(tick, nextMinuteDelay(Date.now()));
    }
  }

  /** Conditional formatting: each widget with `style_rules` wears its own style plus the first matching rule's changes. */
  _restyleAll() {
    this.mounted.forEach((inst) => {
      const w = inst.spec;
      if (!w.style_rules || !w.style_rules.length) return;
      const id = this._entityOf(w.id, STYLE_SLOT);
      const { style, rule } = styledFor(w, id ? this.entityStates.get(id) : undefined);
      this._applyStyle(inst.root, w.type, style);
      inst.styleFns.forEach((fn) => { try { fn(style); } catch (e) { this.onError(w.type + '/' + w.id, e); } });
      const mark = rule ? String(w.style_rules.indexOf(rule) + 1) : '';
      if ((inst.root.dataset.gpRule || '') !== mark) { if (mark) inst.root.dataset.gpRule = mark; else delete inst.root.dataset.gpRule; }      // lets tests see which rule won
    });
  }

  /** What every time or day condition says right now, as a string: it changes only when one of them flips. */
  _clockSignature() {
    const clock = clockOf(this.time);
    return this.mounted.map((inst) => conditionsOf(inst.spec).filter((c) => c.kind === 'time' || c.kind === 'days')
      .map((c) => (evaluateCondition(c, { clock }) ? 1 : 0)).join('')).join('|');
  }

  /** Preview only (the builder's eye control, ?force= on the player): { widgetId: 'show' | 'hide' } overrides those widgets' rules. */
  setForce(map) {
    this.force = new Map(Object.entries(map || {}).filter(([, v]) => v === 'show' || v === 'hide'));
    this.layout();
  }

  /** How a widget is right now: { state: 'on' | 'empty' | 'off', why, forced } ('empty' = allowed on, but with nothing to show). */
  statusOf(id) {
    const inst = this.mounted.find((m) => m.spec.id === id);
    return inst && inst.status ? inst.status : null;
  }

  // ---------------------------------------------------------------- layout
  // Most widgets sit at a fixed y. Widgets with `auto_height` size themselves to their content, and widgets with `flow` sit below
  // whatever they follow, so a section that grows pushes the next one down instead of landing on it. Empty sections take no space,
  // a divider only shows between two non-empty things, and a widget with a rule (or the older flow.show_if) shows only while the rule
  // holds. A widget that is off, or empty, closes its gap unless it says `when_hidden: "keep"`: then it holds its box height and the
  // widgets below do not move.

  scheduleLayout() {
    if (this.layoutQueued) return;
    this.layoutQueued = true;
    requestAnimationFrame(() => { this.layoutQueued = false; this.layout(); });
  }

  layout() {
    const mounted = this.mounted;
    const byId = new Map();
    mounted.forEach((inst) => { byId.set(inst.spec.id, inst); });
    // natural height: what the content needs (auto_height) or the box. A switched-off widget keeps its box (visibility, not display), so it can be measured too.
    mounted.forEach((inst) => { inst.h = inst.spec.auto_height ? inst.root.offsetHeight : inst.spec.h; inst.rec = null; inst.on = undefined; });
    const time = this.time;
    let clock = null;                                                   // read the clock once, and only if some rule needs it
    const env = (inst) => ({
      entityState: (slot) => { const id = this._entityOf(inst.spec.id, slot); return id ? this.entityStates.get(id) : undefined; },
      hasContent: (id) => { const t = byId.get(id); return !!t && allowed(t) && !(t.spec.auto_height && t.h === 0); },
      get clock() { return clock || (clock = clockOf(time)); },
    });
    // is the widget allowed on by its rule (or by the preview toggle)? A loop counts as off while it is being worked out.
    const allowed = (inst) => {
      if (inst.on !== undefined) return inst.on;
      const forced = this.force.get(inst.spec.id);
      if (forced) return (inst.on = forced === 'show');
      inst.on = false;
      inst.on = widgetShouldShow(inst.spec, env(inst));
      return inst.on;
    };
    const contentless = (inst) => !allowed(inst) || (inst.spec.auto_height && inst.h === 0);

    // who flows after whom, so a divider can tell whether anything with content comes after it
    const dependents = new Map();
    mounted.forEach((inst) => {
      if (inst.spec.flow) [].concat(inst.spec.flow.after).forEach((id) => { if (!dependents.has(id)) dependents.set(id, []); dependents.get(id).push(inst); });
    });
    const hasContentAfter = (id, seen) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return (dependents.get(id) || []).some((d) => (!isSeparator(d.spec) && !contentless(d)) || hasContentAfter(d.spec.id, seen));
    };

    const place = (inst, trail) => {
      if (inst.rec) return inst.rec;
      const s = inst.spec, f = s.flow;
      let top = s.y, pred = null, firstTop = null, hidden = !allowed(inst);
      const why = hidden ? (this.force.has(s.id) ? 'forced' : 'rule') : null;
      if (f) {
        [].concat(f.after).forEach((id) => {
          const a = byId.get(id);
          if (!a || trail.has(id)) return;                                  // missing or circular: ignore
          const r = place(a, new Set(trail).add(s.id));
          if (firstTop === null) firstTop = r.top;
          const p = r.empty ? r.pred : r;                                   // skip over empty things
          if (p && (!pred || p.top + p.h > pred.top + pred.h)) pred = p;
        });
        if (pred) top = pred.top + pred.h + (f.gap || 0);
        else if (firstTop !== null) top = firstTop;
        // a divider only shows between two things that have content: not after nothing, not after another divider, not before nothing
        if (isSeparator(s) && (!pred || pred.spec.type === 'divider' || !hasContentAfter(s.id, new Set()))) hidden = true;
      }
      const nothing = hidden || (s.auto_height && inst.h === 0);
      const keep = s.when_hidden === 'keep';
      // the room it takes: its content; with "keep the space" at least its own box, and exactly its box when there is nothing to show
      const room = keep ? (nothing ? s.h : Math.max(inst.h, s.h)) : (nothing ? 0 : inst.h);
      inst.rec = { top, h: room, empty: nothing && !keep, pred, spec: s };
      inst.root.style.top = top + 'px';
      inst.root.classList.toggle('gp-hidden', hidden);
      const state = hidden ? 'off' : nothing ? 'empty' : 'on';
      inst.status = { state, why: why || (hidden ? 'divider' : null), forced: this.force.get(s.id) || null };
      if (inst.root.dataset.gp !== state) inst.root.dataset.gp = state;      // lets tests and styles see it
      return inst.rec;
    };
    mounted.forEach((inst) => place(inst, new Set()));
  }

  // ---------------------------------------------------------------- overflow check
  // Nothing is clipped, so a widget whose content is bigger than its box would spill over its neighbours. This measures every
  // widget and lists the ones that do. With `debug` they also get a red dashed outline.
  checkOverflow() {
    const bad = [];
    this.mounted.forEach((inst) => {
      if (inst.root.classList.contains('gp-hidden')) { inst.root.classList.remove('gp-overflow'); return; }   // switched off: nothing to fit
      // a single line of text can measure a little taller than its line box because of font metrics; allow for that
      const r = inst.root, slack = 1 + 0.2 * (parseFloat(getComputedStyle(r).fontSize) || 0), rec = inst.rec;
      const tooTall = !inst.spec.auto_height && r.scrollHeight > r.clientHeight + slack;
      const tooWide = r.scrollWidth > r.clientWidth + 1;
      const offCanvas = rec && !rec.empty && rec.top + rec.h > 1920 + 1;
      const over = tooTall || tooWide || offCanvas;
      r.classList.toggle('gp-overflow', over && this.debug);
      if (over) bad.push({ widget: r.dataset.widget, box: r.clientWidth + 'x' + r.clientHeight, content: r.scrollWidth + 'x' + r.scrollHeight, offCanvas: !!offCanvas });
    });
    return bad;
  }
}
