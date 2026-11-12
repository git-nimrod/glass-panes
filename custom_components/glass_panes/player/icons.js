// The icon library: Material Design Icons (Pictogrammers, Apache 2.0; licence in icons/LICENSE-mdi.txt).
//
// The display never downloads the library. It asks Home Assistant for the icons a pane actually draws (`/glass_panes/icons?names=...`,
// see icons.py) and gets back just those paths, a few hundred bytes each, which it keeps for the rest of the session. Asks made in the
// same moment travel as one request. The list of all names (icons/names.json) is for the builder's picker only.
//
// An icon is named the way Home Assistant names it without the prefix: "thermometer" (an entity's own icon arrives as "mdi:thermometer").

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_PER_REQUEST = 64;                          // the same limit Home Assistant applies

/** "mdi:thermometer" or "thermometer" -> "thermometer"; anything that is not a plain icon name -> ''. Icons from other sets (hue:, phu:) are not bundled. */
export function cleanIconName(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim().replace(/^mdi:/, '');
  return v.length <= 64 && NAME.test(v) ? v : '';
}

const paths = new Map();             // name -> path, or null for a name Home Assistant does not know
const asked = new Map();             // name -> promise, while an ask is under way
let queue = null;                    // { names: Set, waiters: Map(name -> [resolve]) } collected until the next tick

function flush() {
  const batch = queue; queue = null;
  const names = [...batch.names];
  for (let i = 0; i < names.length; i += MAX_PER_REQUEST) {
    const chunk = names.slice(i, i + MAX_PER_REQUEST);
    fetch(new URL('../icons?names=' + chunk.join(','), import.meta.url))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((found) => chunk.forEach((n) => { const d = typeof found[n] === 'string' ? found[n] : null; paths.set(n, d); done(batch, n, d); }))
      .catch(() => chunk.forEach((n) => done(batch, n, null)));          // not remembered: a later draw may try again
  }
}

function done(batch, name, d) {
  asked.delete(name);
  (batch.waiters.get(name) || []).forEach((resolve) => resolve(d));
}

/** The path data (the `d` of an svg path, 24 x 24) of an icon, or null when there is no such icon or Home Assistant could not be asked. */
export function loadIcon(value) {
  const name = cleanIconName(value);
  if (!name) return Promise.resolve(null);
  if (paths.has(name)) return Promise.resolve(paths.get(name));
  if (asked.has(name)) return asked.get(name);
  const promise = new Promise((resolve) => {
    if (!queue) { queue = { names: new Set(), waiters: new Map() }; setTimeout(flush, 0); }
    queue.names.add(name);
    if (!queue.waiters.has(name)) queue.waiters.set(name, []);
    queue.waiters.get(name).push(resolve);
  });
  asked.set(name, promise);
  return promise;
}

/** An svg element that draws the path at `size` pixels in the text colour. */
export function iconNode(d, size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'display:inline-block;flex:none;vertical-align:middle;fill:currentColor';
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

/**
 * Which icon a widget shows: a style rule's icon wins, then the widget's own `icon` option, and "auto" means the entity's own icon.
 * `st` is the entity's state (for its `icon` attribute). Returns a clean name or ''.
 */
export function chosenIcon(ruleIcon, optionIcon, st) {
  if (ruleIcon) return cleanIconName(ruleIcon);
  if (optionIcon === 'auto') return cleanIconName(st && st.attributes ? st.attributes.icon : '');
  return cleanIconName(optionIcon);
}
