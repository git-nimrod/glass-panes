// A plain message for a display that is signed in and working but has nothing to draw, so a new user does not think it is broken.
//
// Only a pane with no widgets at all gets one. A pane whose widgets are all switched off by their rules, or that has nothing to say right
// now, stays blank on purpose (a night pane is meant to be dark; black is see-through on a mirror). The message is dim, small, and fades
// away after a few minutes, so it can never burn into a screen that is left on.

export const NOTICE_MINUTES = 5;

/** The words to show for this pane, or '' when the pane is fine. Pure. */
export function emptyNotice(pane) {
  if (pane && Array.isArray(pane.widgets) && pane.widgets.length === 0) {
    return 'Connected. The pane “' + (pane.name || pane.id || '') + '” has nothing on it yet. Open Glass Panes in Home Assistant and add some widgets.';
  }
  return '';
}

let box = null, timer = null;

/** Show the notice for this pane (or remove the old one). Safe to call on every pane change. */
export function updateNotice(pane, doc = document) {
  clearTimeout(timer);
  if (box) { box.remove(); box = null; }
  const text = emptyNotice(pane);
  if (!text) return;
  box = doc.createElement('div');
  box.id = 'empty-notice';
  box.setAttribute('role', 'status');
  box.textContent = text;
  box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(70vw,640px);text-align:center;font:400 28px/1.4 system-ui,sans-serif;color:#8a8a8a;transition:opacity 4s;opacity:1;z-index:5;pointer-events:none';
  doc.body.appendChild(box);
  const mine = box;
  timer = setTimeout(() => { mine.style.opacity = '0'; setTimeout(() => mine.remove(), 4500); }, NOTICE_MINUTES * 60000);
}
