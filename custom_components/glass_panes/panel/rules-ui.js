// The "Show when" part of the builder's inspector (the panel on the right when a widget is selected), and the preview on/off controls.
//
// Kept in its own file so the big panel file only gains a few lines. Nothing here touches the page by itself: the panel passes in what
// this needs (`ctx`), and every change goes back through ctx.edit(), which makes it one undoable step like any other edit.
//
// What it edits (see docs/pane-schema.md, "Show when"):
//   widget.show_when   { match: 'all' | 'any', conditions: [ ... ] }   which things must be true for the widget to show
//   widget.when_hidden 'collapse' | 'keep'                              close the gap, or keep the space, when it is off or empty
//   widget.flow        { after, gap }                                   "Place below" another widget
// Entity conditions name a slot (when_1, when_2 ...); the entity itself goes in the BINDINGS, never in the pane.

import { iconField } from './icon-picker.js';
import { DAYS, MAX_CONDITIONS, MAX_STYLE_RULES, conditionsOf, newCondition, describeCondition, findRuleLoops } from '../player/conditions.js';

export const RULES_CSS = `
.rulecard { margin: 8px 0; padding: 10px; border-radius: 12px; background: var(--ui-sunken); }
.rulecard .row { gap: 6px; align-items: center; flex-wrap: wrap; }
.rulecard .sentence { font-size: 12.5px; color: var(--ui-muted); margin-top: 6px; }
.rulecard .field { margin-top: 4px; }
.daybtns { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.daybtns button { border: 1px solid var(--ui-line); background: var(--ui-bg); color: var(--ui-text); border-radius: 8px; padding: 5px 8px; cursor: pointer; font-weight: 550; text-transform: capitalize; }
.daybtns button.on { background: var(--ui-accent); border-color: var(--ui-accent); color: #fff; }
.box .eye { position: absolute; right: calc(-10px * var(--inv, 3)); top: calc(-10px * var(--inv, 3)); width: calc(22px * var(--inv, 3)); height: calc(22px * var(--inv, 3)); border-radius: 50%; border: 0; padding: 0; background: #3a3a3f; color: #fff; display: none; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.5); z-index: 5; }
.box .eye svg { width: 62%; height: 62%; stroke-width: 2.2; }
.box.sel .eye, .box.ruled .eye { display: flex; }
.box .eye[data-mode=show] { background: #2f7d4f; }
.box .eye[data-mode=hide] { background: #a33a3a; }
.box.off { opacity: .8; border-style: dotted; }
.rulemenu { position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); display: none; min-width: 260px; max-height: 50vh; overflow: auto; padding: 8px 10px; border-radius: 14px; background: var(--ui-surface); border: 1px solid var(--ui-line); box-shadow: var(--ui-shadow); z-index: 20; }
.rulemenu.open { display: block; }
.rulemenu .item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 0; }
.rulemenu .item .name { max-width: 150px; }
`;

export const FORCE_LABELS = { auto: 'Auto', show: 'Shown', hide: 'Hidden' };

/** The plain-language line under a widget: what it is doing right now. `status` comes from the engine (renderer.statusOf). */
export function statusLine(status) {
  if (!status) return '';
  if (status.forced === 'show') return 'Preview: forced ON (not saved).';
  if (status.forced === 'hide') return 'Preview: forced OFF (not saved).';
  if (status.state === 'off') return status.why === 'divider' ? 'Off right now: a divider only shows between two things that have content.' : 'Off right now: its rule does not hold.';
  if (status.state === 'empty') return 'On, but it has nothing to show, so it takes no space (unless you keep the space).';
  return 'On right now.';
}

/** One three-way control: Auto | Shown | Hidden. */
export function forceControl(h, current, onPick) {
  return h('div', { class: 'seg' }, ['auto', 'show', 'hide'].map((m) => h('button', { class: (current || 'auto') === m ? 'on' : '', 'data-force': m, onClick: () => onPick(m), text: FORCE_LABELS[m] })));
}

/**
 * Build the section. ctx = {
 *   h, icon                      the panel's element builder and icon maker
 *   w                            the selected widget
 *   widgets                      every widget of the pane (to pick "another widget" from)
 *   rect                         where the widget is shown now {x, y, w, h}
 *   entityName(slot)             a friendly name for the entity bound to a condition slot, or null
 *   chooseEntity(slot)           open the entity chooser for that slot
 *   edit(fn)                     change the widget: fn(widget, bindings) edits copies; flow.show_if is folded into show_when first
 *   open, setOpen(bool)          whether the "Conditions" choice is showing before any condition exists
 *   force, setForce(mode), status
 * }
 */
export function ruleSection(ctx) {
  const { h, icon, w, widgets } = ctx;
  const conditions = conditionsOf(w);
  const others = widgets.filter((x) => x.id !== w.id);
  const label = ctx.label || ((x) => x.name || x.type);
  const nameOf = (id) => { const x = widgets.find((y) => y.id === id); return x ? label(x) : id; };
  const rule = w.show_when;
  const showing = conditions.length > 0 || ctx.open;
  const root = h('div', { class: 'rules' });

  root.append(h('label', { class: 'lbl', text: 'Show when' }),
    h('div', { class: 'seg' },
      h('button', { class: showing ? '' : 'on', 'data-rule': 'always', text: 'Always', onClick: () => {
        ctx.setOpen(false);
        ctx.edit((x, b) => { delete x.show_when; conditions.forEach((c) => { if (c.kind === 'entity') delete (b[x.id] || {})[c.slot]; }); if (b[x.id] && !Object.keys(b[x.id]).length) delete b[x.id]; });
      } }),
      h('button', { class: showing ? 'on' : '', 'data-rule': 'conditions', text: 'Conditions', onClick: () => ctx.setOpen(true) })));

  if (showing) {
    if (conditions.length > 1) {
      root.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'hint', text: 'Show it when' }),
        h('select', { class: 'field', style: 'width:auto', 'data-field': 'match', onChange: (ev) => ctx.edit((x) => { x.show_when.match = ev.target.value; }) },
          h('option', { value: 'all', selected: !rule || rule.match !== 'any', text: 'all of these hold' }),
          h('option', { value: 'any', selected: !!rule && rule.match === 'any', text: 'any one of these holds' }))));
    }
    conditions.forEach((c, i) => root.append(conditionCard(ctx, c, i, others, nameOf)));

    const free = conditions.length < MAX_CONDITIONS;
    const kinds = [['has_content', 'Another widget has something to show', others.length > 0], ['empty', 'Another widget has nothing to show', others.length > 0],
      ['entity', 'An entity is in a state', true], ['time', 'It is a time of day', true], ['days', 'It is certain days of the week', true]];
    root.append(free
      ? h('select', { class: 'field', 'data-field': 'add-condition', onChange: (ev) => {
        const kind = ev.target.value;
        if (!kind) return;
        ctx.edit((x) => {
          x.show_when = x.show_when || { match: 'all', conditions: [] };
          x.show_when.conditions.push(newCondition(kind, x, others.map((o) => o.id)));
        });
        ctx.setOpen(false);
      } }, h('option', { value: '', text: '+ Add a condition…' }), kinds.filter((k) => k[2]).map(([v, label]) => h('option', { value: v, text: label })))
      : h('div', { class: 'hint', text: 'That is the most conditions a widget can have (' + MAX_CONDITIONS + ').' }));

    const loops = findRuleLoops(widgets).filter((l) => l.includes(w.id));
    if (loops.length) root.append(h('div', { class: 'warnbox poor' }, h('b', { text: 'These rules wait on each other. ' }), 'They can never settle, so Save will refuse them: ' + loops[0].map(nameOf).join(' → ') + '. Change one of them.'));
  }

  // when it is off or has nothing to show
  const keep = w.when_hidden === 'keep';
  root.append(h('label', { class: 'lbl', text: 'When it is off or empty' }),
    h('div', { class: 'seg' },
      h('button', { class: keep ? '' : 'on', 'data-hidden': 'collapse', text: 'Close the gap', onClick: () => ctx.edit((x) => { delete x.when_hidden; }) }),
      h('button', { class: keep ? 'on' : '', 'data-hidden': 'keep', text: 'Keep the space', onClick: () => ctx.edit((x) => { x.when_hidden = 'keep'; }) })),
    h('div', { class: 'hint', text: keep ? 'It holds its box height, so widgets below it stay where they are.' : 'It takes no space, so widgets that flow below it move up.' }));
  const auto = h('input', { type: 'checkbox', 'data-field': 'auto-height', onChange: () => ctx.edit((x) => { if (auto.checked) x.auto_height = true; else delete x.auto_height; }) });
  auto.checked = !!w.auto_height;
  root.append(h('label', { class: 'check', title: 'Off: the box is always its full height. On: the widget is only as tall as what it shows, and takes no space when it shows nothing.' }, auto, 'Height follows its content'));

  // place below another widget
  root.append(placeBelow(ctx, others, nameOf));

  // preview only
  root.append(h('label', { class: 'lbl', text: 'Preview (never saved)' }),
    forceControl(h, ctx.force, ctx.setForce),
    h('div', { class: 'hint', 'data-role': 'status', text: statusLine(ctx.status) }));
  return root;
}

// one condition, with the controls for its kind
function conditionCard(ctx, c, index, others, nameOf) {
  const { h, icon, w } = ctx;
  const set = (patch) => ctx.edit((x) => { Object.assign(x.show_when.conditions[index], patch); });
  const card = h('div', { class: 'rulecard', 'data-kind': c.kind });
  const remove = h('button', { class: 'btn sm ghost danger', title: 'Remove this condition', onClick: () => ctx.edit((x, b) => {
    const gone = x.show_when.conditions.splice(index, 1)[0];
    if (gone && gone.kind === 'entity' && !x.show_when.conditions.some((o) => o.kind === 'entity' && o.slot === gone.slot) && b[x.id]) {
      delete b[x.id][gone.slot];                                    // nothing else uses that slot: its entity goes too
      if (!Object.keys(b[x.id]).length) delete b[x.id];
    }
    if (!x.show_when.conditions.length) delete x.show_when;
  }) }, icon('x'));

  if (c.kind === 'has_content' || c.kind === 'empty') {
    card.append(h('div', { class: 'row' },
      h('select', { class: 'field', style: 'flex:1', 'data-field': 'widget', onChange: (ev) => set({ widget: ev.target.value }) },
        others.map((o) => h('option', { value: o.id, selected: o.id === c.widget, text: (ctx.label ? ctx.label(o) : o.name || o.type) })),
        others.some((o) => o.id === c.widget) ? null : h('option', { value: c.widget, selected: true, text: c.widget + ' (missing)' })),
      h('select', { class: 'field', style: 'width:auto', 'data-field': 'kind', onChange: (ev) => set({ kind: ev.target.value }) },
        h('option', { value: 'has_content', selected: c.kind === 'has_content', text: 'has something to show' }),
        h('option', { value: 'empty', selected: c.kind === 'empty', text: 'has nothing to show' })), remove));
  } else if (c.kind === 'entity') {
    const name = ctx.entityName(c.slot);
    const needsValue = c.test !== 'unavailable';
    const numeric = c.test === 'above' || c.test === 'below';
    card.append(h('div', { class: 'row' },
      h('button', { class: 'btn sm', 'data-field': 'entity', onClick: () => ctx.chooseEntity(c.slot) }, name || 'Choose entity…'),
      h('select', { class: 'field', style: 'width:auto', 'data-field': 'test', onChange: (ev) => {
        const test = ev.target.value, patch = { test };
        if (test === 'unavailable') { ctx.edit((x) => { const cc = x.show_when.conditions[index]; cc.test = test; delete cc.value; }); return; }
        if (test === 'above' || test === 'below') patch.value = Number.isFinite(parseFloat(c.value)) ? parseFloat(c.value) : 0;
        else if (typeof c.value !== 'string' && !Array.isArray(c.value)) patch.value = 'on';
        set(patch);
      } }, [['is', 'is'], ['is_not', 'is not'], ['above', 'is above'], ['below', 'is below'], ['unavailable', 'is unavailable']].map(([v, t]) => h('option', { value: v, selected: c.test === v, text: t }))),
      remove));
    if (needsValue) {
      const shown = numeric ? c.value : [].concat(c.value === undefined ? '' : c.value).join(', ');
      card.append(h('input', {
        class: 'field', 'data-field': 'value', type: numeric ? 'number' : 'text', value: shown, maxlength: 80,
        placeholder: numeric ? 'a number' : 'a state, like on or open (several: separate with commas)',
        onChange: (ev) => {
          if (numeric) { const n = parseFloat(ev.target.value); if (Number.isFinite(n)) set({ value: n }); return; }
          const parts = ev.target.value.split(',').map((s) => s.trim()).filter(Boolean);
          if (parts.length) set({ value: parts.length === 1 ? parts[0] : parts.slice(0, 10) });
        },
      }));
    }
    if (!name) card.append(h('div', { class: 'hint', text: 'No entity chosen yet, so this never holds and the widget stays off.' }));
  } else if (c.kind === 'time') {
    card.append(h('div', { class: 'row' }, h('span', { class: 'hint', text: 'Between' }),
      h('input', { class: 'field', style: 'width:auto', type: 'time', value: c.from, 'data-field': 'from', onChange: (ev) => { if (ev.target.value) set({ from: ev.target.value }); } }),
      h('span', { class: 'hint', text: 'and' }),
      h('input', { class: 'field', style: 'width:auto', type: 'time', value: c.to, 'data-field': 'to', onChange: (ev) => { if (ev.target.value) set({ to: ev.target.value }); } }), remove));
    if (c.from === c.to) card.append(h('div', { class: 'warnbox poor' }, 'Start and end are the same time. Pick two different times, or Save will refuse it.'));
    card.append(h('div', { class: 'hint', text: 'The display’s own time zone. A start later than the end runs through midnight.' }));
  } else if (c.kind === 'days') {
    card.append(h('div', { class: 'row' }, h('span', { class: 'hint', text: 'On these days' }), remove),
      h('div', { class: 'daybtns' }, DAYS.map((d) => h('button', {
        class: (c.days || []).includes(d) ? 'on' : '', 'data-day': d, text: d,
        onClick: () => {
          const on = (c.days || []).includes(d), next = on ? c.days.filter((x) => x !== d) : DAYS.filter((x) => (c.days || []).includes(x) || x === d);
          if (next.length) set({ days: next });                    // at least one day
        },
      }))));
  }
  card.append(h('div', { class: 'sentence', text: 'Shown when ' + describeCondition(c, nameOf, ctx.entityName) + '.' }));
  return card;
}

// "Place below": flow after another widget, so it follows wherever that one ends up
function placeBelow(ctx, others, nameOf) {
  const { h, w } = ctx;
  const after = w.flow ? [].concat(w.flow.after) : [];
  // a widget that already flows after this one (even through others) cannot be what this one flows after: that would be a loop
  const followers = new Set([w.id]);
  for (let changed = true; changed;) {
    changed = false;
    ctx.widgets.forEach((x) => { if (x.flow && !followers.has(x.id) && [].concat(x.flow.after).some((a) => followers.has(a))) { followers.add(x.id); changed = true; } });
  }
  const choices = others.filter((o) => !followers.has(o.id));
  // unlinking pins the widget where it is shown now
  const unlink = (x) => { delete x.flow; x.y = Math.max(0, Math.min(Math.round(ctx.rect.y), 1920 - x.h)); };
  const wrap = h('div', {}, h('label', { class: 'lbl', text: 'Place below' }),
    h('select', { class: 'field', 'data-field': 'flow-after', onChange: (ev) => {
      const id = ev.target.value;
      ctx.edit((x) => {
        if (!id) { unlink(x); return; }
        x.flow = { after: id, gap: (x.flow && x.flow.gap) || 0 };
      });
    } }, h('option', { value: '', selected: !after.length, text: 'Nothing: stay where I put it' }),
    choices.map((o) => h('option', { value: o.id, selected: after.length === 1 && after[0] === o.id, text: (ctx.label ? ctx.label(o) : o.name || o.type) })),
    after.length > 1 ? h('option', { value: '', selected: true, disabled: true, text: 'Several widgets: ' + after.map(nameOf).join(', ') }) : null));
  if (after.length) {
    wrap.append(h('div', { class: 'grid2', style: 'margin-top:6px' }, h('div', {}, h('label', { class: 'lbl', text: 'Gap (px)' }),
      h('input', { class: 'field', type: 'number', min: 0, max: 400, step: 10, value: w.flow.gap || 0, 'data-field': 'flow-gap',
        onChange: (ev) => { const n = parseInt(ev.target.value, 10); if (Number.isFinite(n)) ctx.edit((x) => { x.flow.gap = Math.max(0, Math.min(400, n)); }); } }))),
    h('button', { class: 'btn sm ghost', style: 'margin-top:6px', 'data-field': 'flow-unlink', title: 'Stop following that widget and stay where it is now', onClick: () => ctx.edit(unlink) }, 'Unlink'),
    h('div', { class: 'hint', text: 'It sits below that widget wherever it ends up, and anything empty above is skipped, so there is no gap. Dragging it up or down changes the gap, sideways moves it across; the link stays until you press Unlink.' }));
  }
  return wrap;
}

// ---------------------------------------------------------------- conditional formatting (style_rules)
// Under the widget's "Show when" section. A rule is: when the widget's entity is above / below / between / equal to something, wear this
// colour, size, weight or opacity. The first rule that holds wins, so the order matters.

const STYLE_TEST_LABELS = [['above', 'is above'], ['below', 'is below'], ['between', 'is between'], ['is', 'is'], ['is_not', 'is not']];
const COLOR_CHOICES = [['', 'Unchanged'], ['fg', 'Normal'], ['dim', 'Dim'], ['accent', 'Accent'], ['good', 'Good (green)'], ['warn', 'Warning (amber)'], ['bad', 'Bad (red)']];
const WEIGHT_CHOICES = [['', 'Unchanged'], ['100', 'Thin'], ['300', 'Light'], ['400', 'Regular'], ['600', 'Semi-bold'], ['700', 'Bold']];

/** A new rule that continues the pattern: above the highest number so far, in red. */
export function newStyleRule(existing = []) {
  const top = existing.reduce((m, r) => (Number.isFinite(r.value) ? Math.max(m, r.value, Number.isFinite(r.to) ? r.to : -Infinity) : m), -Infinity);
  return { test: 'above', value: Number.isFinite(top) ? top : 0, style: { color: 'bad' } };
}

/**
 * ctx = { h, icon, w, entityName(slot), edit(fn) }  (the same ctx as ruleSection; `edit` receives the widget)
 * Returns the section, or null for a widget with no `entity` slot (nothing for a rule to look at).
 */
export function styleRulesSection(ctx, hasEntitySlot) {
  const { h, icon, w } = ctx;
  if (!hasEntitySlot) return null;
  const own = ctx.owner || ((x) => x);                    // where the rules live: the widget, or a table column
  const rules = own(w).style_rules || [];
  const root = h('details', { class: 'fold stylerules', open: rules.length > 0 || ctx.styleOpen === true },
    h('summary', { onClick: (ev) => { if (ctx.setStyleOpen) ctx.setStyleOpen(!ev.currentTarget.parentElement.open); } }, h('span', { class: 'lbl', style: 'display:inline;margin:0', text: ctx.title || 'Colours and sizes by value' })));
  root.append(h('div', { class: 'hint', style: 'margin-top:8px', text: 'Change how this widget looks depending on its entity. The first rule that holds wins.' }));
  rules.forEach((r, i) => {
    const set = (patch) => ctx.edit((x) => { Object.assign(own(x).style_rules[i], patch); });
    const setStyle = (key, value) => ctx.edit((x) => {
      const st = { ...own(x).style_rules[i].style };
      if (value === '' || value == null) delete st[key]; else st[key] = value;
      own(x).style_rules[i].style = st;
    });
    const num = r.test === 'above' || r.test === 'below' || r.test === 'between';
    const card = h('div', { class: 'rulecard', 'data-style-rule': i + 1 });
    card.append(h('div', { class: 'row' },
      h('span', { class: 'hint', text: 'When it' }),
      h('select', { class: 'field', style: 'width:auto', 'data-field': 'test', onChange: (ev) => {
        const test = ev.target.value;
        ctx.edit((x) => {
          const rule = own(x).style_rules[i];
          rule.test = test;
          if (test === 'above' || test === 'below') { rule.value = Number.isFinite(parseFloat(rule.value)) ? parseFloat(rule.value) : 0; delete rule.to; }
          else if (test === 'between') { const a = Number.isFinite(parseFloat(rule.value)) ? parseFloat(rule.value) : 0; rule.value = a; rule.to = Number.isFinite(rule.to) ? rule.to : a + 10; }
          else { if (typeof rule.value !== 'string' && !Array.isArray(rule.value)) rule.value = 'on'; delete rule.to; }
        });
      } }, STYLE_TEST_LABELS.map(([v, t]) => h('option', { value: v, selected: r.test === v, text: t }))),
      h('button', { class: 'btn sm ghost', title: 'Check this rule earlier', disabled: i === 0, onClick: () => ctx.edit((x) => { const [m] = own(x).style_rules.splice(i, 1); own(x).style_rules.splice(i - 1, 0, m); }) }, '↑'),
      h('button', { class: 'btn sm ghost danger', title: 'Remove this rule', onClick: () => ctx.edit((x) => { own(x).style_rules.splice(i, 1); if (!own(x).style_rules.length) delete own(x).style_rules; }) }, icon('x'))));
    if (num) {
      card.append(h('div', { class: 'row' },
        h('input', { class: 'field', style: 'width:90px', type: 'number', 'data-field': 'value', value: r.value, onChange: (ev) => { const n = parseFloat(ev.target.value); if (Number.isFinite(n)) set({ value: n }); } }),
        r.test === 'between' ? h('span', { class: 'hint', text: 'and' }) : null,
        r.test === 'between' ? h('input', { class: 'field', style: 'width:90px', type: 'number', 'data-field': 'to', value: r.to, onChange: (ev) => { const n = parseFloat(ev.target.value); if (Number.isFinite(n)) set({ to: n }); } }) : null));
    } else {
      card.append(h('input', { class: 'field', 'data-field': 'value', type: 'text', maxlength: 80, value: [].concat(r.value === undefined ? '' : r.value).join(', '),
        placeholder: 'a state, like on or open (several: separate with commas)',
        onChange: (ev) => { const parts = ev.target.value.split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) set({ value: parts.length === 1 ? parts[0] : parts.slice(0, 10) }); } }));
    }
    card.append(h('input', { class: 'field', 'data-field': 'attribute', type: 'text', maxlength: 64, value: r.attribute || '', placeholder: 'Look at an attribute instead of the state (optional)',
      onChange: (ev) => { const v = ev.target.value.trim(); ctx.edit((x) => { if (v) own(x).style_rules[i].attribute = v; else delete own(x).style_rules[i].attribute; }); } }));
    const st = r.style || {};
    card.append(h('div', { class: 'hint', style: 'margin-top:6px', text: 'then it shows with' }),
      h('div', { class: 'grid2' },
        h('select', { class: 'field', 'data-field': 'color', title: 'Colour', onChange: (ev) => setStyle('color', ev.target.value) }, COLOR_CHOICES.map(([v, t]) => h('option', { value: v, selected: (st.color || '') === v, text: t }))),
        h('select', { class: 'field', 'data-field': 'weight', title: 'Weight', onChange: (ev) => setStyle('weight', ev.target.value ? parseInt(ev.target.value, 10) : null) }, WEIGHT_CHOICES.map(([v, t]) => h('option', { value: v, selected: String(st.weight || '') === v, text: t }))),
        h('input', { class: 'field', type: 'number', min: 8, max: 400, 'data-field': 'size', title: 'Size (px)', placeholder: 'Size', value: st.size || '', onChange: (ev) => { const n = parseInt(ev.target.value, 10); setStyle('size', Number.isFinite(n) ? Math.max(8, Math.min(400, n)) : null); } }),
        h('input', { class: 'field', type: 'number', min: 0, max: 100, step: 10, 'data-field': 'opacity', title: 'Opacity (%)', placeholder: 'Opacity %', value: st.opacity != null ? Math.round(st.opacity * 100) : '',
          onChange: (ev) => { const n = parseFloat(ev.target.value); setStyle('opacity', Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : null); } })));
    card.append(h('div', { class: 'hint', style: 'margin-top:6px', text: 'Icon' }), iconField(h, { value: st.icon || '', emptyLabel: 'Keep the widget’s icon', onPick: (name) => setStyle('icon', name || null) }));
    if (!Object.keys(st).length) card.append(h('div', { class: 'warnbox poor', text: 'This rule changes nothing yet. Pick a colour, weight, size or opacity.' }));
    root.append(card);
  });
  if (!ctx.noEntityHint && !ctx.entityName('entity')) root.append(h('div', { class: 'hint', text: 'Bind an entity to this widget first: the rules look at it.' }));
  root.append(rules.length < MAX_STYLE_RULES
    ? h('button', { class: 'btn sm', 'data-field': 'add-style-rule', onClick: () => ctx.edit((x) => { own(x).style_rules = [...(own(x).style_rules || []), newStyleRule(own(x).style_rules || [])]; }) }, icon('plus'), 'Add a rule')
    : h('div', { class: 'hint', text: 'That is the most rules a widget can have (' + MAX_STYLE_RULES + ').' }));
  return root;
}
