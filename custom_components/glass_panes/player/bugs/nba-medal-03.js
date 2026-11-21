// "Medallion '03": after the NBA score box on TNT (2002-04). A pale blue-silver box: the league's logo in a cell at the left, the two
// teams' letters and scores in dark navy cells, a black pill under it with the clock and the quarter in a small red disc, and a big round
// black medallion with a gold ring hanging off the right side. The network's mark in the medallion becomes the Home Assistant logo.
// Drawn soft, with scanlines, the way it looked on a 2003 TV (bug_tv: clean turns that off).
import { el } from '../util.js';
import { statusText, leagueLogo, haMark, marks } from './kit.js';

const W = 460, H = 170;

export default {
  id: 'nba-medal-03',
  size: { w: W, h: H },
  tv: 'soft',
  fonts: [{ family: 'GP Inter', file: 'inter-latin-600-normal.woff2', desc: { weight: '600' } }],
  css: `
.sb-nba-medal-03 { font-family: 'GP Inter', Arial, sans-serif; font-weight: 600; color: #fff; }
.sb-nba-medal-03 .box { position: absolute; left: 0; top: 10px; width: 312px; height: 104px; border-radius: 4px; background: linear-gradient(#f3f6fb, #b9c6dc 50%, #93a4c4);
  box-shadow: 0 2px 4px rgba(0,0,0,.5); }
.sb-nba-medal-03 .lg { position: absolute; left: 6px; top: 6px; width: 44px; height: 92px; overflow: hidden; background: linear-gradient(#cdd8ec, #8ea2c6);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.7); }
.sb-nba-medal-03 .lg .sb-league { position: absolute; left: 50%; top: 50%; width: 92px; height: 92px; transform: translate(-50%, -50%) scale(1.05); }
.sb-nba-medal-03 .lg .sb-league-text { color: #142251; writing-mode: vertical-rl; }
.sb-nba-medal-03 .r { position: absolute; left: 56px; right: 6px; height: 44px; display: grid; grid-template-columns: 1fr 82px; gap: 4px; }
.sb-nba-medal-03 .r span { background: linear-gradient(#26386e, #142251); display: flex; align-items: center; font-size: 36px; letter-spacing: .5px; padding: 0 12px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
.sb-nba-medal-03 .r .s { justify-content: flex-end; }
.sb-nba-medal-03 .pill { position: absolute; left: 60px; top: 118px; width: 230px; height: 48px; border-radius: 24px; background: linear-gradient(#2b2b2b, #050505);
  box-shadow: inset 0 0 0 2px #9aa3ad; display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 36px; letter-spacing: 1px; }
.sb-nba-medal-03 .q { width: 38px; height: 38px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #ff5a4f, #c2140c 70%); box-shadow: 0 0 0 2px #f2f2f2;
  display: grid; place-items: center; font-size: 26px; letter-spacing: 0; }
.sb-nba-medal-03 .med { position: absolute; left: 306px; top: 2px; width: 146px; height: 146px; border-radius: 50%; background: radial-gradient(circle at 45% 35%, #3a3a3a, #0b0b0b 65%);
  box-shadow: 0 0 0 7px #c7a33c, 0 0 0 10px #5a4612, 0 3px 8px 10px rgba(0,0,0,.35); display: grid; place-items: center; text-align: center; color: #f2d36b; }
.sb-nba-medal-03 .med .sb-ha { filter: drop-shadow(0 2px 2px #000); }
.sb-nba-medal-03 .med .w { font-size: 26px; line-height: 1.1; padding: 0 10px; }
`,
  draw(root, g, { time, opts }) {
    const mk = marks(opts);
    const box = el('div', 'box');
    if (mk.league) { const lg = el('div', 'lg'); lg.appendChild(leagueLogo(g, 92)); box.appendChild(lg); }
    else box.style.width = '262px';
    [g.away, g.home].forEach((t, i) => {
      const r = el('div', 'r');
      r.style.top = (6 + i * 48) + 'px';
      if (!mk.league) r.style.left = '6px';
      r.append(el('span', '', (t.abbr || '').toUpperCase()), el('span', 's', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      box.appendChild(r);
    });
    const live = g.status === 'live';
    const med = el('div', 'med');
    if (!live) med.appendChild(el('div', 'w', statusText(g, time)));
    else if (mk.ha) med.appendChild(haMark(86));
    root.append(box, med);
    if (live) {
      const pill = el('div', 'pill');
      if (g.clock) pill.appendChild(el('span', '', g.clock));
      pill.appendChild(el('span', 'q', g.period.word ? g.period.label.slice(0, 2) : g.period.label));
      root.appendChild(pill);
    }
  },
};
