// Pane colour themes. A theme is a small named set of colours a pane can opt into with `"theme": "moss"` (see docs/pane-schema.md).
//
// How it works: every widget colours itself with CSS variables (--gp-fg, --gp-dim, ...) defined in player.css. A theme just gives those
// variables new values on the pane's stage, and sets the stage background. A pane WITHOUT a theme never touches any of this, so it looks
// exactly as it always did. The player (engine.js) and the builder (panel, for the readability warning) both read this one list.
//
// Each theme: label (for the builder), bg (the pane background), fg (main text), dim (secondary text), faint (quiet text and lines),
// accent. Light themes also darken warn/good/bad, because the default orange/green/red are made for dark backgrounds and fade on cream.

export const THEMES = {
  moss:     { label: 'Moss',     bg: '#1f2a1c', fg: '#e6ecd8', dim: '#a3b08f', faint: '#7f8d6c', accent: '#b5c96a' },
  cream:    { label: 'Cream',    bg: '#f3efe0', fg: '#2b2a24', dim: '#625e50', faint: '#8a8678', accent: '#3f6b3a', warn: '#955400', good: '#2f6b3f', bad: '#b3261e' },
  // Cream Night: the cream palette on a very dark warm background. Meant for a two-way mirror, where only dark is see-through and a bright
  // background shows as a slab of light. Cream text, a soft gold accent.
  creamnight: { label: 'Cream Night', bg: '#0d0b08', fg: '#efe8d2', dim: '#b9b093', faint: '#8c8570', accent: '#c9b36a' },
  midnight: { label: 'Midnight', bg: '#0b1220', fg: '#e8edf7', dim: '#93a0b8', faint: '#66728a', accent: '#7aa8ff' },
  paper:    { label: 'Paper',    bg: '#faf8f3', fg: '#141414', dim: '#55524b', faint: '#85817a', accent: '#8b1e1e', warn: '#8a5300', good: '#1e6b3a', bad: '#a61b1b' },
  slate:    { label: 'Slate',    bg: '#2b3138', fg: '#eceff2', dim: '#a0a9b3', faint: '#7b8590', accent: '#5fb3b3' },
};
export const THEME_IDS = Object.keys(THEMES);

// every CSS variable a theme may set, so switching theme (or back to none) can clear the lot
const VARS = ['--gp-fg', '--gp-dim', '--gp-faint', '--gp-accent', '--gp-warn', '--gp-good', '--gp-bad',
  '--gp-strong', '--gp-soft', '--gp-line', '--gp-line2', '--gp-track', '--gp-rule', '--gp-src', '--gp-ring-track', '--gp-avatar'];

/** True for a theme with a dark background (its text is light), so true black behind it still reads. The light themes (cream, paper) have dark text and need their own light background. */
export function themeIsDark(id) {
  const t = THEMES[id];
  if (!t) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.bg.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35;
}

/** The background a pane's stage gets. A theme brings its own, UNLESS the pane sets `own_background: true`: then the pane's own `background`
 *  (true black when it has none) is used and only the theme's colours apply. True black matters on a two-way mirror, where only pure black is
 *  see-through and any lit dark shows as a visible rectangle. A pane with a theme and no `own_background` is drawn exactly as it always was. */
export function paneBackground(pane) {
  const t = pane && THEMES[pane.theme];
  if (t && pane.own_background !== true) return t.bg;
  return (pane && pane.background) || '#000000';
}

/** Put a theme on a stage element (or take it off when `id` is empty or unknown). Returns the background the stage should use, or null. */
export function applyTheme(stage, id) {
  VARS.forEach((v) => stage.style.removeProperty(v));
  const t = THEMES[id];
  if (!t) { delete stage.dataset.gpTheme; return null; }
  const set = (k, v) => stage.style.setProperty(k, v);
  set('--gp-fg', t.fg); set('--gp-dim', t.dim); set('--gp-faint', t.faint); set('--gp-accent', t.accent);
  if (t.warn) set('--gp-warn', t.warn);
  if (t.good) set('--gp-good', t.good);
  if (t.bad) set('--gp-bad', t.bad);
  // the greys player.css hardcodes for sports rows, dividers, avatars and the like follow the theme too
  set('--gp-strong', t.fg); set('--gp-soft', t.dim); set('--gp-line', t.faint); set('--gp-line2', t.faint); set('--gp-src', t.faint);
  set('--gp-avatar', t.fg);
  set('--gp-track', `color-mix(in srgb, ${t.fg} 16%, transparent)`);
  set('--gp-rule', `color-mix(in srgb, ${t.fg} 22%, transparent)`);
  set('--gp-ring-track', `color-mix(in srgb, ${t.fg} 16%, transparent)`);
  stage.dataset.gpTheme = id;
  return t.bg;
}

/** The colours the readability check should use for a pane: { bg, named } where named maps fg/dim/... to hex. Null for no theme. */
export function themeColors(id) {
  const t = THEMES[id];
  return t ? { bg: t.bg, named: { fg: t.fg, dim: t.dim, faint: t.faint, accent: t.accent, ...(t.warn ? { warn: t.warn } : {}), ...(t.good ? { good: t.good } : {}), ...(t.bad ? { bad: t.bad } : {}) } } : null;
}
