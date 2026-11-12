// The builder's icon chooser: a box that shows the current icon, a search field and a grid of matches. Used by the Icon widget, the
// entity widgets' icon option and the conditional-formatting rules. The list of names loads only when the chooser is first opened.

import { loadIcon, iconNode, cleanIconName } from '/glass_panes/player/icons.js';
import { searchIcons } from './ops.js';

let names = null;
async function allNames() {
  if (!names) {
    try { const r = await fetch('/glass_panes/player/icons/names.json'); names = r.ok ? await r.json() : []; } catch (e) { names = []; }
  }
  return names;
}

async function drawInto(host, name, size) {
  const d = await loadIcon(name);
  host.textContent = '';
  if (d) host.appendChild(iconNode(d, size));
}

/**
 * options = { value, onPick(name | ''), auto: bool (offer "the entity's own icon"), emptyLabel }
 * value is an icon name, 'auto', or ''. Returns the element.
 */
export function iconField(h, { value, onPick, auto = false, emptyLabel = 'No icon' }) {
  const shown = h('span', { class: 'iconpreview', style: 'display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center' });
  const label = value === 'auto' ? 'The entity’s own icon' : cleanIconName(value) || emptyLabel;
  if (cleanIconName(value)) drawInto(shown, value, 24);
  const grid = h('div', { class: 'icongrid', style: 'display:none;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:4px;margin-top:6px;max-height:220px;overflow:auto' });
  const search = h('input', { class: 'field', type: 'text', placeholder: 'Search icons: thermometer, door, sun …', 'data-field': 'icon-search', style: 'display:none;margin-top:6px', autocomplete: 'off', spellcheck: 'false' });
  const fill = async () => {
    const list = searchIcons(await allNames(), search.value);
    grid.textContent = '';
    list.forEach((n) => {
      const cell = h('button', { class: 'btn sm ghost', title: n, 'data-icon': n, style: 'padding:6px;min-width:0', onClick: () => onPick(n) });
      grid.append(cell);
      drawInto(cell, n, 22);
    });
    if (!list.length) grid.append(h('div', { class: 'hint', text: 'No icon has that name.' }));
  };
  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(fill, 150); });
  const toggle = h('button', { class: 'btn sm', 'data-field': 'icon-choose', onClick: () => {
    const open = grid.style.display === 'none';
    grid.style.display = open ? 'grid' : 'none'; search.style.display = open ? '' : 'none';
    if (open) { fill(); search.focus(); }
  } }, 'Choose…');
  const clear = value ? h('button', { class: 'btn sm ghost', title: 'Remove the icon', 'data-field': 'icon-clear', onClick: () => onPick('') }, '×') : null;
  const autoBtn = auto && value !== 'auto' ? h('button', { class: 'btn sm ghost', 'data-field': 'icon-auto', title: 'Use the icon the entity already has in Home Assistant', onClick: () => onPick('auto') }, 'Entity’s own') : null;
  return h('div', { class: 'iconfield' },
    h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' }, shown, h('span', { class: 'hint', 'data-role': 'icon-name', text: label }), toggle, autoBtn, clear),
    search, grid);
}
