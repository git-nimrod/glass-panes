// "Gilt frame '25": after the NBA bar on ESPN and ABC (2024-25 on, seen here in its Finals dress). A long, low bar inside a thin gold
// frame: a dark slot at the left end (where the network's mark sits on air; here the Home Assistant logo), each team a flat block of its
// colour with its letters and score, then a dark block with the quarter and the clock in a gold-edged pill. Underneath, a second row: the
// team's timeouts as dashes under each block, and a gold plate on the right with the records or the game's status.
import { el } from '../util.js';
import { ordinal, pips, statusText, teamColor, shade, inkOn, leagueLogo, haMark, marks } from './kit.js';

const W = 1500, H = 160, ROW = 88;

export default {
  id: 'nba-gilt-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Archivo Expanded', file: 'sports/archivo-expanded-latin.woff2', desc: { weight: '800', stretch: '125%' } }],
  css: `
.sb-nba-gilt-25 { font-family: 'GP Archivo Expanded', 'Arial Black', sans-serif; font-weight: 800; color: #fff; }
.sb-nba-gilt-25 .fr { position: absolute; inset: 0; box-sizing: border-box; border: 4px solid #b8a46c; background: rgba(18,22,26,.55); box-shadow: 0 3px 8px rgba(0,0,0,.45);
  display: grid; grid-template-columns: 190px 400px 400px 1fr; grid-template-rows: ${ROW}px 1fr; }
.sb-nba-gilt-25 .slot { background: #1d2328; display: grid; place-items: center; font-size: 40px; color: #c9b88a; letter-spacing: 2px; border-right: 3px solid #b8a46c; }
.sb-nba-gilt-25 .tm { display: flex; align-items: center; justify-content: space-between; padding: 0 30px 0 26px; font-size: 48px; position: relative; }
.sb-nba-gilt-25 .tm::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: rgba(255,255,255,.28); }
.sb-nba-gilt-25 .tm .s { font-size: 58px; }
.sb-nba-gilt-25 .clock { background: #1d2328; display: flex; align-items: center; justify-content: space-evenly; border-left: 3px solid #b8a46c; }
.sb-nba-gilt-25 .q { font-size: 46px; } .sb-nba-gilt-25 .sb-ord { font-size: .62em; vertical-align: 16px; }
.sb-nba-gilt-25 .pill { border: 3px solid #b8a46c; border-radius: 40px; padding: 2px 34px; font-size: 52px; letter-spacing: 4px; color: #e9dfc0; }
.sb-nba-gilt-25 .when { font-size: 40px; color: #e9dfc0; }
.sb-nba-gilt-25 .low { grid-row: 2; display: grid; place-items: center; background: rgba(10,14,18,.35); }
.sb-nba-gilt-25 .low.l0 { grid-column: 1; } .sb-nba-gilt-25 .low + .low { border-left: 2px solid rgba(255,255,255,.12); }
.sb-nba-gilt-25 .sb-pips { display: flex; gap: 12px; }
.sb-nba-gilt-25 .sb-pips i { width: 30px; height: 6px; background: #e6e6e6; } .sb-nba-gilt-25 .sb-pips i.used { opacity: .2; }
.sb-nba-gilt-25 .plate .sb-league { width: 56px; height: 56px; }
.sb-nba-gilt-25 .plate { grid-row: 2; grid-column: 4; display: flex; align-items: center; justify-content: center; gap: 40px; font-size: 32px; color: #1d2328;
  background: linear-gradient(#e6d6a6, #c3ac6c); border-left: 3px solid #b8a46c; }
`,
  draw(root, g, { time, opts }) {
    const mk = marks(opts);
    const live = g.status === 'live';
    const fr = el('div', 'fr');
    // the network's wordmark sat in this slot; now the Home Assistant logo (or the league's letters)
    const slot = el('div', 'slot', mk.ha ? '' : g.league || '');
    if (mk.ha) slot.appendChild(haMark(58));
    fr.appendChild(slot);
    [g.away, g.home].forEach((t) => {
      const c = teamColor(t, '#4a5058');
      const b = el('div', 'tm');
      b.style.background = 'linear-gradient(' + shade(c, 0.06) + ', ' + shade(c, -0.08) + ')';
      b.style.color = inkOn(c) === '#111' ? shade(c, -0.75) : '#fff';
      b.append(el('span', '', (t.abbr || '').toUpperCase()), el('span', 's', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      fr.appendChild(b);
    });
    const clock = el('div', 'clock');
    if (live) { clock.appendChild(ordinal(g.period, 'q')); if (g.clock) clock.appendChild(el('span', 'pill', g.clock)); }
    else clock.appendChild(el('span', 'when', statusText(g, time)));
    fr.appendChild(clock);
    fr.appendChild(el('div', 'low l0'));
    [g.away, g.home].forEach((t) => {
      const low = el('div', 'low');
      // NBA teams have seven timeouts a game; shown only when the sensor knows how many are left
      if (live && t.timeouts != null) low.appendChild(pips(t.timeouts, 7));
      fr.appendChild(low);
    });
    const plate = el('div', 'plate');
    if (mk.league) plate.appendChild(leagueLogo(g, 56));
    if (g.away.record || g.home.record) plate.append(el('span', '', g.away.record), el('span', '', g.home.record));
    else plate.appendChild(el('span', '', g.status === 'final' ? 'FINAL' : g.league));
    fr.appendChild(plate);
    root.appendChild(fr);
  },
};
