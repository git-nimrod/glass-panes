// "Team blocks '25": after the 2025 NFL Sunday package on CBS. A strip of three parts: each team a block in its own colour with the logo
// and a big bold score (three timeout dashes under it), and a centre panel: a grey top band and a black band with the quarter | clock.
// The centre's top band carries the down and distance (on air it holds the network's wordmark, which we leave out).
import { el } from '../util.js';
import { logo, ordinal, pips, statusText, teamColor } from './kit.js';

const W = 780, H = 100;

export default {
  id: 'nfl-blocks-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Montserrat Heavy', file: 'montserrat-latin-wght-normal.woff2', desc: { weight: '600 900' } }],
  css: `
.sb-nfl-blocks-25 { font-family: 'GP Montserrat Heavy', 'Montserrat', 'Arial Black', sans-serif; color: #fff; display: flex; height: ${H}px; filter: drop-shadow(0 3px 6px rgba(0,0,0,.5)); }
.sb-nfl-blocks-25 .team { position: relative; width: 270px; display: grid; grid-template-columns: 1fr 112px; align-items: center; }
.sb-nfl-blocks-25 .team.away { border-radius: 8px 0 0 8px; } .sb-nfl-blocks-25 .team.home { border-radius: 0 8px 8px 0; }
.sb-nfl-blocks-25 .sb-logo { width: 84px; height: 84px; object-fit: contain; justify-self: center; }
.sb-nfl-blocks-25 .score { position: relative; height: 100%; display: grid; place-items: center; font-weight: 800; font-size: 60px; line-height: 1; background: rgba(0,0,0,.16); }
.sb-nfl-blocks-25 .sb-pips { position: absolute; left: 0; right: 0; bottom: 10px; display: flex; justify-content: center; gap: 8px; }
.sb-nfl-blocks-25 .sb-pips i { width: 22px; height: 4px; background: #fff; border-radius: 1px; } .sb-nfl-blocks-25 .sb-pips i.used { opacity: .25; }
.sb-nfl-blocks-25 .ball { position: absolute; top: 8px; right: 122px; width: 0; height: 0; border-top: 7px solid transparent; border-bottom: 7px solid transparent; border-left: 11px solid #fff; }
.sb-nfl-blocks-25 .team.home .ball { right: auto; left: 10px; }
.sb-nfl-blocks-25 .mid { width: 240px; display: grid; grid-template-rows: 44px 1fr; }
.sb-nfl-blocks-25 .top { background: #3c3e42; display: grid; place-items: center; font-weight: 700; font-size: 24px; letter-spacing: .5px; color: #f2f2f2; }
.sb-nfl-blocks-25 .bot { background: #0e0e0f; display: flex; align-items: center; justify-content: center; gap: 16px; font-weight: 800; font-size: 30px; }
.sb-nfl-blocks-25 .bar { width: 2px; height: 30px; background: #7a7c80; }
.sb-nfl-blocks-25 .sb-ord { font-size: .62em; }
`,
  draw(root, g, { time }) {
    const team = (t, side) => {
      const c = teamColor(t, '#2f3236');
      const b = el('div', 'team ' + side);
      b.style.background = c;
      const sc = el('div', 'score', g.status !== 'pre' && t.score != null ? String(t.score) : '');
      if (g.sport === 'football' && g.status === 'live') sc.appendChild(pips(t.timeouts, 3));
      if (side === 'home') b.style.gridTemplateColumns = '112px 1fr';
      if (side === 'home') b.append(sc, logo(t, 84)); else b.append(logo(t, 84), sc);
      if (t.hasBall && g.status === 'live') b.appendChild(el('span', 'ball'));
      return b;
    };
    const mid = el('div', 'mid');
    mid.appendChild(el('div', 'top', g.status === 'live' && g.football && g.football.short ? g.football.short : g.status === 'live' ? '' : g.league));
    const bot = el('div', 'bot');
    if (g.status === 'live') {
      bot.appendChild(ordinal(g.period));
      if (g.clock) { bot.appendChild(el('span', 'bar')); bot.appendChild(el('span', '', g.clock)); }
    } else bot.appendChild(el('span', '', statusText(g, time)));
    mid.appendChild(bot);
    root.append(team(g.away, 'away'), mid, team(g.home, 'home'));
  },
};
