// "Bases box '25": after the MLB bug on FOX (2024 on). Two tall team panels in their colours, each with the team's letters over a big
// score and its logo faded large behind them, a white middle with the half inning and count over the outs, and three solid white bases
// standing out of the bottom edge like real bags. The pitcher and batter lines above it on air need data the sensor does not have,
// so they are left out.
import { el } from '../util.js';
import { logo, bases, inning, statusText, teamColor, shade, inkOn } from './kit.js';

const W = 560, H = 236, BOX = 176;

export default {
  id: 'mlb-bases-25',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Barlow Condensed', file: 'sports/barlow-condensed-latin-700-normal.woff2', desc: { weight: '700' } }],
  css: `
.sb-mlb-bases-25 { font-family: 'GP Barlow Condensed', 'Arial Narrow', sans-serif; font-weight: 700; color: #fff; }
.sb-mlb-bases-25 .box { position: absolute; left: 0; top: 0; width: ${W}px; height: ${BOX}px; display: grid; grid-template-columns: 172px 1fr 172px; gap: 4px; }
.sb-mlb-bases-25 .tp { position: relative; overflow: hidden; display: grid; justify-items: center; align-content: center; box-shadow: inset 0 -5px 0 rgba(0,0,0,.25); }
.sb-mlb-bases-25 .tp .sb-logo { position: absolute; left: -30px; top: 6px; width: 240px; height: 220px; object-fit: contain; opacity: .3; filter: blur(3px) saturate(.6) brightness(1.4); }
.sb-mlb-bases-25 .tp::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 20% 15%, rgba(255,255,255,.18), transparent 45%), radial-gradient(circle at 80% 80%, rgba(0,0,0,.18), transparent 50%); }
.sb-mlb-bases-25 .tp b { position: relative; z-index: 1; font-size: 58px; line-height: 1; letter-spacing: 1px; text-shadow: 0 3px 2px rgba(0,0,0,.35); }
.sb-mlb-bases-25 .tp .s { position: relative; z-index: 1; font-size: 100px; line-height: .95; text-shadow: 0 3px 2px rgba(0,0,0,.35); }
.sb-mlb-bases-25 .mid { background: linear-gradient(#ffffff, #e2e2e2); color: #1a1a1a; display: grid; align-content: start; justify-items: center; padding-top: 30px; gap: 6px; }
.sb-mlb-bases-25 .mid .a { font-size: 48px; line-height: 1; word-spacing: 14px; }
.sb-mlb-bases-25 .mid .o { font-size: 44px; line-height: 1; } .sb-mlb-bases-25 .mid .o small { font-size: 34px; }
.sb-mlb-bases-25 .mid .w { font-size: 40px; text-align: center; line-height: 1.1; margin-top: 10px; }
.sb-mlb-bases-25 .bags { position: absolute; left: 50%; top: ${BOX - 66}px; transform: translateX(-50%) scaleY(.62); }
.sb-mlb-bases-25 .bags i { background: linear-gradient(135deg, #f4f4f4, #cfcfcf 55%, #a9a9a9); box-shadow: 4px 4px 0 #5f5f5f, 6px 6px 6px rgba(0,0,0,.45); }
.sb-mlb-bases-25 .bags i.on { background: linear-gradient(135deg, #ffffff, #fff4c4 55%, #e8c64a); box-shadow: 4px 4px 0 #8a7420, 0 0 14px rgba(255,214,90,.8); }
`,
  draw(root, g, { time }) {
    const live = g.status === 'live' && !!g.baseball; // a baseball bug forced onto another sport's game shows only the scores
    const box = el('div', 'box');
    const panel = (t) => {
      const c = teamColor(t, '#4a4f57');
      const p = el('div', 'tp');
      p.style.background = 'linear-gradient(' + shade(c, 0.22) + ', ' + shade(c, 0.02) + ')';
      p.style.color = inkOn(c) === '#111' ? shade(c, -0.8) : '#fff';
      p.append(logo(t, 220), el('b', '', (t.abbr || '').toUpperCase()), el('span', 's', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      return p;
    };
    const mid = el('div', 'mid');
    if (live) {
      const b = g.baseball;
      mid.appendChild(el('span', 'a', inning(g) + ' ' + b.balls + '-' + b.strikes));
      const o = el('span', 'o', String(b.outs) + ' ');
      o.appendChild(el('small', '', b.outs === 1 ? 'OUT' : 'OUTS'));
      mid.appendChild(o);
    } else mid.appendChild(el('span', 'w', statusText(g, time)));
    box.append(panel(g.away), mid, panel(g.home));
    root.appendChild(box);
    if (live) root.appendChild(bases(g.baseball.bases, 56, 'sb-bases bags'));
  },
};
