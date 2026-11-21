// The news feed widget (rss), loaded only when a pane has one. Home Assistant fetches the feed and keeps a copy (feed_cache.py); the display
// only asks Home Assistant, every few minutes, and draws again only when the stories' fingerprint changes (and once an hour when it shows
// how old they are), so a quiet feed costs nothing.
import { clear, el } from './util.js';
import { cleanTitle, quick } from './widgets.js';


/** "3h", "2d": how long ago a story came out (Unix seconds), or '' when the feed gave no date. */
export function storyAge(seconds, nowMs) {
  if (!seconds) return '';
  const min = Math.max(0, Math.round((nowMs - seconds * 1000) / 60000));
  return min < 60 ? Math.max(min, 1) + 'm' : min < 48 * 60 ? Math.round(min / 60) + 'h' : Math.round(min / 1440) + 'd';
}

/** The stories an rss widget shows: teasers left out (unless switched off), long ones left out or shortened, at most max_stories. */
export function feedStories(items, o) {
  const max = o.max_headline_chars || 140, skip = o.skip_teasers !== false;
  const out = [];
  for (const item of items || []) {
    if (!item || !item.title) continue;
    let title = cleanTitle(item.title);
    if (skip && !quick(item.title, max)) continue;
    if (!skip && title.length > max) title = title.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    out.push({ ...item, title });
    if (out.length >= Math.min(Math.max(o.max_stories || 3, 1), 10)) break;
  }
  return out;
}

export function rss(ctx) {
  const o = ctx.opts, S = ctx.style.size || 26;
  const every = Math.min(Math.max(Math.round((o.refresh_minutes || 30) / 2), 5), 60) * 60000;
  let drawn = null;
  const draw = (r) => {
    clear(ctx.root);
    const pick = feedStories(r.items, o);
    pick.forEach((n, i) => {
      const d = el('div', 'gp-story');
      const h = el('div', 'gp-headline', n.title);
      if (i > 0) h.style.fontSize = Math.round(S * 0.85) + 'px';
      d.appendChild(h);
      if (o.show_summary && n.summary) d.appendChild(el('div', 'gp-dim gp-summary', n.summary));
      const meta = [o.show_source ? r.title : '', o.show_time ? storyAge(n.time, Date.now()) : ''].filter(Boolean).join(' · ');
      if (meta) d.appendChild(el('div', 'gp-label', meta));
      ctx.root.appendChild(d);
    });
    if (!pick.length) ctx.root.appendChild(el('div', 'gp-dim', !o.url ? 'Add a feed address in More options' : r.problem && !(r.items || []).length ? 'News unavailable' : 'Slow news day.'));
  };
  const load = async () => {
    const r = await ctx.data.feed(ctx.paneId, ctx.widgetId, o.url);
    if (!r || !ctx.alive()) return;
    const key = (r.hash || '') + '|' + ((r.items || []).length ? '' : r.problem || '') + (o.show_time ? '|' + Math.floor(Date.now() / 3600000) : '');
    if (key === drawn) return;                 // nothing new: leave the page alone
    drawn = key;
    draw(r);
  };
  if (!o.url) { load(); return; }              // no address yet: one look (demo stories in the builder), then nothing to ask for
  ctx.every(every, load);
}

