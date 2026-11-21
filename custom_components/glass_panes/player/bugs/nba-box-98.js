// "Box '98": after the NBA score box on NBC (1996-98). A small box low in the corner: the league's logo standing tall at the left
// (red over blue), then a steel-blue box with the two teams' names and scores in heavy condensed capitals with black outlines, and a
// bottom row with the quarter on a bright blue tab and the clock in LCD digits in a dark window. The network's mark under the logo
// becomes the Home Assistant logo. Drawn soft, with scanlines, the way it looked on a 1998 TV (bug_tv: clean turns that off).
import { el } from '../util.js';
import { statusText, leagueLogo, haMark, marks } from './kit.js';

const W = 400, H = 170, TALL = 74;

export default {
  id: 'nba-box-98',
  size: { w: W, h: H },
  tv: 'soft',
  fonts: [{ family: 'GP Barlow Condensed', file: 'sports/barlow-condensed-latin-700-normal.woff2', desc: { weight: '700' } },
    { family: 'GP DSEG7', file: 'sports/dseg7-classic-bold.woff2', desc: { weight: '700' } }],
  css: `
.sb-nba-box-98 { font-family: 'GP Barlow Condensed', 'Arial Narrow', sans-serif; font-weight: 700; color: #f4f4ee; }
.sb-nba-box-98 .tall { position: absolute; left: 0; top: 0; width: ${TALL}px; height: ${H}px; overflow: hidden; border-radius: 6px 0 0 6px;
  background: linear-gradient(#c8202c 0, #c8202c 50%, #1d428a 50%); box-shadow: inset 0 0 0 2px rgba(255,255,255,.6); }
.sb-nba-box-98 .tall .sb-league { position: absolute; left: 50%; top: 50%; width: 150px; height: 150px; transform: translate(-50%, -54%) scale(1.12); object-fit: contain; }
.sb-nba-box-98 .tall .sb-league-text { left: 0; top: 0; width: 100%; height: 100%; transform: none; display: grid; place-items: center; writing-mode: vertical-rl; }
.sb-nba-box-98 .tall .sb-ha { position: absolute; left: 50%; bottom: 6px; transform: translateX(-50%); color: #fff; filter: drop-shadow(0 1px 1px #000); }
.sb-nba-box-98 .box { position: absolute; left: ${TALL}px; top: 0; right: 0; height: ${H}px; background: linear-gradient(rgba(96,116,190,.9), rgba(52,72,150,.9) 55%, rgba(34,50,120,.92));
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.5); border-radius: 0 6px 6px 0; }
.sb-nba-box-98 .r { position: absolute; left: 10px; right: 10px; display: flex; justify-content: space-between; font-size: 56px; line-height: 56px; letter-spacing: .5px;
  text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 3px 4px 0 rgba(0,0,0,.6); }
.sb-nba-box-98 .r .n { max-width: 220px; overflow: hidden; white-space: nowrap; }
.sb-nba-box-98 .r .s { min-width: 62px; text-align: right; }
.sb-nba-box-98 .bot { position: absolute; left: 8px; right: 8px; bottom: 8px; height: 46px; display: flex; gap: 10px; }
.sb-nba-box-98 .tab { background: linear-gradient(#3d6cf0, #1f45c9); border: 2px solid #dfe6ff; padding: 0 12px; font-size: 34px; line-height: 42px; text-shadow: 2px 2px 0 #000; }
.sb-nba-box-98 .win { flex: 1; display: flex; justify-content: flex-end; align-items: center; background: #070b2a; border: 2px solid #dfe6ff; padding: 0 12px;
  font-family: 'GP DSEG7', 'GP Barlow Condensed', monospace; font-size: 30px; letter-spacing: 2px; color: #eef3ff; text-shadow: 0 0 6px rgba(160,190,255,.7); }
.sb-nba-box-98 .win.t { font-family: 'GP Barlow Condensed', sans-serif; font-size: 36px; letter-spacing: .5px; }
`,
  draw(root, g, { time, opts }) {
    const mk = marks(opts);
    const tall = el('div', 'tall');
    if (mk.league) tall.appendChild(leagueLogo(g, 150));
    if (mk.ha) tall.appendChild(haMark(30));
    const box = el('div', 'box');
    // 90s boxes wrote the city or the short name; the sensor's short name fits best
    const nm = (t) => String(t.name || t.abbr || '').toUpperCase();
    [g.away, g.home].forEach((t, i) => {
      const r = el('div', 'r');
      r.style.top = (6 + i * 56) + 'px';
      r.append(el('span', 'n', nm(t)), el('span', 's', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      box.appendChild(r);
    });
    const bot = el('div', 'bot');
    if (g.status === 'live') {
      bot.appendChild(el('span', 'tab', g.period.word ? g.period.label : g.period.label + (g.period.suffix || '').toLowerCase()));
      // DSEG draws "!" as an unlit digit, so a short clock is padded the way the old boards did
      bot.appendChild(el('span', 'win', (g.clock || '').padStart(5, '!')));
    } else bot.appendChild(el('span', 'win t', statusText(g, time)));
    box.appendChild(bot);
    root.append(tall, box);
  },
};
