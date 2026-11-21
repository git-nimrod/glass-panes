// "Medallion '26": after the Sunday-night NFL scorebar on NBC (2026 playoffs on). A glassy bar in two team-colour halves, each lit
// silver at its outer end where the big logo sits, the team's letters and record, a big score with three timeout dashes, and a round dark
// medallion in the middle with the clock over the quarter. The down and distance hangs under the team with the ball, between chevrons.
// The network's mark at the top of the medallion becomes the Home Assistant logo.
import { el } from '../util.js';
import { logo, ordinal, pips, statusText, teamColor, shade, haMark, marks } from './kit.js';

const W = 1000, H = 126, BAR_T = 22, BAR_H = 68, R = 58;

export default {
  id: 'nfl-medallion-26',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Montserrat Heavy', file: 'montserrat-latin-wght-normal.woff2', desc: { weight: '600 900' } }],
  css: `
.sb-nfl-medallion-26 { font-family: 'GP Montserrat Heavy', 'Montserrat', 'Arial Black', sans-serif; color: #fff; }
.sb-nfl-medallion-26 .half { position: absolute; top: ${BAR_T}px; height: ${BAR_H}px; width: ${W / 2 - 20}px; display: grid; align-items: center; overflow: hidden;
  box-shadow: inset 0 2px 0 rgba(255,255,255,.55), inset 0 -3px 0 rgba(0,0,0,.35), 0 3px 8px rgba(0,0,0,.5); }
.sb-nfl-medallion-26 .half.away { left: 0; border-radius: 12px 0 0 12px; grid-template-columns: 150px 140px 6px 1fr; }
.sb-nfl-medallion-26 .half.home { right: 0; border-radius: 0 12px 12px 0; grid-template-columns: 1fr 6px 140px 150px; }
.sb-nfl-medallion-26 .sb-logo { width: 168px; height: 128px; object-fit: contain; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
.sb-nfl-medallion-26 .away .sb-logo { margin: -30px 0 -30px -22px; } .sb-nfl-medallion-26 .home .sb-logo { margin: -30px -22px -30px 0; justify-self: end; }
.sb-nfl-medallion-26 .med .sb-ha { color: #e9ecef; margin-top: 2px; }
.sb-nfl-medallion-26 .id { display: grid; line-height: 1; }
.sb-nfl-medallion-26 .away .id { justify-items: end; padding-right: 12px; } .sb-nfl-medallion-26 .home .id { justify-items: start; padding-left: 12px; }
.sb-nfl-medallion-26 .ab { font-weight: 800; font-size: 38px; letter-spacing: .5px; text-shadow: 0 2px 2px rgba(0,0,0,.45); }
.sb-nfl-medallion-26 .ab sup { font-size: 17px; vertical-align: 14px; margin-right: 2px; font-weight: 700; }
.sb-nfl-medallion-26 .rec { font-weight: 600; font-size: 16px; margin-top: 2px; opacity: .92; }
.sb-nfl-medallion-26 .sep { width: 2px; height: 46px; background: rgba(255,255,255,.35); justify-self: center; }
.sb-nfl-medallion-26 .sc { position: relative; height: 100%; box-sizing: border-box; padding-bottom: 10px; display: grid; place-items: center; font-weight: 800; font-size: 54px; text-shadow: 0 2px 3px rgba(0,0,0,.5); }
.sb-nfl-medallion-26 .away .sc { padding-right: ${R - 10}px; } .sb-nfl-medallion-26 .home .sc { padding-left: ${R - 10}px; }
.sb-nfl-medallion-26 .sb-pips { position: absolute; bottom: 5px; display: flex; gap: 6px; }
.sb-nfl-medallion-26 .sb-pips i { width: 22px; height: 4px; background: #f4f4f4; border-radius: 1px; } .sb-nfl-medallion-26 .sb-pips i.used { opacity: .22; }
.sb-nfl-medallion-26 .med { position: absolute; left: ${W / 2 - R}px; top: 0; width: ${2 * R}px; height: ${2 * R}px; border-radius: 50%; box-sizing: border-box;
  border: 3px solid #c6cacf; background: radial-gradient(circle at 50% 30%, #55595f, #26282c 62%, #17181a); box-shadow: 0 3px 10px rgba(0,0,0,.6), inset 0 0 0 2px rgba(0,0,0,.5);
  display: grid; align-content: center; justify-items: center; }
.sb-nfl-medallion-26 .clk { font-weight: 800; font-size: 29px; line-height: 1; margin-top: 2px; letter-spacing: -.5px; }
.sb-nfl-medallion-26 .per { font-weight: 800; font-size: 20px; line-height: 1.15; margin-top: 3px; border-top: 2px solid rgba(255,255,255,.35); padding: 2px 8px 0; }
.sb-nfl-medallion-26 .sb-ord { font-size: .62em; vertical-align: 5px; text-decoration: underline; text-underline-offset: 2px; }
.sb-nfl-medallion-26 .when { font-weight: 800; font-size: 20px; text-align: center; line-height: 1.15; padding: 0 8px; }
.sb-nfl-medallion-26 .dd { position: absolute; top: ${BAR_T + BAR_H}px; height: 32px; width: 330px; display: flex; align-items: center; justify-content: center; gap: 16px;
  font-weight: 700; font-size: 22px; border-radius: 0 0 8px 8px; box-shadow: 0 3px 6px rgba(0,0,0,.45); }
.sb-nfl-medallion-26 .dd i { font-style: normal; font-size: 13px; letter-spacing: -3px; opacity: .65; }
`,
  draw(root, g, { time, opts }) {
    const live = g.status === 'live';
    const half = (t, side) => {
      const c = teamColor(t, '#3a3f47');
      const h = el('div', 'half ' + side);
      // silver at the outer end, the team colour through the middle, darker towards the medallion
      const dir = side === 'away' ? '90deg' : '270deg';
      h.style.background = 'linear-gradient(' + dir + ', #eef0f2 0, ' + shade(c, 0.25) + ' 120px, ' + c + ' 230px, ' + shade(c, -0.45) + ' 100%)';
      const id = el('div', 'id');
      const ab = el('div', 'ab');
      if (t.rank) ab.appendChild(el('sup', '', String(t.rank)));
      ab.appendChild(document.createTextNode(t.abbr));
      id.appendChild(ab);
      if (t.record) id.appendChild(el('div', 'rec', t.record));
      const sc = el('div', 'sc', g.status !== 'pre' && t.score != null ? String(t.score) : '');
      if (g.sport === 'football' && live) sc.appendChild(pips(t.timeouts, 3));
      const parts = [logo(t, 168), id, el('span', 'sep'), sc];
      h.append(...(side === 'away' ? parts : parts.reverse()));
      return h;
    };
    root.append(half(g.away, 'away'), half(g.home, 'home'));
    const med = el('div', 'med');
    if (marks(opts).ha) med.appendChild(haMark(24));   // the network's mark sat at the top of the medallion
    if (live) {
      if (g.clock) med.appendChild(el('div', 'clk', g.clock));
      const per = el('div', 'per'); per.appendChild(ordinal(g.period)); med.appendChild(per);
    } else med.appendChild(el('div', 'when', statusText(g, time)));
    root.appendChild(med);
    const ball = g.away.hasBall ? 'away' : g.home.hasBall ? 'home' : null;
    if (live && g.football && g.football.short && ball) {
      const c = teamColor(g[ball], '#2a2d33');
      const dd = el('div', 'dd');
      dd.style.background = 'linear-gradient(' + shade(c, -0.35) + ', ' + shade(c, -0.6) + ')';
      dd.style.left = (ball === 'away' ? W / 2 - R - 340 : W / 2 + R + 10) + 'px';
      const chev = (s) => el('i', '', s);
      dd.append(chev(ball === 'away' ? '▶▶' : '◀◀'), el('span', '', g.football.short.replace(/^(\d)(ST|ND|RD|TH)/, (m, n, s) => n + s.toLowerCase())), chev(ball === 'away' ? '▶▶' : '◀◀'));
      root.appendChild(dd);
    }
  },
};
