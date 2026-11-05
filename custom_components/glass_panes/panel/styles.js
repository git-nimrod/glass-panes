// How the builder looks. It takes its colours from the Home Assistant theme (so dark and light themes both work) and adds the shapes,
// spacing and motion. Everything is scoped to the panel, so nothing leaks into Home Assistant.

export const CSS = `
:host {
  /* Glass Panes brand greens (from the wordmark: forest #0e261d, mint #a3df90 to leaf #6bc370). The default look is cream paper with deep green;
     the dark look (:host(.dark)) is the brand itself. */
  --ui-bg: #f3f1e3;
  --ui-surface: #fbfaf0;
  --ui-sunken: #e8e9d6;
  --ui-line: rgba(20, 60, 35, .16);
  --ui-text: #15291f;
  --ui-muted: #58705e;
  --ui-accent: #2f7d44;
  --ui-accent-text: #246a38;
  --ui-edit: #a3df90;                                  /* mint outlines drawn over the dark preview */
  --ui-danger: #b5423a;
  --ui-good: #2f7d44;
  --ui-radius: 14px;
  --ui-shadow: 0 1px 2px rgba(20,50,30,.08), 0 10px 28px rgba(20,50,30,.13);
  display: block; height: 100vh; height: 100dvh; overflow: hidden;       /* Home Assistant gives a custom panel no height of its own, so size it from the window */ color: var(--ui-text); background: var(--ui-bg);
  font-family: 'Inter', var(--paper-font-body1_-_font-family, system-ui), sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased;
}
:host(.dark) {
  --ui-bg: #0e261d; --ui-surface: #14332a; --ui-sunken: #1b4034; --ui-line: rgba(163, 223, 144, .16);
  --ui-text: #e8f3e2; --ui-muted: #9fc19a; --ui-accent: #6bc370; --ui-accent-text: #a3df90;
  --ui-danger: #ff8a80; --ui-good: #6bc370;
  --ui-shadow: 0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.45);
}
:host(.dark) .btn.primary { background: linear-gradient(180deg, #a3df90, #6bc370); border-color: transparent; color: #0e261d; }
:host(.dark) .check input:checked::after { border-color: #0e261d; }
* { box-sizing: border-box; }
button, input, select, textarea { font: inherit; color: inherit; }
svg.i { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }

/* ---------- frame */
.app { display: grid; grid-template-rows: 56px 1fr; height: 100%; }
.top { display: flex; align-items: center; gap: 14px; padding: 0 18px; border-bottom: 1px solid var(--ui-line); background: color-mix(in srgb, var(--ui-surface) 88%, transparent); backdrop-filter: blur(10px); z-index: 4; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 16px; letter-spacing: -.01em; }
.logo-img { width: 30px; height: 30px; object-fit: contain; padding: 2px; border-radius: 9px; background: #f3f1e3; box-shadow: 0 0 0 1px rgba(20, 60, 35, .14); }
.logo { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(180deg, #a3df90, #6bc370); position: relative; }
.logo::after { content: ''; position: absolute; inset: 6px 8px; border: 2px solid rgba(14,38,29,.85); border-radius: 3px; }
.spacer { flex: 1; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 550; background: var(--ui-sunken); color: var(--ui-muted); }
.pill.warn { background: color-mix(in srgb, #f5a524 18%, transparent); color: #b7791f; }
.pill.on { background: color-mix(in srgb, var(--ui-accent) 18%, transparent); color: var(--ui-accent-text); }
.pill.good { background: color-mix(in srgb, var(--ui-good) 16%, transparent); color: var(--ui-good); }
.pill.bad { background: color-mix(in srgb, var(--ui-danger) 16%, transparent); color: var(--ui-danger); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 0; position: relative; }
.layout.has-inspector { grid-template-columns: 300px minmax(0, 1fr) 290px; }
.rail { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--ui-line); background: var(--ui-surface); }
.tabs { display: flex; gap: 4px; padding: 12px 12px 0; }
.tab { flex: 1; padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--ui-muted); font-weight: 600; cursor: pointer; }
.tab.on { background: var(--ui-sunken); color: var(--ui-text); }
.railbody { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }

/* ---------- buttons and fields */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 14px; border: 1px solid var(--ui-line); border-radius: 10px; background: var(--ui-surface); cursor: pointer; font-weight: 550; white-space: nowrap; transition: background .12s, transform .06s, box-shadow .12s; }
.btn:hover { background: var(--ui-sunken); }
.btn:active { transform: scale(.97); }
.btn.primary { background: var(--ui-accent); border-color: var(--ui-accent); color: #fff; }
.btn.primary:hover { filter: brightness(1.08); background: var(--ui-accent); }
.btn.ghost { border-color: transparent; background: transparent; }
.btn.ghost:hover { background: var(--ui-sunken); }
.btn.danger { color: var(--ui-danger); }
.btn.sm { padding: 5px 9px; font-size: 13px; border-radius: 8px; }
.btn.icon { padding: 8px; }
.btn:disabled { opacity: .4; pointer-events: none; }
.field, select.field, textarea.field { width: 100%; padding: 9px 11px; border: 1px solid var(--ui-line); border-radius: 10px; background: var(--ui-bg); outline: none; transition: border-color .12s, box-shadow .12s; }
.field:focus { border-color: var(--ui-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 22%, transparent); }
textarea.field { resize: vertical; min-height: 56px; }
label.lbl { display: block; margin: 12px 0 5px; font-size: 11.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--ui-muted); }
.card { background: var(--ui-surface); border: 1px solid var(--ui-line); border-radius: var(--ui-radius); padding: 12px; }
.row { display: flex; align-items: center; gap: 8px; }
.grow { flex: 1; min-width: 0; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { font-size: 12px; color: var(--ui-muted); }
.empty { padding: 18px 8px; text-align: center; color: var(--ui-muted); }
a { color: var(--ui-accent-text); text-decoration: none; font-size: 13px; font-weight: 550; }

/* ---------- pane list */
.pane { display: flex; gap: 12px; align-items: center; padding: 8px; border: 1px solid transparent; border-radius: 12px; cursor: pointer; transition: background .12s, border-color .12s; }
.pane:hover { background: var(--ui-sunken); }
.pane.on { background: color-mix(in srgb, var(--ui-accent) 10%, transparent); border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.thumb { width: 42px; height: 74px; border-radius: 6px; border: 1px solid var(--ui-line); overflow: hidden; flex: none; background: #000; }
.thumb svg { display: block; width: 100%; height: 100%; }
.pane .desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tag { font-size: 10.5px; font-weight: 650; padding: 1px 7px; border-radius: 999px; background: var(--ui-sunken); color: var(--ui-muted); }
.tag.mine { background: color-mix(in srgb, var(--ui-accent) 18%, transparent); color: var(--ui-accent-text); }
.newpane { margin-top: 4px; }

/* ---------- stage */
main { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
.stagebar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 14px 20px 6px; }
.stagebar .title { font-size: 20px; font-weight: 650; letter-spacing: -.015em; }
.stagebar .actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.details { margin: 4px 20px 0; display: none; }
#wrap { flex: 1; min-height: 0; display: flex; justify-content: center; align-items: center; padding: 14px 20px 14px; overflow: hidden;
  background-color: #f3f1e3; background-image: radial-gradient(rgba(20, 60, 35, .22) 1px, transparent 1px); background-size: 22px 22px; }   /* always cream, in the dark look too */
#device { position: relative; padding: 9px; border-radius: 26px; background: #16171a; box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset, 0 24px 60px rgba(0,0,0,.35), 0 4px 12px rgba(0,0,0,.25); }
#preview { position: relative; overflow: hidden; border-radius: 17px; background: #000; }
#overlay { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; transform-origin: top left; display: none; touch-action: none; }
.editing #overlay { display: block; background-image: radial-gradient(rgba(255,255,255,.28) calc(1.4px * var(--inv, 3)), transparent calc(1.4px * var(--inv, 3))); background-size: 40px 40px; background-position: 0 0; }

/* ---------- dock (the floating toolbar) */
#stage.gp-pane-drift { animation: none; }   /* the drift is for the display; in the builder it would pull the content away from the outlines */
details.more { margin-top: 14px; border-top: 1px solid var(--ui-line); padding-top: 4px; }
details.more > summary { cursor: pointer; list-style: revert; }
details.more .opt .hint { margin-top: 3px; }
.vidfull { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(135deg, rgba(120, 160, 255, .10) 0 40px, rgba(120, 160, 255, .04) 40px 80px); outline: 6px dashed rgba(120, 160, 255, .55); outline-offset: -6px; display: flex; align-items: flex-end; justify-content: center; }
.vidfull span { margin-bottom: 120px; padding: 18px 30px; border-radius: 40px; background: rgba(0, 0, 0, .7); color: #cfe0ff; font: 600 34px/1.2 system-ui, sans-serif; }
.dock { position: relative; align-self: center; margin: 0 auto 14px; display: flex; align-items: center; gap: 6px; padding: 7px; border-radius: 18px; background: color-mix(in srgb, var(--ui-surface) 90%, transparent); backdrop-filter: blur(14px); border: 1px solid var(--ui-line); box-shadow: var(--ui-shadow); z-index: 3; max-width: calc(100% - 24px); flex-wrap: wrap; justify-content: center; }
.dock .sep { width: 1px; height: 24px; background: var(--ui-line); margin: 0 4px; flex: none; }
.dock .btn { border-radius: 12px; }
.switch { display: inline-flex; align-items: center; gap: 8px; padding: 0 8px; cursor: pointer; font-weight: 550; user-select: none; white-space: nowrap; }
.switch input { appearance: none; width: 34px; height: 20px; border-radius: 999px; background: var(--ui-line); position: relative; margin: 0; cursor: pointer; transition: background .15s; flex: none; }
.switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.switch input:checked { background: var(--ui-accent); }
.switch input:checked::after { transform: translateX(14px); }
.menu { position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); display: none; padding: 8px; border-radius: 14px; background: var(--ui-surface); border: 1px solid var(--ui-line); box-shadow: var(--ui-shadow); grid-template-columns: repeat(5, 1fr); gap: 4px; }
.menu.open { display: grid; }
.menuwrap { position: relative; }

/* ---------- edit overlay */
.box { position: absolute; border: calc(2px * var(--inv, 3)) solid color-mix(in srgb, var(--ui-edit) 55%, transparent); border-radius: calc(6px * var(--inv, 3)); cursor: grab; transition: background .1s; touch-action: none; }
.box:hover { background: color-mix(in srgb, var(--ui-edit) 12%, transparent); }
.box.ghost { border-style: dashed; background: color-mix(in srgb, var(--ui-edit) 7%, transparent); }
.box.sel { border-color: var(--ui-edit); background: color-mix(in srgb, var(--ui-edit) 14%, transparent); box-shadow: 0 0 0 calc(4px * var(--inv, 3)) color-mix(in srgb, var(--ui-edit) 25%, transparent); z-index: 2; }
.box.dragging { cursor: grabbing; background: color-mix(in srgb, var(--ui-edit) 22%, transparent); z-index: 3; }
.box .tagname { position: absolute; left: 0; top: calc(-26px * var(--inv, 3)); max-width: 100%; padding: calc(2px * var(--inv, 3)) calc(8px * var(--inv, 3)); border-radius: calc(7px * var(--inv, 3)); background: var(--ui-edit); color: #1c2208; font: 600 calc(12px * var(--inv, 3))/1.5 system-ui, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; pointer-events: none; }
.box:hover .tagname, .box.sel .tagname { opacity: 1; }
.box .x { position: absolute; left: calc(-10px * var(--inv, 3)); top: calc(-10px * var(--inv, 3)); width: calc(20px * var(--inv, 3)); height: calc(20px * var(--inv, 3)); border-radius: 50%; border: 0; padding: 0; background: #3a3a3f; color: #fff; display: none; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
.box .x svg { width: 60%; height: 60%; stroke-width: 2.6; }
.box.sel .x, .jiggle .box .x { display: flex; }
.handle { position: absolute; width: calc(16px * var(--inv, 3)); height: calc(16px * var(--inv, 3)); background: #fff; border: calc(2px * var(--inv, 3)) solid var(--ui-edit); border-radius: 50%; display: none; z-index: 4; }
.box.sel .handle { display: block; }
.handle[data-h=nw] { left: calc(-9px * var(--inv, 3)); top: calc(-9px * var(--inv, 3)); cursor: nwse-resize; }
.handle[data-h=ne] { right: calc(-9px * var(--inv, 3)); top: calc(-9px * var(--inv, 3)); cursor: nesw-resize; }
.handle[data-h=sw] { left: calc(-9px * var(--inv, 3)); bottom: calc(-9px * var(--inv, 3)); cursor: nesw-resize; }
.handle[data-h=se] { right: calc(-9px * var(--inv, 3)); bottom: calc(-9px * var(--inv, 3)); cursor: nwse-resize; }
.jiggle .box:not(.sel):not(.dragging) { animation: wiggle .28s ease-in-out infinite alternate; }
.jiggle .box:nth-child(2n):not(.sel):not(.dragging) { animation-direction: alternate-reverse; animation-duration: .31s; }
@keyframes wiggle { from { transform: rotate(-.22deg); } to { transform: rotate(.22deg); } }
@media (prefers-reduced-motion: reduce) { .jiggle .box { animation: none !important; } }

/* ---------- safe zone, notices, warnings */
.safe { position: absolute; left: 40px; top: 40px; width: 1000px; height: 1840px; border: calc(2px * var(--inv, 3)) dashed rgba(255,255,255,.3); border-radius: calc(10px * var(--inv, 3)); pointer-events: none; }
.notice { position: absolute; left: 50%; bottom: 88px; transform: translateX(-50%); width: min(440px, calc(100% - 24px)); padding: 14px 16px; border-radius: 16px; background: var(--ui-surface); border: 1px solid color-mix(in srgb, #f5a524 55%, var(--ui-line)); box-shadow: var(--ui-shadow); z-index: 5; }
.notice b { display: block; margin-bottom: 4px; }
.notice .row { margin-top: 12px; }
.warnbox { margin-top: 10px; padding: 9px 11px; border-radius: 10px; font-size: 12.5px; line-height: 1.45; background: color-mix(in srgb, #f5a524 16%, transparent); color: var(--ui-text); }
.warnbox.poor { background: color-mix(in srgb, var(--ui-danger) 14%, transparent); }
.check { display: flex; align-items: center; gap: 9px; margin: 8px 0; cursor: pointer; user-select: none; }
.check input { appearance: none; width: 18px; height: 18px; border-radius: 6px; border: 1.5px solid var(--ui-line); background: var(--ui-bg); position: relative; margin: 0; cursor: pointer; flex: none; }
.check input:checked { background: var(--ui-accent); border-color: var(--ui-accent); }
.check input:checked::after { content: ''; position: absolute; left: 5px; top: 1.5px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }

/* ---------- mirror view: the display sits behind two-way glass, so black shows as reflection and the rest of the mirror is glass */
#glass { position: relative; }
.mirrorview #device { padding: var(--frame, 6px); border-radius: 0; background: linear-gradient(160deg, #3a3d36, #1b1c19 60%, #2b2d27); }
.mirrorview #glass { border-radius: 0; background:
  linear-gradient(118deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 22%, rgba(255,255,255,.05) 48%, rgba(255,255,255,0) 70%),
  linear-gradient(180deg, #2b3034 0%, #141719 55%, #1d2124 100%); box-shadow: inset 0 0 0 1px rgba(255,255,255,.10), inset 0 0 40px rgba(0,0,0,.5); }
.mirrorview #preview { background: transparent; border-radius: 0; outline: 2px dashed rgba(180, 196, 85, .75); outline-offset: 3px; }
.mirrorview #stage { mix-blend-mode: screen; }
.mirrorview .caption { display: block; }
/* a cream wall and a floor behind the mirror, and the stand it rests on (switched on and off with "Stand & wall") */
.room #wrap { background: linear-gradient(180deg, #f1e9d3 0%, #ebe1c6 76%, #d8c9a4 76%, #cdbd96 100%); }
.stand { display: none; position: absolute; left: 0; right: 0; top: calc(100% - var(--join, 8px)); height: calc(var(--stand-h, 60px) + var(--join, 8px)); border: var(--stand-t, 14px) solid #2b2d27; border-top: 0; border-radius: 0 0 var(--stand-r, 22px) var(--stand-r, 22px); box-sizing: border-box; z-index: 1; }
.stand::before { content: ''; position: absolute; left: calc(-1 * var(--stand-t, 14px)); right: calc(-1 * var(--stand-t, 14px)); top: 0; height: var(--join, 8px); background: #2b2d27; }
.room .stand { display: block; }
.room .caption { display: none; }
.caption { display: none; position: absolute; left: 50%; top: 100%; transform: translate(-50%, 8px); white-space: nowrap; font-size: 11.5px; font-weight: 600; letter-spacing: .02em; color: #58705e; }
.why { display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 92%; padding: calc(8px * var(--inv, 3)) calc(12px * var(--inv, 3)); border-radius: calc(8px * var(--inv, 3)); background: rgba(20,22,14,.86); color: #eef0dc; font: 500 calc(13px * var(--inv, 3))/1.4 system-ui, sans-serif; text-align: center; pointer-events: none; }
.box.ghost.bound .why { display: block; }

/* ---------- picture and video picker */
.media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
.mtile { position: relative; aspect-ratio: 1; border-radius: 10px; overflow: hidden; border: 2px solid transparent; cursor: pointer; background: var(--ui-sunken); }
.mtile.on { border-color: var(--ui-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 30%, transparent); }
.mtile img, .mtile video { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.mname { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 6px; font-size: 10px; background: rgba(0,0,0,.6); color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mdel { position: absolute; top: 3px; right: 3px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: rgba(0,0,0,.65); color: #fff; display: none; align-items: center; justify-content: center; padding: 0; cursor: pointer; }
.mdel svg { width: 12px; height: 12px; stroke-width: 2.6; }
.mtile:hover .mdel { display: flex; }
@media (hover: none) { .mdel { display: flex; } }

/* ---------- dialogs */
.modal { position: absolute; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 20; padding: 16px; }
.dialog { background: var(--ui-surface); border-radius: 18px; padding: 22px; width: min(540px, 100%); max-height: 92%; overflow: auto; box-shadow: var(--ui-shadow); }
.dialog h2 { margin: 0 0 6px; font-size: 19px; letter-spacing: -.01em; }
.dialog p { margin: 8px 0; line-height: 1.5; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
.steps { margin: 6px 0 0; padding-left: 20px; line-height: 1.55; }

/* ---------- inspector */
.inspector { display: none; flex-direction: column; min-height: 0; border-left: 1px solid var(--ui-line); background: var(--ui-surface); overflow: auto; padding: 14px; }
.has-inspector .inspector { display: flex; }
.inspector h3 { margin: 0 0 2px; font-size: 16px; letter-spacing: -.01em; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.swatch { width: 38px; height: 32px; padding: 2px; border: 1px solid var(--gp-line, #444); border-radius: 6px; background: none; cursor: pointer; flex: none; }
.swatch:disabled { opacity: .35; cursor: not-allowed; }
.seg { display: inline-grid; grid-auto-flow: column; gap: 2px; padding: 3px; border-radius: 10px; background: var(--ui-sunken); }
.seg button { border: 0; background: transparent; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-weight: 550; color: var(--ui-muted); }
.seg button.on { background: var(--ui-surface); color: var(--ui-text); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 6px 4px 10px; border-radius: 999px; background: var(--ui-sunken); font-size: 12.5px; }
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip button { border: 0; background: transparent; padding: 2px; cursor: pointer; display: inline-flex; color: var(--ui-muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
.hint { font-size: 12px; color: var(--ui-muted); line-height: 1.45; }
.mirrorbox { margin-top: 14px; padding-top: 6px; border-top: 1px solid var(--ui-line); }
.mirrorsettings > div { margin-top: 6px; }
.memtable { font-size: 13px; line-height: 1.7; }

/* ---------- add drawer */
.scrim { position: absolute; inset: 0; background: rgba(0,0,0,.28); opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 6; }
.scrim.open { opacity: 1; pointer-events: auto; }
.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(400px, 100%); display: flex; flex-direction: column; background: var(--ui-surface); border-left: 1px solid var(--ui-line); box-shadow: var(--ui-shadow); transform: translateX(104%); transition: transform .24s cubic-bezier(.2,.8,.2,1); z-index: 7; }
.drawer.open { transform: none; }
.drawer header { padding: 16px 16px 10px; display: flex; flex-direction: column; gap: 10px; }
.drawer h2 { margin: 0; font-size: 18px; letter-spacing: -.01em; display: flex; align-items: center; justify-content: space-between; }
.drawer .list { flex: 1; overflow: auto; padding: 4px 12px 20px; }
.group { margin: 14px 4px 6px; font-size: 11.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--ui-muted); }
.ent { padding: 9px 10px; border-radius: 12px; cursor: pointer; }
.ent:hover { background: var(--ui-sunken); }
.ent .add { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 8px 4px; }
.tile { padding: 14px 12px; border-radius: 14px; border: 1px solid var(--ui-line); background: var(--ui-bg); cursor: pointer; text-align: left; transition: transform .08s, border-color .12s; }
.tile:hover { border-color: var(--ui-accent); transform: translateY(-1px); }
.tile b { display: block; margin-bottom: 3px; }

#toast { position: absolute; left: 50%; bottom: 96px; transform: translate(-50%, 12px); max-width: 80%; padding: 10px 16px; border-radius: 12px; background: #1f2023; color: #fff; font-weight: 550; box-shadow: var(--ui-shadow); opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; z-index: 9; }
#toast.show { opacity: 1; transform: translate(-50%, 0); }
#toast.error { background: var(--ui-danger); }

/* ---------- narrow windows: the preview first, the lists below; the inspector and drawer cover the screen */
@media (max-width: 860px) {
  :host { overflow: auto; }
  .app { height: auto; min-height: 100%; grid-template-rows: 56px auto; }
  .top { position: sticky; top: 0; }
  .layout, .layout.has-inspector { grid-template-columns: 1fr; }
  main { order: -1; }
  .rail { border-right: 0; border-top: 1px solid var(--ui-line); }
  #wrap { flex: none; height: calc(100vh - 250px); min-height: 380px; padding: 8px 12px; }
  .stagebar { padding: 12px 14px 4px; }
  .stagebar .actions { margin-left: 0; }
  .inspector { position: fixed; left: 0; right: 0; bottom: 0; max-height: 42vh; border-left: 0; border-top: 1px solid var(--ui-line); border-radius: 18px 18px 0 0; box-shadow: var(--ui-shadow); z-index: 5; }
  .dock { margin: 0 auto 10px; }
  .has-inspector .dock { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(42vh + 10px); margin: 0; }
  #toast { position: fixed; }
  .drawer { position: fixed; width: 100%; }
  .scrim { position: fixed; }
}
`;
