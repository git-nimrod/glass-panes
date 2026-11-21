// The warnings editor: the checks of a Status summary widget ("what is worth warning about"). One card per entity: its name, when to warn
// (the same tests as a "Show when" entity condition: is / is not / above / below / unavailable), and the words to show.
// The checks live in the widget's bindings (they hold entity ids), as a list of plain entities or small rules; the stored form is the
// one the widget has always read, converted by checkTest() / withTest() in conditions.js.

import { checkTest, checkWindow, withTest, describeCheck } from '../player/conditions.js';

const TESTS = [['is', 'is'], ['is_not', 'is not'], ['above', 'is above'], ['below', 'is below'], ['unavailable', 'is unavailable or unknown']];

/** A plain entity id (what the entity chooser adds) becomes a check object; an object stays as it is. */
export const asCheck = (v) => (typeof v === 'string' ? { entity: v } : { ...v });

/** Keep a check tidy: drop empty name/text so the saved bindings stay small. */
export function tidyCheck(k) {
  const out = { ...k };
  for (const key of ['name', 'text']) if (typeof out[key] === 'string' && !out[key].trim()) delete out[key]; else if (typeof out[key] === 'string') out[key] = out[key].trim().slice(0, 80);
  return out;
}

/**
 * ctx = { h, icon, checks (the slot's list), friendly(id), edit(fn: (list) => void), add() }
 * `edit` hands over a copy of the list of check objects; whatever the function leaves in it is saved.
 */
export function warningsEditor(ctx) {
  const { h, icon } = ctx;
  const list = (ctx.checks || []).map(asCheck);
  const root = h('div', { class: 'warnings' });
  list.forEach((k, i) => {
    const t = checkTest(k);
    const set = (patch) => ctx.edit((rows) => { rows[i] = tidyCheck({ ...rows[i], ...patch }); });
    const retest = (test, value) => ctx.edit((rows) => { rows[i] = tidyCheck(withTest(rows[i], test, value)); });
    const card = h('div', { class: 'rulecard', 'data-check': i + 1 });
    card.append(h('div', { class: 'row' },
      h('b', { class: 'grow', text: ctx.friendly(k.entity), title: k.entity }),
      h('button', { class: 'btn sm ghost danger', title: 'Remove this warning', onClick: () => ctx.edit((rows) => { rows.splice(i, 1); }) }, icon('x'))));
    card.append(h('input', { class: 'field', 'data-field': 'name', type: 'text', maxlength: 80, placeholder: 'Name to show (default: the entity’s id)', value: k.name || '', onChange: (ev) => set({ name: ev.target.value }) }));
    card.append(h('div', { class: 'row' },
      h('span', { class: 'hint', text: 'Warn when it' }),
      h('select', { class: 'field', style: 'width:auto', 'data-field': 'test', onChange: (ev) => {
        const test = ev.target.value;
        retest(test, test === 'above' || test === 'below' ? (Number.isFinite(Number(t.value)) ? t.value : 0) : (Array.isArray(t.value) ? t.value : ['on']));
      } }, TESTS.map(([v, text]) => h('option', { value: v, selected: t.test === v, text })))));
    if (t.test === 'above' || t.test === 'below') {
      card.append(h('input', { class: 'field', 'data-field': 'value', type: 'number', value: t.value, onChange: (ev) => { const n = parseFloat(ev.target.value); if (Number.isFinite(n)) retest(t.test, n); } }));
    } else if (t.test === 'is' || t.test === 'is_not') {
      card.append(h('input', { class: 'field', 'data-field': 'value', type: 'text', maxlength: 200, value: [].concat(t.value).join(', '),
        placeholder: 'a state, like on or open (several: separate with commas)', onChange: (ev) => retest(t.test, ev.target.value) }));
    }
    // only at certain times of day: off = any time; on = a window (later "from" than "to" runs through midnight)
    const w = checkWindow(k);
    card.append(h('label', { class: 'check' },
      h('input', { type: 'checkbox', 'data-field': 'timed', checked: !!w, onChange: (ev) => ctx.edit((rows) => {
        const r = { ...rows[i] };
        if (ev.target.checked) { r.from = '22:00'; r.to = '06:00'; } else { delete r.from; delete r.to; }
        rows[i] = tidyCheck(r);
      }) }), 'Only at certain times'));
    if (w) {
      const at = (key, other) => h('input', { class: 'field', type: 'time', style: 'width:auto', 'data-field': key, value: w[key],
        onChange: (ev) => {
          const v = String(ev.target.value).slice(0, 5);
          if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) && v !== w[other]) set({ [key]: v }); else ev.target.value = w[key];     // two different real times only
        } });
      card.append(h('div', { class: 'row' }, h('span', { class: 'hint', text: 'between' }), at('from', 'to'), h('span', { class: 'hint', text: 'and' }), at('to', 'from')));
    }
    card.append(h('input', { class: 'field', 'data-field': 'text', type: 'text', maxlength: 80, placeholder: 'Words after the name, like “is open” (default: what it is)', value: k.text || '', onChange: (ev) => set({ text: ev.target.value }) }));
    card.append(h('div', { class: 'sentence', text: describeCheck(k) }));
    root.append(card);
  });
  if (!list.length) root.append(h('div', { class: 'hint', text: 'Nothing is watched yet, so this shows “All good”. Add the things worth a warning: a door, a battery, a leak sensor.' }));
  root.append(h('button', { class: 'btn sm', 'data-field': 'add-check', onClick: () => ctx.add() }, icon('plus'), 'Add a warning'));
  return root;
}
