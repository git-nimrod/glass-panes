// "Box '94": after the first always-on score box, FOX's NFL coverage from August 1994 (and its NHL games from 1995). A small see-through
// wafer in the top corner with a light outline: a rounded end holding the clock over the quarter, a slash, then a parallelogram with the
// two teams' letters and scores in two rows. Bold condensed type. Drawn soft, with scanlines, the way it looked on a 1994 TV
// (bug_tv: clean turns that off).
import { el } from '../util.js';
import { statusText } from './kit.js';

const W = 380, H = 112;

export default {
  id: 'box-94',
  size: { w: W, h: H },
  tv: 'soft',
  fonts: [{ family: 'GP Barlow Condensed', file: 'sports/barlow-condensed-latin-700-normal.woff2', desc: { weight: '700' } }],
  css: `
.sb-box-94 { font-family: 'GP Barlow Condensed', 'Arial Narrow', sans-serif; font-weight: 700; color: #e9ece6; text-shadow: 0 0 2px rgba(0,0,0,.6); }
.sb-box-94 .frame { position: absolute; inset: 0; pointer-events: none; }
.sb-box-94 .col { position: absolute; top: 12px; display: grid; line-height: 44px; font-size: 44px; letter-spacing: 1px; }
.sb-box-94 .row { display: flex; justify-content: space-between; width: 150px; }
`,
  draw(root, g, { time }) {
    // the outline is one SVG path so the slash and the parallelogram share it, like the original
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'frame'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H);
    const shape = (d) => { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'rgba(28,34,30,.48)'); p.setAttribute('stroke', '#d9ddd6'); p.setAttribute('stroke-width', '5'); p.setAttribute('stroke-linejoin', 'round'); return p; };
    svg.appendChild(shape('M 150 8 L 56 8 A 48 48 0 0 0 56 104 L 104 104 Z'));
    svg.appendChild(shape('M 168 8 L 372 8 L 320 104 L 116 104 Z'));
    root.appendChild(svg);
    const left = el('div', 'col');
    left.style.left = '26px'; left.style.justifyItems = 'center'; left.style.width = '100px'; left.style.fontSize = '40px'; left.style.letterSpacing = '0';
    if (g.status === 'live') {
      left.append(el('span', '', g.clock || ''), el('span', '', g.period.label + (g.period.suffix || '')));
    } else {
      const s = statusText(g, time).split(' ');
      left.append(el('span', '', s[0] || ''), el('span', '', s.slice(1).join(' ')));
      left.style.fontSize = '34px';
    }
    const right = el('div', 'col');
    right.style.left = '178px';
    [g.away, g.home].forEach((t, i) => {
      const r = el('div', 'row');
      r.style.marginLeft = (i ? -26 : 0) + 'px';
      r.append(el('span', '', (t.abbr || '').toUpperCase().slice(0, 3)), el('span', '', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      right.appendChild(r);
    });
    root.append(left, right);
  },
};
