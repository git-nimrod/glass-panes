// Glass Panes player: draws one pane (a 1080x1920 canvas of positioned widgets) in any browser.
//
// Address options (all optional):
//   ?pane=house         which pane to show (default mirror)
//   ?follow=<entity>    follow an entity whose state is a pane id (the display's select) and switch panes with it
//   ?display=<id>       a display set up in Home Assistant: use its select entity, its timezone and its current pane
//   ?mock=1             invent data for every widget; no Home Assistant needed (for previews)
//   ?bindings=<url>     a bindings file (entities per widget); without one, widgets show their empty state
//   ?tz=America/Chicago timezone for times (default: this device's own zone)
//   ?ha=<origin>        Home Assistant address if the player is not served by Home Assistant itself
//   ?panes=<url/>       where pane files live (default ../panes/), ?assets=<url/> for images and video (default ../assets/)
//   ?kiosk=1            inside the Mirror Kiosk app: lets the page set backlight brightness and play video natively
//   #t=<token>          (address fragment, not a ?option) a kiosk app may hand over the token once this way; it is saved and removed
//   ?tokenkey=<name>    look for the saved access token under this name in this browser's own storage (default glass_panes_token).
//                       Lets a device that already has a token saved by an older page reuse it. Only the NAME goes in the address.
//   ?force=a:hide,b:show  preview only: switch those widgets off or on whatever their "show when" rules say
//   ?debug=1            show errors on screen
//
// Drawing is done by engine.js (shared with the sidebar builder); this file is the address options, the data client and the token.

import { PaneRenderer } from './engine.js';
import { HAClient, MockClient, mockBindings } from './data.js';
import { makeTime } from './util.js';

const q = new URLSearchParams(location.search);
// Served by Home Assistant (the normal case), the player only ever talks to that same Home Assistant: an `ha=` in the address is ignored,
// so a crafted link can never make it send its login somewhere else.
const SERVED_BY_HA = location.pathname.startsWith('/glass_panes/');
const cfg = {
  pane: q.get('pane') || 'mirror',
  follow: q.get('follow'),
  display: q.get('display'),
  mock: q.has('mock'),
  bindings: q.get('bindings'),
  kiosk: q.has('kiosk'),
  debug: q.has('debug'),
  ha: SERVED_BY_HA ? '' : (q.get('ha') || ''),
  paneBase: q.get('panes') || '../panes/',
  assetBase: q.get('assets') || '../assets/',
  schemaBase: '../schema/',
  appUrl: 'http://127.0.0.1:8099',
  // ?force=sports:hide,photo:show  pretend those widgets are switched off / on (overrides their "show when" rules; for looking at a layout)
  force: Object.fromEntries((q.get('force') || '').split(',').map((p) => p.split(':')).filter((p) => /^[a-z0-9_]+$/.test(p[0]) && (p[1] === 'show' || p[1] === 'hide'))),
};

// the name the token is saved under in this browser's storage; only a plain name is accepted, and never one of Home Assistant's own
// (its frontend keeps the user's full login under "hassTokens" in this same storage)
const requestedKey = q.get('tokenkey');
const plainKey = requestedKey && /^[A-Za-z0-9_.-]{1,64}$/.test(requestedKey) && !/^hass/i.test(requestedKey) ? requestedKey : 'glass_panes_token';
// a player NOT served by Home Assistant keeps a separate login per Home Assistant address, so a token is only ever sent where it was saved
let haOrigin = '';
try { haOrigin = cfg.ha ? new URL(cfg.ha).origin : ''; } catch (e) { haOrigin = 'invalid'; }
const TOKEN_KEY = haOrigin ? plainKey + '@' + haOrigin : plainKey;
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };

// A kiosk app can hand over the access token once, in the address fragment (#t=<token>). A fragment is never sent to any server.
// Save it, then take it out of the address so it is not left in the page history.
(function takeTokenFromFragment() {
  const m = /^#t=([^&]+)$/.exec(location.hash);
  if (!m) return;
  try { localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1])); } catch (e) { /* storage may be unavailable */ }
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
})();

let time = makeTime(q.get('tz') || undefined);   // replaced by the display's timezone when ?display= has one and ?tz= was not given
const stage = document.getElementById('stage');
const errBox = document.getElementById('errors');
let registry = {}, client = null, renderer = null, bindingsFile = null, current = null;

function logError(where, err) {
  console.error('[glass_panes]', where, err);
  if (!cfg.debug) return;
  errBox.style.display = 'block';
  errBox.textContent += where + ': ' + (err && err.message ? err.message : err) + '\n';
}

// ---------------------------------------------------------------- scaling
// The canvas is always 1080x1920; scale it to fit whatever window it is in (1:1 on the mirror itself).
function fit() {
  const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
}

// ---------------------------------------------------------------- overflow check (also window.glassPanesCheck())
window.glassPanesCheck = () => (renderer ? renderer.checkOverflow() : []);
if (cfg.debug) setInterval(() => {
  const bad = window.glassPanesCheck();
  if (bad.length) { errBox.style.display = 'block'; errBox.textContent = 'overflow: ' + bad.map((b) => b.widget + ' (' + b.content + ' in ' + b.box + ')').join(', '); }
}, 2000);

// ---------------------------------------------------------------- panes
async function loadPane(id) {
  if (client && !cfg.mock) {
    const saved = await client.pane(id);        // a pane saved from the builder, or the shipped one, from the integration
    if (saved) return saved;
  }
  const r = await fetch(cfg.paneBase + encodeURIComponent(id) + '.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('pane "' + id + '" not found (' + r.status + ')');
  return r.json();
}

async function showPane(id) {
  const pane = await loadPane(id);
  // pick up bindings changed since the last pane (not for ?bindings=<file> or mock mode, which stay as they were)
  if (!cfg.mock && !cfg.bindings && current !== null) bindingsFile = (await client.bindings()) || bindingsFile;
  current = pane.id;
  document.title = 'Glass Panes: ' + pane.name;
  const slotsFor = cfg.mock ? mockBindings(registry, pane)
    : ((bindingsFile && bindingsFile.bindings && bindingsFile.bindings[pane.id]) || {});
  renderer.time = time;
  renderer.show(pane, slotsFor);
  if (cfg.force) renderer.setForce(cfg.force);          // ?force=: look at both layouts of a pane with rules
  // a pane with no video should never sit under a video the app is still playing (an older page may have started one)
  if (cfg.kiosk && !(pane.widgets || []).some((w) => w.type === 'video')) fetch(cfg.appUrl + '/video/stop', { mode: 'no-cors' }).catch(() => {});
  if (cfg.kiosk && pane.brightness != null) {
    // only inside the kiosk app, which listens on the device itself; this is not sent anywhere else
    fetch(cfg.appUrl + '/brightness/' + pane.brightness, { mode: 'no-cors' }).catch(() => {});
  }
}

async function followEntity() {
  const apply = async () => {
    const s = await client.state(cfg.follow);
    const id = s && s.state ? String(s.state).toLowerCase() : '';
    if (id && id !== current) {
      try { await showPane(id); } catch (e) { logError('follow', e); }
    }
  };
  client.track([cfg.follow]);
  client.onChange((changed) => { if (changed === null || changed === cfg.follow) apply(); });
  await apply();
}

// ---------------------------------------------------------------- setup screen (developer data path)
function hideBoot() { const b = document.getElementById('boot'); if (b) b.style.display = 'none'; }

function showSetup(message) {
  hideBoot();
  const box = document.getElementById('setup');
  box.style.display = 'flex';
  document.getElementById('forwho').textContent = cfg.display ? 'for the display “' + cfg.display + '”' : '';
  document.getElementById('seterr').textContent = message || '';
  document.getElementById('save').onclick = () => {
    const v = document.getElementById('tok').value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* ignore */ }
    location.reload();
  };
}

async function main() {
  const bootStarted = Date.now();
  if (cfg.kiosk) document.getElementById('boot').style.display = 'flex';       // the mirror app shows the brand while the player starts
  fit();
  window.addEventListener('resize', fit);
  registry = (await (await fetch(cfg.schemaBase + 'widgets.json')).json()).widgets;
  if (cfg.mock) { client = new MockClient(time); window.glassPanesMock = client; }   // handle for testing
  else {
    if (!getToken()) { showSetup(); return; }
    client = new HAClient({
      base: cfg.ha, getToken,
      // only forget a token this player saved itself; a borrowed one (?tokenkey=) belongs to whatever saved it
      onAuthFail: () => { if (plainKey === 'glass_panes_token') { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } } showSetup('Token rejected. Paste a new one.'); },
    });
    if (cfg.bindings) bindingsFile = await (await fetch(cfg.bindings, { cache: 'no-store' })).json();
    else bindingsFile = await client.bindings();
  }
  renderer = new PaneRenderer({ stage, client, time, assetBase: cfg.assetBase, kiosk: cfg.kiosk, appUrl: cfg.appUrl, debug: cfg.debug, onError: logError });
  // tell the widgets watching an entity when it changes (null = reconnected, so refresh everything)
  client.onChange((id) => renderer.notify(id));
  client.connect();
  if (cfg.mock && cfg.bindings) bindingsFile = null;
  if (cfg.display && !cfg.mock) {
    const display = await client.display(cfg.display);
    if (display) {
      if (!q.has('pane')) cfg.pane = display.pane;
      if (!q.has('follow') && display.entity_id) cfg.follow = display.entity_id;
      if (!q.has('tz') && display.timezone) time = makeTime(display.timezone);
    } else logError('display', new Error('there is no display "' + cfg.display + '"'));
  }
  try { await showPane(cfg.pane); } catch (e) { logError('pane', e); }
  setTimeout(hideBoot, Math.max(0, 2500 - (Date.now() - bootStarted)));         // at least a moment of the animation, then the pane
  if (cfg.follow) await followEntity();
}

main().catch((e) => { hideBoot(); logError('start', e); });
