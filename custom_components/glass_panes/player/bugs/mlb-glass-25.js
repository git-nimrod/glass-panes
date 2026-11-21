// "Dark glass '25": after the MLB bug on Apple TV (2022-2025). A quiet, see-through dark card with round corners and light type: the
// away logo and score, the bases as faint grey diamonds (lit white when someone is on), the home score and logo; under that, the half
// inning (a yellow arrow), the outs as faint dots and the count; and two small lines at the bottom with a coloured tick for each team
// (on air the pitcher and batter; here each team's name and record).
import { el } from '../util.js';
import { logo, bases, pips, statusText, teamColor } from './kit.js';

const W = 600, H = 300;

export default {
  id: 'mlb-glass-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Inter', file: 'inter-latin-600-normal.woff2', desc: { weight: '600' } }],
  css: `
.sb-mlb-glass-25 { font-family: 'GP Inter', -apple-system, 'Segoe UI', sans-serif; font-weight: 600; color: #f4f4f4; }
.sb-mlb-glass-25 .card { position: absolute; inset: 0; border-radius: 22px; background: rgba(22,24,28,.78); box-shadow: 0 4px 14px rgba(0,0,0,.35); }
.sb-mlb-glass-25 .top { position: absolute; left: 26px; right: 26px; top: 14px; height: 100px; display: grid; grid-template-columns: 100px 90px 1fr 90px 100px; align-items: center; }
.sb-mlb-glass-25 .sb-logo { width: 92px; height: 86px; object-fit: contain; }
.sb-mlb-glass-25 .s { font-size: 70px; text-align: center; }
.sb-mlb-glass-25 .top .sb-bases { justify-self: center; }
.sb-mlb-glass-25 .sb-bases i { background: rgba(255,255,255,.2); border-radius: 3px; } .sb-mlb-glass-25 .sb-bases i.on { background: #f4f4f4; }
.sb-mlb-glass-25 .row { position: absolute; left: 26px; right: 26px; top: 120px; height: 50px; display: grid; grid-template-columns: 190px 1fr 190px; align-items: center; font-size: 34px; }
.sb-mlb-glass-25 .row .h { padding-left: 34px; } .sb-mlb-glass-25 .row .h b { color: #f2c832; font-size: 26px; margin-right: 6px; }
.sb-mlb-glass-25 .row .c { text-align: center; padding-right: 34px; }
.sb-mlb-glass-25 .sb-pips { display: flex; gap: 12px; justify-content: center; } .sb-mlb-glass-25 .sb-pips i { width: 20px; height: 20px; border-radius: 50%; background: #f4f4f4; }
.sb-mlb-glass-25 .sb-pips i.used { background: rgba(255,255,255,.2); }
.sb-mlb-glass-25 .ln { position: absolute; left: 30px; right: 30px; height: 36px; display: flex; align-items: center; justify-content: space-between; font-size: 27px; }
.sb-mlb-glass-25 .ln span:first-child { border-left: 5px solid; padding-left: 12px; }
.sb-mlb-glass-25 .w { grid-column: 1 / 4; text-align: center; font-size: 32px; }
`,
  draw(root, g, { time }) {
    const live = g.status === 'live' && !!g.baseball; // a baseball bug forced onto another sport's game shows only the scores
    const card = el('div', 'card');
    const sc = (t) => el('span', 's', g.status !== 'pre' && t.score != null ? String(t.score) : '');
    const top = el('div', 'top');
    top.append(logo(g.away, 92), sc(g.away), bases(live ? g.baseball.bases : null, 36), sc(g.home), logo(g.home, 92));
    const row = el('div', 'row');
    if (live) {
      const b = g.baseball, h = el('span', 'h');
      h.appendChild(el('b', '', b.half === 'bot' ? '▼' : b.half === 'top' ? '▲' : ''));
      h.appendChild(document.createTextNode(g.period.label + (g.period.suffix || '').toLowerCase()));
      row.append(h, pips(b.outs, 2), el('span', 'c', b.balls + '-' + b.strikes));
    } else row.appendChild(el('span', 'w', statusText(g, time)));
    card.append(top, row);
    [g.away, g.home].forEach((t, i) => {
      const ln = el('div', 'ln');
      ln.style.top = (194 + i * 44) + 'px';
      const n = el('span', '', String(t.name || t.abbr || ''));
      n.style.borderColor = teamColor(t, '#888');
      ln.append(n, el('span', '', t.record || ''));
      card.appendChild(ln);
    });
    root.appendChild(card);
  },
};
