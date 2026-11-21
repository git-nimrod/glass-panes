// "Shots box '25": after the NHL bug on TNT Sports (2021 on, seen in the 2026 playoffs). A compact box in the top corner: a blue title
// strip, then the two teams in rows (logo, letters, score) on dark tints of their colours, a narrow column with each team's shots on
// goal and "SOG" between them, and a black block with the period over the clock. The trophy and network badge at the left end become
// the league's logo over the Home Assistant logo.
import { el } from '../util.js';
import { logo, statusText, teamColor, shade, leagueLogo, haMark, marks } from './kit.js';

const W = 720, H = 196, TOP = 48, ROW = 74, BADGE = 120;

export default {
  id: 'nhl-sog-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Montserrat Heavy', file: 'montserrat-latin-wght-normal.woff2', desc: { weight: '600 900' } }],
  css: `
.sb-nhl-sog-25 { font-family: 'GP Montserrat Heavy', 'Montserrat', Arial, sans-serif; font-weight: 700; color: #fff; }
.sb-nhl-sog-25 .badge { position: absolute; left: 0; top: 0; width: ${BADGE}px; height: ${H}px; background: #08090b; border-radius: 6px 0 0 6px; display: grid;
  grid-template-rows: 1fr 64px; justify-items: center; align-items: center; box-shadow: 0 3px 8px rgba(0,0,0,.5); }
.sb-nhl-sog-25 .badge .sb-league { width: 104px; height: 104px; }
.sb-nhl-sog-25 .badge .sb-ha { color: #f2f2f2; }
.sb-nhl-sog-25 .ttl { position: absolute; left: var(--l, 0); right: 0; top: 0; height: ${TOP}px; background: linear-gradient(#2a64a8, #1a4682); border-radius: 6px 6px 0 0; display: flex;
  align-items: center; justify-content: space-between; padding: 0 22px; font-size: 22px; letter-spacing: .5px; }
.sb-nhl-sog-25 .body { position: absolute; left: var(--l, 0); right: 0; top: ${TOP}px; height: ${2 * ROW}px; background: #08090b; display: grid; grid-template-columns: 290px 100px 72px 1fr;
  grid-template-rows: ${ROW}px ${ROW}px; box-shadow: 0 3px 8px rgba(0,0,0,.5); }
.sb-nhl-sog-25 .tm { display: flex; align-items: center; gap: 8px; padding-left: 8px; font-size: 44px; letter-spacing: .5px; }
.sb-nhl-sog-25 .sb-logo { width: 74px; height: 62px; object-fit: contain; }
.sb-nhl-sog-25 .sc { display: grid; place-items: center; font-size: 56px; }
.sb-nhl-sog-25 .sog { grid-column: 3; grid-row: 1 / 3; display: grid; grid-template-rows: 1fr 30px 1fr; border-left: 2px solid #3a3c40; border-right: 2px solid #3a3c40; }
.sb-nhl-sog-25 .sog span { display: grid; place-items: center; font-size: 30px; }
.sb-nhl-sog-25 .sog .l { font-size: 17px; color: #cfd2d6; border-top: 2px solid #3a3c40; border-bottom: 2px solid #3a3c40; }
.sb-nhl-sog-25 .pc { grid-column: 4; grid-row: 1 / 3; display: grid; align-content: center; justify-items: center; gap: 4px; }
.sb-nhl-sog-25 .pc .p { font-size: 34px; } .sb-nhl-sog-25 .pc .c { font-size: 44px; }
.sb-nhl-sog-25 .pc .w { font-size: 30px; text-align: center; line-height: 1.15; }
`,
  draw(root, g, { time, opts }) {
    const mk = marks(opts);
    const live = g.status === 'live';
    const ttl = el('div', 'ttl');
    ttl.append(el('span', '', g.league || ''), el('span', '', g.status === 'final' ? '' : (g.away.record && g.home.record ? g.away.record + '  ·  ' + g.home.record : '')));
    const body = el('div', 'body');
    [g.away, g.home].forEach((t) => {
      const c = teamColor(t, '#3a3f47');
      const tint = 'linear-gradient(' + shade(c, -0.3) + ', ' + shade(c, -0.55) + ')';
      const tm = el('div', 'tm');
      tm.style.background = tint;
      tm.append(logo(t, 74), el('span', '', (t.abbr || '').toUpperCase()));
      const sc = el('div', 'sc', g.status !== 'pre' && t.score != null ? String(t.score) : '');
      sc.style.background = 'linear-gradient(' + shade(c, -0.45) + ', ' + shade(c, -0.7) + ')';
      body.append(tm, sc);
    });
    const sog = el('div', 'sog');
    const shot = (t) => (t.shots != null && g.status !== 'pre' ? String(t.shots) : '');
    sog.append(el('span', '', shot(g.away)), el('span', 'l', 'SOG'), el('span', '', shot(g.home)));
    sog.style.gridRow = '1 / 3';
    const pc = el('div', 'pc');
    pc.style.gridRow = '1 / 3';
    if (live) { pc.appendChild(el('span', 'p', g.period.label + (g.period.suffix || ''))); if (g.clock) pc.appendChild(el('span', 'c', g.clock)); }
    else pc.appendChild(el('span', 'w', statusText(g, time)));
    // grid rows: away team + score in row 1, home in row 2, the shots and period columns span both
    body.children[0].style.gridRow = body.children[1].style.gridRow = '1';
    body.children[2].style.gridRow = body.children[3].style.gridRow = '2';
    body.append(sog, pc);
    // the trophy and the network's badge stood at the left end: here the league's logo over the Home Assistant logo
    if (mk.league || mk.ha) {
      const badge = el('div', 'badge');
      badge.append(mk.league ? leagueLogo(g, 104, null, true) : el('span'), mk.ha ? haMark(48) : el('span'));
      root.appendChild(badge);
      root.style.setProperty('--l', BADGE + 'px');
      ttl.style.borderRadius = '0 6px 0 0';
    }
    root.append(ttl, body);
  },
};
