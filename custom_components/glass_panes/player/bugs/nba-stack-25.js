// "Stacked box '25": after the NBA bug on Prime Video (2025-26 on). A small, square box low in the frame: a dark top line, a row with
// the quarter and the clock on a light pill, then the two logos side by side (the away team on its colour, the home team on black) with
// the scores between them, and each team's seed and letters under its logo. The streamer's mark under the scores becomes the Home Assistant logo; the league's logo opens the top line.
import { el } from '../util.js';
import { logo, ordinal, statusText, teamColor, shade, leagueLogo, haMark, marks } from './kit.js';

const W = 430, H = 214;

export default {
  id: 'nba-stack-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Inter', file: 'inter-latin-600-normal.woff2', desc: { weight: '600' } },
    { family: 'GP Montserrat Heavy', file: 'montserrat-latin-wght-normal.woff2', desc: { weight: '600 900' } }],
  css: `
.sb-nba-stack-25 { font-family: 'GP Montserrat Heavy', 'Montserrat', 'Arial Black', sans-serif; color: #fff; }
.sb-nba-stack-25 .top { position: absolute; left: 0; right: 0; top: 0; height: 34px; background: rgba(12,14,18,.82); display: flex; align-items: center; justify-content: center; gap: 14px;
  font-family: 'GP Inter', sans-serif; font-style: italic; font-weight: 600; font-size: 17px; letter-spacing: .3px; color: #eee; border-radius: 4px 4px 0 0; }
.sb-nba-stack-25 .top i { width: 2px; height: 18px; background: rgba(255,255,255,.4); }
.sb-nba-stack-25 .clk { position: absolute; left: 0; right: 0; top: 34px; height: 44px; background: #17191d; display: flex; align-items: center; justify-content: center; gap: 12px; }
.sb-nba-stack-25 .q { font-weight: 700; font-size: 22px; } .sb-nba-stack-25 .sb-ord { font-size: .64em; vertical-align: 7px; }
.sb-nba-stack-25 .pill { background: linear-gradient(#f4f4f4, #cfd2d6); color: #121417; border-radius: 6px; padding: 0 12px; font-weight: 800; font-size: 30px; line-height: 38px; }
.sb-nba-stack-25 .when { font-weight: 800; font-size: 24px; }
.sb-nba-stack-25 .row { position: absolute; left: 0; right: 0; top: 78px; height: 96px; display: grid; grid-template-columns: 1fr 1fr; }
.sb-nba-stack-25 .half { position: relative; display: flex; align-items: center; overflow: hidden; }
.sb-nba-stack-25 .half.home { flex-direction: row-reverse; background: #0e0f12; }
.sb-nba-stack-25 .half .sb-logo { flex: none; width: 140px; height: 132px; object-fit: contain; }
.sb-nba-stack-25 .away .sb-logo { margin-left: -26px; } .sb-nba-stack-25 .home .sb-logo { margin-right: -26px; }
.sb-nba-stack-25 .top .sb-league { width: 26px; height: 26px; }
.sb-nba-stack-25 .ids .sb-ha { color: #f2f2f2; }
.sb-nba-stack-25 .s { flex: 1; text-align: center; font-weight: 800; font-size: 60px; text-shadow: 0 2px 2px rgba(0,0,0,.35); }
.sb-nba-stack-25 .ids { position: absolute; left: 0; right: 0; top: 174px; height: 40px; display: flex; justify-content: space-between; align-items: center; padding: 0 18px;
  background: rgba(12,14,18,.82); border-radius: 0 0 4px 4px; font-weight: 800; font-size: 24px; }
.sb-nba-stack-25 .ids sup { font-size: 14px; vertical-align: 6px; margin-right: 3px; color: #ccc; }
`,
  draw(root, g, { time, opts }) {
    const mk = marks(opts);
    const live = g.status === 'live';
    const top = el('div', 'top');
    if (mk.league) top.appendChild(leagueLogo(g, 26, null, true));
    if (g.away.record || g.home.record) top.append(el('span', '', g.away.record), el('i'), el('span', '', g.home.record));
    else top.appendChild(el('span', '', g.league));
    const clk = el('div', 'clk');
    if (live) { clk.appendChild(ordinal(g.period, 'q')); if (g.clock) clk.appendChild(el('span', 'pill', g.clock)); }
    else clk.appendChild(el('span', 'when', statusText(g, time)));
    const row = el('div', 'row');
    [['away', g.away], ['home', g.home]].forEach(([s, t]) => {
      const h = el('div', 'half ' + s);
      if (s === 'away') { const c = teamColor(t, '#4a4f57'); h.style.background = 'linear-gradient(' + shade(c, 0.05) + ', ' + shade(c, -0.3) + ')'; }
      h.append(logo(t, 140), el('span', 's', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      row.appendChild(h);
    });
    const ids = el('div', 'ids');
    [g.away, g.home].forEach((t) => {
      const sp = el('span');
      if (t.rank) sp.appendChild(el('sup', '', String(t.rank)));
      sp.appendChild(document.createTextNode((t.abbr || '').toUpperCase()));
      ids.appendChild(sp);
      if (t === g.away && mk.ha) ids.appendChild(haMark(26));   // the streamer's mark sat under the scores
    });
    root.append(top, clk, row, ids);
  },
};
