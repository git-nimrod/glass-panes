// "Rounded card '26": after the MLB bug on Netflix (2026 on). A dark rounded card with a pale rim: two thin lines across the top
// fading out of the teams' colours (on air the batter and pitcher; here each team's name and record), then two rounded pills in the team
// colours with the logo and score, and at the right the bases as glassy white tiles over the half inning, the count and the outs. The
// streamer's wordmark above the bases becomes the Home Assistant logo, in its own blue.
import { el } from '../util.js';
import { logo, bases, inning, pips, statusText, teamColor, shade, haMark, marks } from './kit.js';

const W = 540, H = 360;

export default {
  id: 'mlb-card-26',
  size: { w: W, h: H },
  fonts: [{ family: 'GP Montserrat Heavy', file: 'montserrat-latin-wght-normal.woff2', desc: { weight: '600 900' } }],
  css: `
.sb-mlb-card-26 { font-family: 'GP Montserrat Heavy', 'Montserrat', 'Arial Black', sans-serif; font-weight: 800; color: #fff; }
.sb-mlb-card-26 .card { position: absolute; inset: 0; box-sizing: border-box; border: 4px solid #d6d4c6; border-radius: 30px; background: linear-gradient(#242220, #121110);
  box-shadow: 0 4px 12px rgba(0,0,0,.5); }
.sb-mlb-card-26 .ln { position: absolute; left: 22px; right: 26px; height: 40px; display: flex; align-items: center; justify-content: space-between; font-size: 25px; padding-left: 10px; border-radius: 4px; }
.sb-mlb-card-26 .ln span:last-child { font-size: 26px; }
.sb-mlb-card-26 .pill { position: absolute; left: 22px; width: 268px; height: 112px; border-radius: 18px; display: flex; align-items: center; gap: 18px; padding: 0 26px 0 14px;
  box-sizing: border-box; box-shadow: inset 0 2px 0 rgba(255,255,255,.35), inset 0 -3px 0 rgba(0,0,0,.3); }
.sb-mlb-card-26 .sb-logo { width: 96px; height: 92px; object-fit: contain; filter: drop-shadow(0 2px 2px rgba(0,0,0,.4)); }
.sb-mlb-card-26 .pill .s { flex: 1; text-align: center; font-size: 72px; }
.sb-mlb-card-26 .side { position: absolute; left: 300px; right: 18px; top: 112px; bottom: 22px; display: grid; justify-items: center; align-content: center; gap: 12px; }
.sb-mlb-card-26 .side .sb-ha { color: #18bcf2; filter: drop-shadow(0 0 6px rgba(24,188,242,.45)); }
.sb-mlb-card-26 .sb-bases i { background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 2px rgba(255,255,255,.18); }
.sb-mlb-card-26 .sb-bases i.on { background: linear-gradient(135deg, #ffffff, #d9d9d9); box-shadow: 0 0 12px rgba(255,255,255,.55); }
.sb-mlb-card-26 .st { display: flex; align-items: center; gap: 18px; font-size: 36px; white-space: nowrap; }
.sb-mlb-card-26 .sb-pips { display: flex; gap: 8px; } .sb-mlb-card-26 .sb-pips i { width: 24px; height: 24px; border-radius: 50%; background: #fafafa; }
.sb-mlb-card-26 .sb-pips i.used { background: #2a2a2a; }
.sb-mlb-card-26 .w { font-size: 34px; text-align: center; line-height: 1.15; }
`,
  draw(root, g, { time, opts }) {
    const live = g.status === 'live' && !!g.baseball; // a baseball bug forced onto another sport's game shows only the scores
    const card = el('div', 'card');
    [g.away, g.home].forEach((t, i) => {
      const c = teamColor(t, '#4a4f57');
      const ln = el('div', 'ln');
      ln.style.top = (18 + i * 46) + 'px';
      ln.style.background = 'linear-gradient(90deg, ' + c + ', ' + shade(c, -0.3) + ' 45%, transparent 70%)';
      ln.append(el('span', '', String(t.name || t.abbr || '').toUpperCase().slice(0, 16)), el('span', '', t.record || ''));
      card.appendChild(ln);
      const p = el('div', 'pill');
      p.style.top = (118 + i * 116) + 'px';
      p.style.background = 'linear-gradient(' + shade(c, 0.12) + ', ' + shade(c, -0.25) + ')';
      p.append(logo(t, 96), el('span', 's', g.status !== 'pre' && t.score != null ? String(t.score) : ''));
      card.appendChild(p);
    });
    const side = el('div', 'side');
    if (marks(opts).ha) side.appendChild(haMark(66));   // the streamer's red wordmark sat above the bases
    if (live) {
      const b = g.baseball;
      side.appendChild(bases(b.bases, 50));
      const st = el('div', 'st');
      st.append(el('span', '', inning(g)), el('span', '', b.balls + '-' + b.strikes), pips(b.outs, 2));
      side.appendChild(st);
    } else side.appendChild(el('span', 'w', statusText(g, time)));
    card.appendChild(side);
    root.appendChild(card);
  },
};
