// "Glossy strip '26": after the MLB bar on NBC and Peacock (2026 on). A low bar: each team a glossy block of its colour with its logo,
// then a darker block of the same colour with the score; a dark section with the bases in gold and, under it, the half inning and the
// outs as dots; and the count at the right end. A dark line under the team blocks carries the records (on air, the pitcher and batter,
// which the sensor does not have). The pitch clock is not in the data either.
import { el } from '../util.js';
import { logo, bases, inning, pips, statusText, teamColor, shade } from './kit.js';

const W = 1000, H = 154, TOP = 112;

export default {
  id: 'mlb-strip-26',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Montserrat Heavy', file: 'montserrat-latin-wght-normal.woff2', desc: { weight: '600 900' } }],
  css: `
.sb-mlb-strip-26 { font-family: 'GP Montserrat Heavy', 'Montserrat', 'Arial Black', sans-serif; font-weight: 800; color: #fff; }
.sb-mlb-strip-26 .bar { position: absolute; inset: 0; display: grid; grid-template-columns: 132px 138px 132px 138px 1fr 180px; grid-template-rows: ${TOP}px 1fr;
  background: #141518; border-radius: 6px; overflow: hidden; box-shadow: 0 3px 8px rgba(0,0,0,.5); }
.sb-mlb-strip-26 .lg, .sb-mlb-strip-26 .sc { display: grid; place-items: center; position: relative; }
.sb-mlb-strip-26 .lg::after, .sb-mlb-strip-26 .sc::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 46%; background: linear-gradient(rgba(255,255,255,.28), rgba(255,255,255,.04)); }
.sb-mlb-strip-26 .sb-logo { width: 104px; height: 92px; object-fit: contain; filter: drop-shadow(0 2px 2px rgba(0,0,0,.35)); }
.sb-mlb-strip-26 .sc { font-size: 64px; text-shadow: 0 2px 2px rgba(0,0,0,.4); }
.sb-mlb-strip-26 .dia { grid-column: 5; grid-row: 1 / 3; display: grid; justify-items: center; align-content: center; gap: 4px; border-left: 2px solid #2c2d31; }
.sb-mlb-strip-26 .sb-bases i { border: 4px solid #8c8c8c; background: transparent; } .sb-mlb-strip-26 .sb-bases i.on { border-color: #f2b21b; background: #f2b21b; }
.sb-mlb-strip-26 .dia .ln { display: flex; align-items: center; gap: 34px; font-size: 32px; }
.sb-mlb-strip-26 .dia .ln .h { color: #fff; } .sb-mlb-strip-26 .dia .ln .h::first-letter { color: #f2b21b; }
.sb-mlb-strip-26 .sb-pips { display: flex; gap: 8px; } .sb-mlb-strip-26 .sb-pips i { width: 22px; height: 22px; border-radius: 50%; background: #f2f2f2; }
.sb-mlb-strip-26 .sb-pips i.used { background: transparent; box-shadow: inset 0 0 0 3px #6c6c6c; }
.sb-mlb-strip-26 .cnt { grid-column: 6; grid-row: 1 / 3; display: grid; place-items: center; font-size: 46px; border-left: 2px solid #2c2d31; }
.sb-mlb-strip-26 .cnt .w { font-size: 30px; text-align: center; line-height: 1.15; }
.sb-mlb-strip-26 .rec { grid-row: 2; grid-column: span 2; display: flex; align-items: center; padding: 0 16px; font-size: 22px; letter-spacing: .5px; background: #0d0e10; color: #e9e9e9; }
`,
  draw(root, g, { time }) {
    const live = g.status === 'live' && !!g.baseball; // a baseball bug forced onto another sport's game shows only the scores
    const bar = el('div', 'bar');
    [g.away, g.home].forEach((t) => {
      const c = teamColor(t, '#4a4f57');
      const lg = el('div', 'lg');
      lg.style.background = 'linear-gradient(' + shade(c, 0.1) + ', ' + shade(c, -0.15) + ')';
      lg.appendChild(logo(t, 104));
      const sc = el('div', 'sc', g.status !== 'pre' && t.score != null ? String(t.score) : '');
      sc.style.background = 'linear-gradient(' + shade(c, -0.15) + ', ' + shade(c, -0.4) + ')';
      bar.append(lg, sc);
    });
    const dia = el('div', 'dia');
    if (live) {
      dia.appendChild(bases(g.baseball.bases, 34));
      const ln = el('div', 'ln');
      ln.append(el('span', 'h', inning(g)), pips(g.baseball.outs, 2));
      dia.appendChild(ln);
    }
    const cnt = el('div', 'cnt');
    cnt.appendChild(live ? el('span', '', g.baseball.balls + '-' + g.baseball.strikes) : el('span', 'w', statusText(g, time)));
    bar.append(dia, cnt);
    // the records under the two team blocks
    [g.away, g.home].forEach((t) => {
      const r = el('div', 'rec', [(t.abbr || '').toUpperCase(), t.record].filter(Boolean).join('  '));
      bar.appendChild(r);
    });
    root.appendChild(bar);
  },
};
