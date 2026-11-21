// "Wedge '25": after the Thursday-night NFL bar on Prime Video (2022 on). A bar with slanted ends: each team's logo large on a panel of
// its colour with a silver sheen, the score on a deep panel of the same colour, bright cyan slashes either side of the centre. The centre
// has the down and distance in dark type on a light silver plate, and under it the quarter and clock between slashes. The network's
// wordmark at the left of the centre becomes the Home Assistant logo.
import { el } from '../util.js';
import { logo, ordinal, statusText, teamColor, shade, haMark, marks } from './kit.js';

const W = 1060, H = 92, SL = 26;

export default {
  id: 'nfl-wedge-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Montserrat Heavy', file: 'montserrat-latin-wght-normal.woff2', desc: { weight: '600 900' } }],
  css: `
.sb-nfl-wedge-25 { font-family: 'GP Montserrat Heavy', 'Montserrat', 'Arial Black', sans-serif; color: #fff; }
.sb-nfl-wedge-25 .bar { position: absolute; inset: 0; clip-path: polygon(${SL}px 0, ${W - SL}px 0, ${W}px 100%, 0 100%); background: #0b1428; display: grid;
  grid-template-columns: 236px 150px 1fr 150px 236px; filter: drop-shadow(0 3px 6px rgba(0,0,0,.5)); }
.sb-nfl-wedge-25 .lp { position: relative; overflow: hidden; display: grid; place-items: center; }
.sb-nfl-wedge-25 .sb-logo { width: 230px; height: 160px; object-fit: contain; filter: drop-shadow(0 2px 3px rgba(0,0,0,.4)); }
.sb-nfl-wedge-25 .away .sb-logo { margin-left: -30px; } .sb-nfl-wedge-25 .home .sb-logo { margin-right: -30px; }
.sb-nfl-wedge-25 .top { display: flex; align-items: stretch; gap: 8px; margin: 4px 22px 0; }
.sb-nfl-wedge-25 .top .sb-ha { align-self: center; color: #fff; }
.sb-nfl-wedge-25 .sc { display: grid; place-items: center; font-weight: 800; font-size: 60px; text-shadow: 0 2px 3px rgba(0,0,0,.5); }
.sb-nfl-wedge-25 .mid { position: relative; display: grid; grid-template-rows: 50% 50%; background: linear-gradient(#0d1a33, #08101f); }
.sb-nfl-wedge-25 .mid::before, .sb-nfl-wedge-25 .mid::after { content: ''; position: absolute; top: 4px; bottom: 4px; width: 4px; background: #23c7ef; box-shadow: 0 0 8px #23c7ef; transform: skewX(-14deg); }
.sb-nfl-wedge-25 .mid::before { left: 6px; } .sb-nfl-wedge-25 .mid::after { right: 6px; transform: skewX(14deg); }
.sb-nfl-wedge-25 .plate { flex: 1; display: grid; place-items: center; background: linear-gradient(#ffffff, #cfd5dc); color: #0d1626; font-weight: 800; font-size: 28px;
  clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 100%, 0 100%); }
.sb-nfl-wedge-25 .low { display: flex; align-items: center; justify-content: center; gap: 22px; font-weight: 800; font-size: 28px; }
.sb-nfl-wedge-25 .low .q { font-size: 22px; color: #dfe6ee; } .sb-nfl-wedge-25 .sb-ord { font-size: .7em; }
.sb-nfl-wedge-25 .low i { width: 2px; height: 26px; background: rgba(255,255,255,.35); transform: skewX(-18deg); }
.sb-nfl-wedge-25 .ball { position: absolute; bottom: 6px; left: 50%; margin-left: -24px; width: 48px; height: 4px; background: #23c7ef; border-radius: 2px; }
`,
  draw(root, g, { time, opts }) {
    const live = g.status === 'live';
    const bar = el('div', 'bar');
    const panels = (t, side) => {
      const c = teamColor(t, '#33405a');
      const lp = el('div', 'lp ' + side);
      lp.style.background = 'linear-gradient(' + (side === 'away' ? '100deg' : '260deg') + ', ' + shade(c, -0.2) + ' 10%, ' + shade(c, 0.12) + ' 45%, ' + shade(c, 0.55) + ' 52%, ' + c + ' 62%, ' + shade(c, -0.3) + ')';
      lp.appendChild(logo(t, 230));
      const sc = el('div', 'sc', g.status !== 'pre' && t.score != null ? String(t.score) : '');
      sc.style.position = 'relative';
      sc.style.background = 'linear-gradient(' + shade(c, -0.45) + ', ' + shade(c, -0.7) + ')';
      if (live && t.hasBall) sc.appendChild(el('span', 'ball'));
      return side === 'away' ? [lp, sc] : [sc, lp];
    };
    const mid = el('div', 'mid');
    const plate = el('div', 'plate', live && g.football && g.football.short ? g.football.short.replace(/^(\d)(ST|ND|RD|TH)/, (m, n, s) => n + s.toLowerCase()) : (live ? '' : statusText(g, time)));
    const low = el('div', 'low');
    if (live) {
      low.appendChild(ordinal(g.period, 'q'));
      if (g.clock) { low.appendChild(el('i')); low.appendChild(el('span', '', g.clock)); }
    } else if (g.away.record || g.home.record) {
      low.style.fontSize = '20px';
      low.append(el('span', '', g.away.record), el('i'), el('span', '', g.home.record));
    }
    const top = el('div', 'top');
    if (marks(opts).ha) top.appendChild(haMark(34));   // the network's wordmark sat left of the plate
    top.appendChild(plate);
    if (plate.textContent) mid.append(top, low); else { mid.style.gridTemplateRows = '100%'; low.style.fontSize = '34px'; mid.append(low); }
    bar.append(...panels(g.away, 'away'), mid, ...panels(g.home, 'home'));
    root.appendChild(bar);
  },
};
