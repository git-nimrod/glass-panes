// "Smoked glass '25": after the NHL bug on ESPN and ABC (2021 on, seen in the 2026 playoffs). A smoked-glass box with a thin light
// edge in the top corner: a title line, the period over a rule over the clock in a column at the left, and the two teams in rows to the
// right, each with its logo large and cropped on a pale panel, then its colour running dark towards a big score. The trophy and the
// network mark at the left become the league's logo over the Home Assistant logo.
import { el } from '../util.js';
import { logo, statusText, teamColor, shade, leagueLogo, haMark, marks } from './kit.js';

const W = 670, H = 214, TOP = 46, ROW = 80, SIDE = 110;

export default {
  id: 'nhl-cup-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Archivo Expanded', file: 'sports/archivo-expanded-latin.woff2', desc: { weight: '800', stretch: '125%' } }],
  css: `
.sb-nhl-cup-25 { font-family: 'GP Archivo Expanded', 'Arial Black', sans-serif; font-weight: 800; color: #fff; }
.sb-nhl-cup-25 .gl { position: absolute; inset: 0; box-sizing: border-box; border: 3px solid #b9bcc0; background: linear-gradient(rgba(70,72,76,.86), rgba(36,37,40,.9)); box-shadow: 0 3px 8px rgba(0,0,0,.45); }
.sb-nhl-cup-25 .ttl { position: absolute; left: 18px; top: 8px; font-size: 21px; letter-spacing: .5px; color: #ececec; }
.sb-nhl-cup-25 .side { position: absolute; left: 3px; top: ${TOP}px; width: ${SIDE}px; height: ${2 * ROW}px; display: grid; grid-template-rows: 1fr 44px; justify-items: center; align-items: center; }
.sb-nhl-cup-25 .side .sb-league { width: 96px; height: 100px; }
.sb-nhl-cup-25 .side .sb-ha { color: #f2f2f2; }
.sb-nhl-cup-25 .pc { position: absolute; left: var(--l, 3px); top: ${TOP}px; width: 172px; height: ${2 * ROW}px; display: grid; grid-template-rows: 1fr 1fr; justify-items: center; align-items: center; }
.sb-nhl-cup-25 .pc span { font-size: 34px; color: #e4e4e4; } .sb-nhl-cup-25 .pc span:last-child { font-size: 36px; }
.sb-nhl-cup-25 .pc::after { content: ''; position: absolute; left: 22px; right: 22px; top: 50%; height: 2px; background: #c9c9c9; }
.sb-nhl-cup-25 .pc .w { grid-row: 1 / 3; font-size: 28px; text-align: center; line-height: 1.2; }
.sb-nhl-cup-25 .pc.w::after { display: none; }
.sb-nhl-cup-25 .r { position: absolute; left: calc(var(--l, 3px) + 172px); right: 3px; height: ${ROW - 2}px; overflow: hidden; display: flex; align-items: center; justify-content: flex-end; gap: 22px; padding-right: 26px; }
.sb-nhl-cup-25 .r .sb-logo { position: absolute; left: -14px; top: -26px; width: 168px; height: 130px; object-fit: cover; }
.sb-nhl-cup-25 .r .ab { font-size: 38px; letter-spacing: 1px; text-shadow: 0 2px 2px rgba(0,0,0,.4); }
.sb-nhl-cup-25 .r .s { font-size: 54px; min-width: 50px; text-align: right; }
`,
  draw(root, g, { time, opts }) {
    const mk = marks(opts);
    const live = g.status === 'live';
    const gl = el('div', 'gl');
    gl.appendChild(el('div', 'ttl', [g.league, g.away.record && g.home.record ? g.away.record + ' | ' + g.home.record : ''].filter(Boolean).join('  |  ')));
    // the trophy and the network's mark stood at the left: here the league's logo over the Home Assistant logo
    if (mk.league || mk.ha) {
      const side = el('div', 'side');
      side.append(mk.league ? leagueLogo(g, 96, null, true) : el('span'), mk.ha ? haMark(34) : el('span'));
      gl.appendChild(side);
      gl.style.setProperty('--l', (SIDE + 3) + 'px');
    }
    const pc = el('div', 'pc');
    if (live) { pc.append(el('span', '', g.period.label + (g.period.suffix || '')), el('span', '', g.clock || '')); }
    else { pc.classList.add('w'); pc.appendChild(el('span', 'w', statusText(g, time))); }
    gl.appendChild(pc);
    [g.away, g.home].forEach((t, i) => {
      const c = teamColor(t, '#4a4f57');
      const r = el('div', 'r');
      r.style.top = (TOP + i * ROW) + 'px';
      // the logo sits on a pale panel, then the team colour takes over and darkens towards the score
      r.style.background = 'linear-gradient(90deg, #f1ede4 0, #e6e0d2 120px, ' + shade(c, 0.05) + ' 190px, ' + shade(c, -0.25) + ' 70%, ' + shade(c, -0.6) + ')';
      r.append(logo(t, 168), el('span', 'ab', (t.abbr || '').toUpperCase()), el('span', 's', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      gl.appendChild(r);
    });
    root.appendChild(gl);
  },
};
