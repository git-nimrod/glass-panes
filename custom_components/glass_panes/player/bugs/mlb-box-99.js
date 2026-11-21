// "Diamond box '99": after the MLB score box on FOX (1998 playoffs to 2000). A small see-through slate box with a light grey edge in the top
// corner: a top line of grey plates with the half inning (the network's plate at its left now holds the Home Assistant logo), a big diamond of white bases at the left, the
// two teams' letters and scores in bold condensed type at the right, and a bottom line with the count and outs (on air, often the pitch
// speed). Drawn soft, with scanlines, the way it looked on a 1999 TV (bug_tv: clean turns that off).
import { el } from '../util.js';
import { bases, statusText, haMark, marks } from './kit.js';

const W = 330, H = 206;

export default {
  id: 'mlb-box-99',
  size: { w: W, h: H },
  tv: 'soft',
  fonts: [{ family: 'GP Barlow Condensed', file: 'sports/barlow-condensed-latin-700-normal.woff2', desc: { weight: '700' } }],
  css: `
.sb-mlb-box-99 { font-family: 'GP Barlow Condensed', 'Arial Narrow', sans-serif; font-weight: 700; color: #f4f4f0; }
.sb-mlb-box-99 .bx { position: absolute; inset: 0; background: rgba(34,36,48,.78); border: 3px solid #b9bbbf; border-radius: 3px; box-shadow: 0 2px 6px rgba(0,0,0,.5); }
.sb-mlb-box-99 .t { position: absolute; left: 6px; right: 6px; top: 6px; height: 40px; display: flex; gap: 6px; font-size: 34px; letter-spacing: 1px; }
.sb-mlb-box-99 .t > span { display: grid; place-items: center; border-radius: 2px; }
.sb-mlb-box-99 .t .slot { width: 96px; background: linear-gradient(#e6e7e9, #a9acb1); color: #26282d; }
.sb-mlb-box-99 .t .arr { width: 40px; background: #26282d; font-size: 22px; box-shadow: inset 0 0 0 2px #8d9094; }
.sb-mlb-box-99 .t .inn { flex: 1; background: linear-gradient(#e6e7e9, #a9acb1); color: #26282d; }
.sb-mlb-box-99 .dia { position: absolute; left: 6px; top: 58px; }
.sb-mlb-box-99 .sb-bases i { background: #2b2d33; border: 3px solid #d9dbde; } .sb-mlb-box-99 .sb-bases i.on { background: #f7f7f2; }
.sb-mlb-box-99 .r { position: absolute; left: 132px; right: 10px; display: flex; justify-content: space-between; font-size: 54px; line-height: 54px; letter-spacing: 1px; text-shadow: 2px 2px 0 #000; }
.sb-mlb-box-99 .r .s { padding: 0 6px; min-width: 40px; text-align: right; background: rgba(0,0,0,.55); }
.sb-mlb-box-99 .b { position: absolute; left: 6px; right: 6px; bottom: 6px; height: 40px; display: flex; align-items: center; justify-content: center; gap: 26px;
  background: rgba(10,10,14,.7); font-size: 34px; letter-spacing: 1px; text-shadow: 2px 2px 0 #000; }
`,
  draw(root, g, { time, opts }) {
    const live = g.status === 'live' && !!g.baseball; // a baseball bug forced onto another sport's game shows only the scores
    const mk = marks(opts);
    const bx = el('div', 'bx');
    const t = el('div', 't');
    // the network's grey box at the left now holds the Home Assistant logo
    const slot = el('span', 'slot');
    if (mk.ha) slot.appendChild(haMark(32));
    t.appendChild(slot);
    const half = live && g.baseball.half;
    if (live) t.appendChild(el('span', 'arr', half === 'top' ? '▲' : half === 'bot' ? '▼' : '•'));
    t.appendChild(el('span', 'inn', live ? g.period.label + (g.period.suffix || '') : statusText(g, time)));
    bx.appendChild(t);
    const dia = el('div', 'dia');
    dia.appendChild(bases(live ? g.baseball.bases : null, 36));
    bx.appendChild(dia);
    [g.away, g.home].forEach((tm, i) => {
      const r = el('div', 'r');
      r.style.top = (54 + i * 56) + 'px';
      r.append(el('span', '', (tm.abbr || '').toUpperCase().slice(0, 3)), el('span', 's', g.status !== 'pre' && tm.score != null ? String(tm.score) : ''));
      bx.appendChild(r);
    });
    const b = el('div', 'b');
    if (live) b.append(el('span', '', g.baseball.balls + '-' + g.baseball.strikes), el('span', '', g.baseball.outs + ' OUT'));
    bx.appendChild(b);
    root.appendChild(bx);
  },
};
