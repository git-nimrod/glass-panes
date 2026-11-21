// "Light & dark panels '25": after the NBA bar on NBC and Peacock (2025-26 on). One wide bar: each team has a narrow strip of its
// colour at the outer end with its letters standing on end, then a panel (white for the away team, near-black for the home team) with
// the round logo, a curly bracket with the seed, and a big score in the team's colour. The centre is dark glass with the clock over the
// quarter (the shot clock that sits beside the quarter on air is not in the sensor data). A grey strip underneath carries the records.
// The network's mark above the clock becomes the Home Assistant logo; the league's logo sits in the strip.
import { el } from '../util.js';
import { logo, ordinal, statusText, teamColor, shade, inkOn, leagueLogo, haMark, marks } from './kit.js';

const W = 1040, H = 196, TOP = 144;

export default {
  id: 'nba-panels-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Montserrat Heavy', file: 'montserrat-latin-wght-normal.woff2', desc: { weight: '600 900' } }],
  css: `
.sb-nba-panels-25 { font-family: 'GP Montserrat Heavy', 'Montserrat', 'Arial Black', sans-serif; color: #fff; }
.sb-nba-panels-25 .bar { position: absolute; left: 0; top: 0; width: ${W}px; height: ${TOP}px; display: grid; grid-template-columns: 58px 352px 1fr 352px 58px;
  border-radius: 10px 10px 0 0; overflow: hidden; box-shadow: 0 3px 8px rgba(0,0,0,.45); }
.sb-nba-panels-25 .edge { display: grid; place-items: center; }
.sb-nba-panels-25 .edge b { display: block; transform: rotate(-90deg); font-weight: 900; font-size: 40px; letter-spacing: 1px; white-space: nowrap; }
.sb-nba-panels-25 .home.edge b { transform: rotate(90deg); }
.sb-nba-panels-25 .pan { position: relative; display: flex; align-items: center; gap: 10px; padding: 0 16px; box-shadow: inset 0 -5px 0 var(--c); }
.sb-nba-panels-25 .pan.light { background: linear-gradient(#ffffff, #e9e9e9); }
.sb-nba-panels-25 .pan.dark { background: linear-gradient(#1b1b1b, #0c0c0c); flex-direction: row-reverse; }
.sb-nba-panels-25 .ring { flex: none; width: 122px; height: 122px; border-radius: 50%; display: grid; place-items: center; background: #fff; box-shadow: 0 0 0 4px var(--c); }
.sb-nba-panels-25 .dark .ring { background: #121212; }
.sb-nba-panels-25 .sb-logo { width: 104px; height: 104px; object-fit: contain; }
.sb-nba-panels-25 .mid .sb-ha { color: #d9dadc; margin-bottom: 4px; }
.sb-nba-panels-25 .strip .lg { display: flex; align-items: center; gap: 8px; }
.sb-nba-panels-25 .strip .sb-league { width: 40px; height: 40px; }
.sb-nba-panels-25 .brk { flex: none; position: relative; width: 26px; height: 72px; display: grid; place-items: center; color: var(--c); font-weight: 300; font-size: 72px; line-height: 1; }
.sb-nba-panels-25 .brk sup { position: absolute; top: 2px; font-size: 18px; font-weight: 800; color: #222; }
.sb-nba-panels-25 .dark .brk sup { color: #eee; }
.sb-nba-panels-25 .away .brk sup { right: -16px; } .sb-nba-panels-25 .home .brk sup { left: -16px; }
.sb-nba-panels-25 .sc { flex: 1; text-align: center; font-weight: 800; font-size: 96px; line-height: 1; letter-spacing: -2px; }
.sb-nba-panels-25 .mid { display: grid; align-content: center; justify-items: center; background: radial-gradient(ellipse at 50% 0, #5a5d61, #2b2d30 55%, #1a1b1d); box-shadow: inset 0 2px 0 rgba(255,255,255,.25); }
.sb-nba-panels-25 .clk { font-weight: 800; font-size: 56px; line-height: 1; letter-spacing: -1px; }
.sb-nba-panels-25 .per { font-weight: 800; font-size: 32px; margin-top: 4px; }
.sb-nba-panels-25 .sb-ord { font-size: .62em; vertical-align: 10px; }
.sb-nba-panels-25 .when { font-weight: 800; font-size: 32px; text-align: center; line-height: 1.15; }
.sb-nba-panels-25 .strip { position: absolute; left: 0; top: ${TOP}px; width: ${W}px; height: ${H - TOP}px; box-sizing: border-box; padding: 0 22px; display: flex; align-items: center;
  justify-content: space-between; background: linear-gradient(#3c3d40, #2a2b2e); border-radius: 0 0 10px 10px; font-weight: 700; font-size: 26px; color: #d8d8d8; }
.sb-nba-panels-25 .strip .lg { font-weight: 800; font-size: 30px; color: #e8e8e8; letter-spacing: .5px; }
`,
  draw(root, g, { time, opts }) {
    const mk = marks(opts);
    const live = g.status === 'live';
    const bar = el('div', 'bar');
    const side = (t, s) => {
      const c = teamColor(t, '#55595f');
      const edge = el('div', 'edge ' + s);
      edge.style.background = 'linear-gradient(' + shade(c, 0.12) + ', ' + shade(c, -0.15) + ')';
      edge.style.color = inkOn(c);
      edge.appendChild(el('b', '', (t.abbr || '').toUpperCase()));
      const pan = el('div', 'pan ' + s + (s === 'away' ? ' light' : ' dark'));
      pan.style.setProperty('--c', c);
      const ring = el('div', 'ring');
      ring.appendChild(logo(t, 104));
      const brk = el('div', 'brk', s === 'away' ? '{' : '}');
      if (t.rank) brk.appendChild(el('sup', '', String(t.rank)));
      // the score is the team colour on the white panel, white (or a light team colour) on the black one
      const sc = el('div', 'sc', g.status !== 'pre' && t.score != null ? String(t.score) : '');
      sc.style.color = s === 'away' ? (inkOn(c) === '#111' ? shade(c, -0.45) : c) : (inkOn(c) === '#111' ? c : '#fff');
      pan.append(ring, brk, sc);
      return s === 'away' ? [edge, pan] : [pan, edge];
    };
    const mid = el('div', 'mid');
    if (mk.ha) mid.appendChild(haMark(30));   // the network's mark sat above the clock
    if (live) {
      if (g.clock) mid.appendChild(el('div', 'clk', g.clock));
      mid.appendChild(ordinal(g.period, 'per'));
    } else mid.appendChild(el('div', 'when', statusText(g, time)));
    bar.append(...side(g.away, 'away'), mid, ...side(g.home, 'home'));
    const strip = el('div', 'strip');
    const lg = el('span', 'lg');
    if (mk.league) lg.appendChild(leagueLogo(g, 40, null, true));
    lg.appendChild(document.createTextNode(g.league || ''));
    strip.append(el('span', '', g.away.record || ''), lg, el('span', '', g.home.record || ''));
    root.append(bar, strip);
  },
};
