// "Segments '25": after the Monday-night NFL bar on ESPN (2023-2025). One long, low bar in separate glossy segments: each team a
// segment in its colour with a big cropped logo, three timeout squares stacked at its outer edge and the score; a small arrow on the team
// with the ball; a dark clock segment (quarter, clock); and a down-and-distance segment underlined in red. The network's wordmark at the
// left end becomes the Home Assistant logo.
import { el } from '../util.js';
import { logo, ordinal, pips, statusText, teamColor, shade, haMark, marks } from './kit.js';

const W = 1060, H = 64;

export default {
  id: 'nfl-segments-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Archivo Expanded', file: 'sports/archivo-expanded-latin.woff2', desc: { weight: '800', stretch: '125%' } }],
  css: `
.sb-nfl-segments-25 { font-family: 'GP Archivo Expanded', 'Arial Black', sans-serif; font-weight: 800; color: #fff; display: flex; gap: 6px; height: ${H}px; }
.sb-nfl-segments-25 > div { position: relative; height: 100%; border-radius: 4px; overflow: hidden; display: flex; align-items: center;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35), inset 0 -2px 0 rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.5); }
.sb-nfl-segments-25 .team { width: 260px; }
.sb-nfl-segments-25 .net { width: 64px; justify-content: center; background: linear-gradient(#3a3b3f, #17181a); color: #f2f2f2; }
.sb-nfl-segments-25 .sb-logo { position: absolute; top: -14px; width: 150px; height: 92px; object-fit: cover; opacity: .95; }
.sb-nfl-segments-25 .away .sb-logo { left: 26px; } .sb-nfl-segments-25 .home .sb-logo { right: 26px; }
.sb-nfl-segments-25 .sc { position: absolute; font-size: 40px; text-shadow: 0 2px 2px rgba(0,0,0,.6); }
.sb-nfl-segments-25 .away .sc { right: 26px; } .sb-nfl-segments-25 .home .sc { left: 26px; }
.sb-nfl-segments-25 .sb-pips { position: absolute; top: 12px; display: grid; gap: 5px; }
.sb-nfl-segments-25 .away .sb-pips { left: 9px; } .sb-nfl-segments-25 .home .sb-pips { right: 9px; }
.sb-nfl-segments-25 .sb-pips i { width: 8px; height: 8px; background: #fff; } .sb-nfl-segments-25 .sb-pips i.used { opacity: .2; }
.sb-nfl-segments-25 .ball { position: absolute; top: 50%; margin-top: -9px; width: 0; height: 0; border-top: 9px solid transparent; border-bottom: 9px solid transparent; }
.sb-nfl-segments-25 .away .ball { right: 0; border-right: 10px solid #e8202a; } .sb-nfl-segments-25 .home .ball { left: 0; border-left: 10px solid #e8202a; }
.sb-nfl-segments-25 .clock { width: 230px; background: linear-gradient(#4a4c50, #26272a 55%, #1a1b1d); justify-content: center; gap: 18px; }
.sb-nfl-segments-25 .q { font-size: 20px; } .sb-nfl-segments-25 .clk { font-size: 34px; letter-spacing: .5px; }
.sb-nfl-segments-25 .sb-ord { font-size: .75em; }
.sb-nfl-segments-25 .dd { flex: 1; background: linear-gradient(#2e2f33, #151618); justify-content: center; font-size: 24px; border-bottom: 4px solid #d71920; box-sizing: border-box; }
`,
  draw(root, g, { time, opts }) {
    const live = g.status === 'live';
    const team = (t, side) => {
      const c = teamColor(t, '#3a3f47');
      const b = el('div', 'team ' + side);
      b.style.background = 'linear-gradient(' + (side === 'away' ? '90deg' : '270deg') + ', ' + shade(c, -0.55) + ', ' + c + ' 60%, ' + shade(c, -0.25) + '), #111';
      b.appendChild(logo(t, 150));
      b.appendChild(el('span', 'sc', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      if (g.sport === 'football' && live) b.appendChild(pips(t.timeouts, 3));
      if (live && t.hasBall) b.appendChild(el('span', 'ball'));
      return b;
    };
    const clock = el('div', 'clock');
    if (live) { clock.appendChild(ordinal(g.period, 'q')); if (g.clock) clock.appendChild(el('span', 'clk', g.clock)); }
    else clock.appendChild(el('span', 'clk', statusText(g, time)));
    const dd = el('div', 'dd', live && g.football && g.football.short ? g.football.short : (g.away.record && g.home.record ? g.away.record + '  |  ' + g.home.record : ''));
    if (marks(opts).ha) { const n = el('div', 'net'); n.appendChild(haMark(40)); root.appendChild(n); }
    root.append(team(g.away, 'away'), team(g.home, 'home'), clock, dd);
  },
};
