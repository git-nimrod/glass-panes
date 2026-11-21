// "Floating logos '25": after the 2025 NFL Sunday national package on FOX. No bar behind it: big team logos stand free, huge silver
// scores, a small dark box in the middle with the clock over the quarter, the record and three timeout bars under each score, and the
// down and distance in a pill of the team with the ball, above that team. No network marks.
import { el } from '../util.js';
import { logo, ordinal, pips, statusText, teamColor, inkOn } from './kit.js';

const W = 750, H = 190;

export default {
  id: 'nfl-floating-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Archivo Expanded', file: 'sports/archivo-expanded-latin.woff2', desc: { weight: '800', stretch: '125%' } }],
  css: `
.sb-nfl-floating-25 { font-family: 'GP Archivo Expanded', 'Arial Black', sans-serif; font-weight: 800; color: #fff; }
.sb-nfl-floating-25 .row { position: absolute; left: 0; right: 0; top: 40px; height: 120px; display: grid; grid-template-columns: 160px 150px 130px 150px 160px; align-items: center; }
.sb-nfl-floating-25 .sb-logo { width: 150px; height: 112px; object-fit: contain; object-position: right center; justify-self: end; margin-right: 4px; filter: drop-shadow(0 4px 6px rgba(0,0,0,.55)); }
.sb-nfl-floating-25 .score { font-size: 86px; line-height: 1; letter-spacing: -2px; text-align: center; background: linear-gradient(#ffffff 30%, #c9ced3 62%, #eef0f2 100%); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 3px 2px rgba(0,0,0,.6)); }
.sb-nfl-floating-25 .score.lose { background: linear-gradient(#bfc3c7, #8e9398); -webkit-background-clip: text; background-clip: text; }
.sb-nfl-floating-25 .mid { justify-self: center; display: grid; justify-items: center; padding: 8px 12px 6px; min-width: 112px; background: rgba(18, 26, 22, .78); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
.sb-nfl-floating-25 .clk { font-size: 30px; line-height: 1; letter-spacing: .5px; }
.sb-nfl-floating-25 .per { font-size: 24px; line-height: 1.15; color: #e6e8ea; }
.sb-nfl-floating-25 .sb-ord { font-size: .7em; }
.sb-nfl-floating-25 .sub { position: absolute; top: 164px; display: flex; align-items: center; gap: 10px; font-size: 15px; color: #e6e8ea; }
.sb-nfl-floating-25 .sb-pips { display: inline-flex; gap: 6px; }
.sb-nfl-floating-25 .sb-pips i { width: 22px; height: 9px; border-radius: 2px; background: #e9ecee; box-shadow: 0 1px 2px rgba(0,0,0,.5); }
.sb-nfl-floating-25 .sb-pips i.used { opacity: .25; }
.sb-nfl-floating-25 .pill { position: absolute; top: 0; height: 34px; width: 300px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-radius: 4px; font-size: 22px; box-shadow: 0 2px 6px rgba(0,0,0,.45); }
`,
  draw(root, g, { time }) {
    const row = el('div', 'row');
    const live = g.status !== 'pre';
    const lead = g.status === 'final' && g.away.score != null && g.home.score != null ? (g.away.score > g.home.score ? 'away' : g.home.score > g.away.score ? 'home' : '') : '';
    const score = (t, side) => el('div', 'score' + (lead && lead !== side ? ' lose' : ''), live && t.score != null ? String(t.score) : '');
    const mid = el('div', 'mid');
    if (g.status === 'live') {
      if (g.clock) mid.appendChild(el('div', 'clk', g.clock));
      const per = el('div', 'per'); per.appendChild(ordinal(g.period)); mid.appendChild(per);
    } else {
      mid.appendChild(el('div', 'per', statusText(g, time)));
    }
    const hl = logo(g.home, 150); hl.style.justifySelf = 'start'; hl.style.objectPosition = 'left center'; hl.style.marginRight = '0'; hl.style.marginLeft = '4px';
    row.append(logo(g.away, 150), score(g.away, 'away'), mid, score(g.home, 'home'), hl);
    root.appendChild(row);
    // record and timeouts under each score (record outside, bars towards the middle, as on air)
    // the away line ends at the away score's right edge, the home line starts at the home score's left edge
    const sub = (t, side, withPips) => {
      const s = el('div', 'sub');
      const rec = el('span', '', t.record || '');
      if (side === 'home') { s.style.left = '440px'; s.append(...(withPips ? [pips(t.timeouts, 3)] : []), rec); }
      else { s.style.right = (W - 310) + 'px'; s.append(rec, ...(withPips ? [pips(t.timeouts, 3)] : [])); }
      root.appendChild(s);
    };
    const showPips = g.sport === 'football' && g.status === 'live';
    if (showPips || g.away.record || g.home.record) { sub(g.away, 'away', showPips); sub(g.home, 'home', showPips); }
    // down and distance above the team with the ball, in that team's colour
    const ball = g.away.hasBall ? 'away' : g.home.hasBall ? 'home' : null;
    if (g.status === 'live' && g.football && g.football.short && ball) {
      const c = teamColor(g[ball]);
      const pill = el('div', 'pill');
      pill.style.background = c; pill.style.color = inkOn(c);
      pill.style.left = (ball === 'away' ? 8 : W - 308) + 'px';
      pill.appendChild(el('span', '', g.football.short));
      root.appendChild(pill);
    }
  },
};
