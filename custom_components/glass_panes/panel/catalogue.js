// The widget catalogue: one card per kind of widget, with a live preview (made-up data), a line about what it does, and what to bind to
// it. The cards are generated from schema/widgets.json (label, description, needs, slots), so a new widget appears here by being added
// to the registry, and a test fails if one has no description.

import { PaneRenderer } from '/glass_panes/player/engine.js';
import { MockClient, mockBindings } from '/glass_panes/player/mock.js';
import { catalogueEntries, DEFAULTS } from './ops.js';

export const CATALOGUE_CSS = `
.catalogue { position: fixed; inset: 0; z-index: 60; overflow: auto; background: var(--ui-bg, #f3f1e3); padding: 18px clamp(12px, 3vw, 32px) 40px; }
.catalogue header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.catalogue header h2 { margin: 0; font-size: 20px; flex: 1; }
.catalogue .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.catalogue .wcard { background: var(--ui-surface, #fff); border: 1px solid var(--ui-line, #ddd); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.catalogue .wcard h3 { margin: 0; font-size: 15px; }
.catalogue .wprev { position: relative; height: 150px; overflow: hidden; border-radius: 10px; background: #000; }
.catalogue .wprev .gp-stage { position: absolute; left: 0; top: 0; transform-origin: top left; }
.catalogue .wprev .none { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #8a8a8a; font-size: 12px; padding: 8px; text-align: center; }
.catalogue .needs { font-size: 12.5px; color: var(--ui-muted, #666); }
`;

const PREVIEW_W = 256, PREVIEW_H = 150;

/**
 * Open the catalogue over the builder. ctx = { h, icon, root (the element to put it in), registry, defaults, time, onAdd(type, label) | null }.
 * Returns a function that closes it.
 */
export function openCatalogue(ctx) {
  const { h, root, registry, defaults, time, onAdd } = ctx;
  const mock = new MockClient(time);
  const renderers = [];
  const page = h('div', { class: 'catalogue', role: 'dialog', 'aria-label': 'Widget catalogue' });
  const close = () => { renderers.forEach((r) => r.clear()); page.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  page.append(h('header', {}, h('h2', { text: 'Widget catalogue' }), h('button', { class: 'btn sm', 'data-field': 'catalogue-close', onClick: close }, 'Close')));
  const cards = h('div', { class: 'cards' });
  catalogueEntries(registry, defaults || DEFAULTS).forEach((e) => {
    const prev = h('div', { class: 'wprev' });
    const card = h('div', { class: 'wcard', 'data-widget-type': e.type }, prev, h('h3', { text: e.label }), h('div', { text: e.description }));
    card.append(h('div', { class: 'needs', text: e.needs ? 'Bind: ' + e.needs : 'Nothing to bind: it needs no entity.' }));
    if (onAdd && e.box) card.append(h('button', { class: 'btn sm', 'data-field': 'catalogue-add', onClick: () => { close(); onAdd(e.type, e.label); } }, 'Add to this pane'));
    cards.append(card);
    if (!e.pane) { prev.append(h('div', { class: 'none', text: e.box ? 'Shown on the display itself, not in a browser.' : 'Set up in its own editor.' })); return; }
    const stage = h('div', { class: 'gp-stage' });
    stage.style.width = e.box.w + 'px'; stage.style.height = (e.box.auto ? 400 : e.box.h) + 'px';
    const scale = Math.min(PREVIEW_W / e.box.w, e.box.auto ? 1 : PREVIEW_H / e.box.h, 1);
    stage.style.transform = 'scale(' + scale + ')';
    prev.append(stage);
    const r = new PaneRenderer({ stage, client: mock, time, onError: () => { /* a preview may fail quietly */ } });
    renderers.push(r);
    try { r.show(e.pane, mockBindings(registry, e.pane)); } catch (err) { prev.append(h('div', { class: 'none', text: 'No preview.' })); }
  });
  page.append(cards);
  root.append(page);
  return close;
}
