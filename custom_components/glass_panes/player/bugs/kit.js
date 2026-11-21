// Broadcast scorebugs for the sports widget (layout: bug). Loaded only when a pane uses one, so a display that never shows a
// scorebug never downloads any of this.
//
//   gameOf(state)     a Team Tracker sensor state -> one tidy game record (pure; tested)
//   sportsBug(ctx)    the widget: picks the games, picks a bug per game, draws them scaled to the widget
//   helpers           what every bug file uses (logos, ordinals, timeout pips, base diamond, fonts)
//
// Each bug lives in its own file (bugs/<id>.js): { id, size: {w, h}, fonts: [...], css, draw(root, game, h) }. It is drawn at the
// broadcast's own pixel size and then scaled to the widget, so it looks the same at any widget size. No network logos or wordmarks;
// team logos come from the person's own Team Tracker sensors.

import { clear, el, okState } from '../util.js';
import { iconNode, loadIcon } from '../icons.js';

// ---------------------------------------------------------------- the game record

const ORD = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const SPORT = { football: 'football', basketball: 'basketball', hockey: 'hockey', baseball: 'baseball', soccer: 'soccer' };

/** "12:00 - 3rd" -> "12:00"; "67'" stays; a pre-game date line gives ''. */
function clockOf(raw, sport) {
  const s = String(raw || '').trim();
  if (sport === 'soccer') { const m = /(\d+)(\+\d+)?'/.exec(s); return m ? m[0] : ''; }
  const m = /^(\d{1,2}:\d{2}|:\d{2}|\d{1,2}\.\d)/.exec(s);
  return m ? m[1] : '';
}

/** The period as broadcasts write it: { n, label, suffix } where label is the number part ("3") and suffix "RD", or a word ("OT", "HALF"). */
function periodOf(sport, league, n, clockText) {
  if (!n) return { n: 0, label: '', suffix: '' };
  if (sport === 'baseball') {
    const t = String(clockText || '').toLowerCase();
    const half = /^(top|mid)/.test(t) ? 'top' : /^(bot|end)/.test(t) ? 'bot' : null;
    return { n, label: String(n), suffix: ORD(n).replace(/^\d+/, ''), half };
  }
  if (sport === 'soccer') return n <= 2 ? { n, label: n === 1 ? '1ST' : '2ND', suffix: ' HALF', word: true } : { n, label: 'ET', suffix: '', word: true };
  const regular = sport === 'hockey' ? 3 : (league === 'NCAAM' || league === 'NCAAW') ? 2 : 4;
  if (n > regular) {
    const ot = n - regular;
    return { n, label: sport === 'hockey' && league !== 'NHL-PLAYOFFS' && ot > 1 ? 'SO' : ot > 1 ? ot + 'OT' : 'OT', suffix: '', word: true };
  }
  return { n, label: String(n), suffix: ORD(n).replace(/^\d+/, '') };
}

/**
 * One tidy game from a Team Tracker sensor state (attributes team_* and opponent_*), or null when there is nothing to show.
 * Teams come out as away and home (the order US broadcasts use; a soccer bug may flip them).
 */
export function gameOf(s, now = Date.now()) {
  if (!okState(s) || !s.attributes) return null;
  const a = s.attributes, state = String(s.state || a.state || '').toUpperCase();
  const status = state === 'IN' ? 'live' : state === 'POST' ? 'final' : state === 'PRE' ? 'pre' : null;
  if (!status) return null;
  const sport = SPORT[String(a.sport || '').toLowerCase()] || 'other', league = String(a.league || '').toUpperCase();
  const side = (p) => ({
    id: a[p + '_id'], abbr: a[p + '_abbr'] || '', name: a[p + '_name'] || a[p + '_abbr'] || '', longName: a[p + '_long_name'] || '',
    logo: a[p + '_logo'] || '', color: (a[p + '_colors'] || [])[0] || '', color2: (a[p + '_colors'] || [])[1] || '',
    score: num(a[p + '_score']), record: a[p + '_record'] || '', rank: num(a[p + '_rank']), timeouts: num(a[p + '_timeouts']),
    winner: a[p + '_winner'] === true, shots: num(a[p + '_shots_on_target']), hasBall: false,
  });
  const team = side('team'), opp = side('opponent');
  const home = a.team_homeaway === 'away' ? opp : team, away = home === team ? opp : team;
  if (a.possession != null && a.possession !== '') [away, home].forEach((t) => { t.hasBall = String(t.id) === String(a.possession); });
  const g = {
    sport, league, status, starts: Date.parse(a.date) || now, tv: a.tv_network || '', lastPlay: a.last_play || '',
    clock: status === 'live' ? clockOf(a.clock, sport) : '', period: periodOf(sport, league, num(a.quarter != null ? a.quarter : a.period), a.clock),
    away, home,
  };
  if (sport === 'football') {
    const dd = String(a.down_distance_text || '');
    const m = /^(\d)(?:st|nd|rd|th)\s*&\s*(\w+)/i.exec(dd);
    g.football = { text: dd, down: m ? Number(m[1]) : null, distance: m ? m[2] : null, short: m ? ORD(Number(m[1])) + ' & ' + m[2].toUpperCase() : '' };
  }
  if (sport === 'baseball') {
    g.baseball = { outs: num(a.outs) || 0, balls: num(a.balls) || 0, strikes: num(a.strikes) || 0, bases: [!!a.on_first, !!a.on_second, !!a.on_third], half: g.period.half };
  }
  if (sport === 'soccer') {
    const m = /(\d+)%[^\d]+(\d+)%/.exec(g.lastPlay);
    g.soccer = { possession: m ? [Number(m[1]), Number(m[2])] : null };
  }
  return g;
}

/** Which games to show, in order: live, then finals of the last 18 hours, then today's games; `next` adds the coming week's. */
export function gamesToShow(games, now, opts) {
  const h = 3600000, max = opts.max_games || 3;
  const keep = games.filter(Boolean).filter((g) => g.status === 'live' || (g.status === 'final' && now - g.starts < 18 * h) ||
    (g.status === 'pre' && g.starts - now < (opts.show_next === false ? 18 : 7 * 24) * h && g.starts > now - 3 * h));
  const rank = { live: 0, final: 1, pre: 2 };
  return keep.sort((x, y) => rank[x.status] - rank[y.status] || x.starts - y.starts).slice(0, max);
}

// ---------------------------------------------------------------- helpers for the bug files

const HERE = new URL('./', import.meta.url);
const loaded = new Set();
/** Make sure a font a bug needs is registered (once per page). Fonts live in player/fonts/. */
export function font(family, file, desc) {
  if (loaded.has(family) || typeof FontFace === 'undefined') return;
  loaded.add(family);
  try {
    const f = new FontFace(family, 'url(' + new URL('../fonts/' + file, HERE).href + ')', desc || {});
    document.fonts.add(f);
    f.load().catch(() => {});
  } catch (e) { /* the fallback font draws instead */ }
}

/** A team logo at the size it is drawn: ESPN logos are asked for at that size (a few KB instead of 30-100 KB). */
export function logoUrl(url, px) {
  const m = /^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+\.png)$/.exec(url || '');
  return m ? 'https://a.espncdn.com/combiner/i?img=' + m[1] + '&w=' + px + '&h=' + px : url;
}

/** A round badge with the team's letters in its colour, for a missing or broken logo. */
export function badge(team) {
  const c = /^#[0-9a-f]{3,6}$/i.test(team.color || '') ? team.color : '#555';
  return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="' + c +
    '"/><text x="50" y="62" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="32" fill="#fff">' + String(team.abbr || '?').replace(/\W/g, '').slice(0, 4) + '</text></svg>');
}

/** An <img> for a team's logo, `px` square, that falls back to the badge. */
export function logo(team, px, cls) {
  const im = el('img', cls || 'sb-logo');
  im.alt = '';
  im.width = px; im.height = px;
  const full = team.logo;
  im.src = full ? logoUrl(full, px * 2) : badge(team);
  im.onerror = () => { if (im.src !== full && full) { im.src = full; } else { im.onerror = null; im.src = badge(team); } };
  return im;
}

/** "3" + "RD" as two spans (the suffix smaller, the way broadcasts set it). */
export function ordinal(p, cls) {
  const s = el('span', cls || 'sb-period');
  s.appendChild(document.createTextNode(p.label));
  if (p.suffix) s.appendChild(el('span', 'sb-ord', p.suffix));
  return s;
}

// ---- the marks a broadcast puts on its bug. The network's own mark is never drawn; in its place goes the Home Assistant logo (from
// Home Assistant's own icon set, asked of the person's Home Assistant like every other icon). Where the broadcast showed the league's
// logo, the league's logo goes, loaded from the same ESPN image server the team logos come from. Neither is shipped with Glass Panes.

const LEAGUE_KEY = { NFL: 'nfl', NBA: 'nba', WNBA: 'wnba', NHL: 'nhl', MLB: 'mlb', MLS: 'mls' };

/** Which marks a widget wants: options.bug_marks both (default) | league | ha | none. */
export function marks(o) {
  const m = (o && o.bug_marks) || 'both';
  return { league: m === 'both' || m === 'league', ha: m === 'both' || m === 'ha' };
}

/** The league's logo, `px` square (`dark` for the version drawn for dark backgrounds); the league's letters when there is none. */
export function leagueLogo(g, px, cls, dark) {
  const k = LEAGUE_KEY[g.league];
  const text = () => { const s = el('span', (cls || 'sb-league') + ' sb-league-text', g.league || ''); s.style.fontSize = Math.round(px * 0.34) + 'px'; return s; };
  if (!k) return text();
  const im = el('img', cls || 'sb-league');
  im.alt = '';
  im.width = px; im.height = px;
  im.style.objectFit = 'contain';
  im.onerror = () => { im.onerror = null; im.replaceWith(text()); };
  im.src = logoUrl('https://a.espncdn.com/i/teamlogos/leagues/500' + (dark ? '-dark' : '') + '/' + k + '.png', px * 2);
  return im;
}

/** The Home Assistant logo, `px` square, in the text colour (set `color` on it or its parent). */
export function haMark(px, cls) {
  const s = el('span', cls || 'sb-ha');
  s.style.cssText = 'display:inline-grid;place-items:center;flex:none;width:' + px + 'px;height:' + px + 'px';
  loadIcon('home-assistant').then((d) => { if (d) s.appendChild(iconNode(d, px)); });
  return s;
}

/** A team logo address in the style the widget asks for (options.bug_logos: default | dark); only ESPN's logos have a dark version. */
export function logoStyle(url, style) {
  return style === 'dark' && /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/[a-z-]+\/500\//.test(url || '') ? url.replace('/500/', '/500-dark/') : url;
}

/** Light or dark text for a background colour (#rrggbb). */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return '#fff';
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111' : '#fff';
}

/** A team colour that reads on a dark bug: very dark or missing colours fall back to the second colour, then a neutral. */
export function teamColor(t, fallback) {
  const ok = (c) => /^#[0-9a-f]{6}$/i.test(c || '') && c.toLowerCase() !== '#d3d3d3' && c.toLowerCase() !== '#a9a9a9';
  return ok(t.color) ? t.color : ok(t.color2) ? t.color2 : (fallback || '#3a3f47');
}

/** A colour made darker (f < 0) or lighter (f > 0), -1..1. */
export function shade(hex, f) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  return '#' + m.slice(1).map((x) => { const v = parseInt(x, 16); return Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f).toString(16).padStart(2, '0'); }).join('');
}

/**
 * Old-TV picture for a bug: 'soft' = a standard-definition blur with faint scanlines (how bugs looked on a 90s/2000s set),
 * 'vhs' = softer still with the red/blue colour bleed of a taped game. One CSS filter, nothing animated.
 */
export const TV = {
  soft: 'blur(1.6px) contrast(1.08) saturate(1.1)',
  vhs: 'blur(2.1px) saturate(1.35) drop-shadow(2.5px 0 0 rgba(255,40,60,.4)) drop-shadow(-2.5px 0 0 rgba(40,170,255,.4))',
};
export function tvLook(stage, mode) {
  if (!TV[mode]) return;
  stage.style.filter = TV[mode];
  const lines = el('div', 'sb-scan');
  lines.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(rgba(0,0,0,' + (mode === 'vhs' ? '.28' : '.2') + ') 0 1px,transparent 1px 3px)';
  stage.appendChild(lines);
}

/** n timeout pips, the used ones dimmed. Football has 3 per half. */
export function pips(left, total, cls) {
  const box = el('span', cls || 'sb-pips');
  for (let i = 0; i < (total || 3); i++) box.appendChild(el('i', left != null && i >= left ? 'used' : ''));
  return box;
}

/**
 * The three bases as squares turned 45 degrees: second at the top, third left, first right. `on` is [first, second, third];
 * occupied bases get the class "on". `s` is a base's side in px. The bug's CSS colours `.sb-bases i` and `.sb-bases i.on`.
 */
export function bases(on, s, cls) {
  const box = el('span', cls || 'sb-bases');
  const step = s * 0.82, pad = s * 0.22;
  box.style.cssText = 'position:relative;display:inline-block;flex:none;width:' + (2 * step + s + 2 * pad) + 'px;height:' + (step + s + 2 * pad) + 'px';
  [[1, step, 0], [2, 0, step], [0, 2 * step, step]].forEach(([k, x, y]) => {
    const b = el('i', on && on[k] ? 'on' : '');
    b.style.cssText = 'position:absolute;box-sizing:border-box;left:' + (x + pad) + 'px;top:' + (y + pad) + 'px;width:' + s + 'px;height:' + s + 'px;transform:rotate(45deg)';
    box.appendChild(b);
  });
  return box;
}

/** "▲7" / "▼7" for the half inning, or the plain inning number when the half is unknown. */
export function inning(g) {
  const h = g.baseball && g.baseball.half;
  return (h === 'top' ? '▲' : h === 'bot' ? '▼' : '') + (g.period.label || '');
}

/** A small "when" line for a game that has not started or is over: "SUN 12:00 PM", "FINAL", "FINAL/OT". */
export function statusText(g, time) {
  if (g.status === 'final') return g.period.word && /OT|SO/.test(g.period.label) ? 'FINAL/' + g.period.label : 'FINAL';
  if (g.status === 'pre') {
    const d = new Date(g.starts), today = time.sameDay(d, new Date());
    return (today ? '' : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][time.parts(d).wd] + ' ') + time.ampm(d).toUpperCase();
  }
  return '';
}

// ---------------------------------------------------------------- the widget

let catalogue = null;
/** League / sport -> default bug id, from schema/scorebugs.json (read once). */
export function bugDefaults() {
  catalogue = catalogue || fetch(new URL('../../schema/scorebugs.json', import.meta.url).href).then((r) => r.json()).then((j) => {
    const d = {};
    (j.bugs || []).forEach((b) => (b.default_for || []).forEach((k) => { if (!d[k]) d[k] = b.id; }));
    return d;
  }).catch(() => ({ '*': 'nfl-blocks-25' }));
  return catalogue;
}

const bugCache = new Map();
const loadBug = (id) => {
  if (!bugCache.has(id)) bugCache.set(id, import('./' + id + '.js').then((m) => m.default));
  return bugCache.get(id);
};
const cssDone = new Set();
function addCss(bug) {
  if (cssDone.has(bug.id) || !bug.css) return;
  cssDone.add(bug.id);
  const st = document.createElement('style');
  st.textContent = bug.css;
  (document.head || document.documentElement).appendChild(st);
}

/** The bug for a game: the widget's own choice, else its per-league choice, else the catalogue default for that league. */
export function bugFor(g, opts, defaults) {
  if (opts.bug && opts.bug !== 'auto') return opts.bug;
  const byLeague = opts.bug_by_league || {};
  return byLeague[g.league] || defaults[g.league] || defaults[g.sport] || defaults['*'];
}

/** The sports widget wearing broadcast scorebugs. `defaults` maps league / sport to a bug id (schema/scorebugs.json). */
export async function sportsBug(ctx, defaults) {
  const o = ctx.opts, teams = (Array.isArray(ctx.slots.teams) ? ctx.slots.teams : [ctx.slots.teams]).filter(Boolean);
  const W = ctx.w || 1000, align = ctx.style.align || 'left';
  const render = async () => {
    const states = await Promise.all(teams.map((t) => ctx.data.state(t)));
    const games = gamesToShow(states.map((s) => gameOf(s)), Date.now(), o);
    const bugs = await Promise.all(games.map((g) => loadBug(bugFor(g, o, defaults)).catch(() => loadBug(defaults['*']))));
    if (!ctx.root.isConnected) return;
    clear(ctx.root);
    let y = 0;
    games.forEach((g, i) => {
      const bug = bugs[i];
      addCss(bug);
      (bug.fonts || []).forEach((f) => font(f.family, f.file, f.desc));
      const scale = Math.min(W / bug.size.w, (o.bug_height || bug.size.h) / bug.size.h);
      const holder = el('div', 'sb-holder');
      holder.style.cssText = 'position:relative;width:' + W + 'px;height:' + Math.round(bug.size.h * scale) + 'px;margin-bottom:' + (o.bug_gap == null ? 16 : o.bug_gap) + 'px';
      const stage = el('div', 'sb sb-' + bug.id);
      const left = align === 'right' ? W - bug.size.w * scale : align === 'center' ? (W - bug.size.w * scale) / 2 : 0;
      stage.style.cssText = 'position:absolute;top:0;left:' + Math.round(left) + 'px;width:' + bug.size.w + 'px;height:' + bug.size.h + 'px;transform-origin:0 0;transform:scale(' + scale.toFixed(4) + ')';
      if (o.bug_logos === 'dark') [g.away, g.home].forEach((t) => { t.logo = logoStyle(t.logo, 'dark'); });
      try { bug.draw(stage, g, { time: ctx.time, opts: o }); } catch (e) { stage.textContent = g.away.abbr + ' ' + (g.away.score ?? '') + ' - ' + (g.home.score ?? '') + ' ' + g.home.abbr; }
      tvLook(stage, o.bug_tv && o.bug_tv !== 'auto' ? o.bug_tv : bug.tv);
      holder.appendChild(stage);
      ctx.root.appendChild(holder);
      y += holder.offsetHeight;
    });
    if (!games.length && o.empty_text) ctx.root.appendChild(el('div', 'gp-dim', o.empty_text));
  };
  ctx.refresh(render, teams, 60000);
}
