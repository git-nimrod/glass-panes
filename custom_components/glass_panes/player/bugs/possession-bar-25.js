// "Possession bar '25": after ESPN's college football bug of 2025 (and its NFL bug from 2026). The whole bar takes the colour of the
// team with the ball, fading to black across the other side, so a glance says who has it. Top line: rank and name over each team, a
// raised tab in the middle with the down and distance. Middle: the logos at the ends (the team with the ball on its colour, the other on
// a light panel), big scores with three timeout dashes, and the quarter (gold) and clock in the centre. A dark strip underneath with
// the records. No network marks.
import { el } from '../util.js';
import { logo, ordinal, pips, statusText, teamColor, shade } from './kit.js';

const W = 900, H = 124;

export default {
  id: 'possession-bar-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Archivo Expanded', file: 'sports/archivo-expanded-latin.woff2', desc: { weight: '800', stretch: '125%' } }],
  css: `
.sb-possession-bar-25 { font-family: 'GP Archivo Expanded', 'Arial Black', sans-serif; font-weight: 800; color: #fff; }
.sb-possession-bar-25 .body { position: absolute; left: 0; right: 0; top: 0; height: 98px; border-radius: 8px; overflow: hidden; box-shadow: 0 3px 8px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.35); }
.sb-possession-bar-25 .nm { position: absolute; top: 5px; font-size: 17px; letter-spacing: .3px; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.sb-possession-bar-25 .nm b { font-size: 14px; margin-right: 6px; opacity: .9; }
.sb-possession-bar-25 .tab { position: absolute; left: 300px; width: 300px; top: 0; height: 34px; display: grid; place-items: center; font-size: 22px; border-radius: 0 0 8px 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,.5), inset 0 -1px 0 rgba(255,255,255,.15); }
.sb-possession-bar-25 .lp { position: absolute; top: 28px; width: 140px; height: 66px; display: grid; place-items: center; border-radius: 4px; overflow: hidden; }
.sb-possession-bar-25 .lp.light { background: linear-gradient(90deg, #fafafa, #c9c9cc); }
.sb-possession-bar-25 .sb-logo { width: 136px; height: 84px; object-fit: contain; }
.sb-possession-bar-25 .sc { position: absolute; top: 28px; width: 130px; height: 64px; display: grid; justify-items: center; align-content: start; font-size: 52px; line-height: 1.05; text-shadow: 0 2px 2px rgba(0,0,0,.5); }
.sb-possession-bar-25 .sb-pips { display: flex; gap: 6px; margin-top: 3px; }
.sb-possession-bar-25 .sb-pips i { width: 24px; height: 4px; background: #f2f2f2; } .sb-possession-bar-25 .sb-pips i.used { opacity: .2; }
.sb-possession-bar-25 .mid { position: absolute; left: 300px; width: 300px; top: 42px; height: 44px; display: flex; align-items: center; justify-content: center; gap: 18px; }
.sb-possession-bar-25 .q { color: #f3c94a; font-size: 22px; } .sb-possession-bar-25 .clk { font-size: 32px; letter-spacing: .5px; }
.sb-possession-bar-25 .sb-ord { font-size: .72em; }
.sb-possession-bar-25 .ball { position: absolute; top: 20px; width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-top: 8px solid #f4f4f4; }
.sb-possession-bar-25 .strip { position: absolute; left: 14px; right: 14px; top: 98px; height: 24px; background: linear-gradient(#2c2d30, #1b1c1e); border-radius: 0 0 6px 6px;
  display: flex; justify-content: space-between; align-items: center; padding: 0 18px; font-size: 14px; color: #e4e4e4; letter-spacing: .5px; }
`,
  draw(root, g, { time }) {
    const live = g.status === 'live';
    const ball = live ? (g.away.hasBall ? 'away' : g.home.hasBall ? 'home' : null) : null;
    const lead = ball ? g[ball] : null;
    const c = lead ? teamColor(lead, '#3a3f47') : '#2d2f33';
    const body = el('div', 'body');
    // the colour of the team with the ball floods from its end and fades to black at the other
    body.style.background = !lead ? 'linear-gradient(#3a3c40, #1d1e21)'
      : 'linear-gradient(' + (ball === 'away' ? '90deg' : '270deg') + ', ' + shade(c, -0.1) + ' 0, ' + shade(c, -0.35) + ' 45%, #121214 82%), linear-gradient(rgba(255,255,255,.12), rgba(0,0,0,.25))';
    body.style.backgroundBlendMode = 'overlay';
    root.appendChild(body);
    const name = (t) => (t.longName || t.name || t.abbr).toUpperCase();
    [['away', 18], ['home', null]].forEach(([side, x]) => {
      const t = g[side];
      const nm = el('div', 'nm');
      if (t.rank) nm.appendChild(el('b', '', String(t.rank)));
      nm.appendChild(document.createTextNode(name(t).slice(0, 18)));
      if (x != null) nm.style.left = x + 'px'; else nm.style.right = '18px';
      body.appendChild(nm);
      const lp = el('div', 'lp' + (ball === side ? '' : ' light'));
      lp.style[side === 'away' ? 'left' : 'right'] = '6px';
      if (ball === side) lp.style.background = 'linear-gradient(' + shade(c, 0.1) + ', ' + shade(c, -0.25) + ')';
      lp.appendChild(logo(t, 136));
      body.appendChild(lp);
      const sc = el('div', 'sc', g.status !== 'pre' && t.score != null ? String(t.score) : '');
      if (g.sport === 'football' && live) sc.appendChild(pips(t.timeouts, 3));
      sc.style.left = (side === 'away' ? 160 : W - 290) + 'px';
      body.appendChild(sc);
      if (ball === side) { const b = el('span', 'ball'); b.style.left = (side === 'away' ? 216 : W - 234) + 'px'; body.appendChild(b); }
    });
    const tab = el('div', 'tab', live && g.football && g.football.short ? g.football.short : '');
    tab.style.background = lead ? 'linear-gradient(' + shade(c, 0.05) + ', ' + shade(c, -0.3) + ')' : 'linear-gradient(#45474c, #2a2b2f)';
    if (tab.textContent) body.appendChild(tab);
    const mid = el('div', 'mid');
    if (live) { mid.appendChild(ordinal(g.period, 'q')); if (g.clock) mid.appendChild(el('span', 'clk', g.clock)); }
    else mid.appendChild(el('span', 'clk', statusText(g, time)));
    body.appendChild(mid);
    if (g.away.record || g.home.record) {
      const strip = el('div', 'strip');
      strip.append(el('span', '', g.away.record), el('span', '', g.home.record));
      root.appendChild(strip);
    }
  },
};
