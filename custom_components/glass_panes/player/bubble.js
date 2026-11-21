// The manga-style speech and thought bubbles for the message widget (look: bubble / thought). Imported by the message widget only
// when a pane uses one of those looks, so the CSS never reaches a display that doesn't show a bubble.
const BUBBLE_CSS = `
.gp-bubble { box-sizing: border-box; position: relative; display: inline-block; max-width: calc(100% - .3em); margin-bottom: .6em; padding: .4em .85em;
  border-radius: 1.1em; background: var(--gp-bubble, #fff); color: var(--gp-bubble-ink, #151515); border: .11em solid var(--gp-bubble-ink, #151515);
  font-style: normal; text-align: left; overflow-wrap: break-word; }
.gp-bubble:empty { display: none; }
.gp-bubble.gp-say::after { content: ''; position: absolute; left: 1.3em; bottom: -.47em; width: .8em; height: .8em; background: inherit;
  border-right: inherit; border-bottom: inherit; transform: rotate(45deg) skew(12deg, 12deg); }
.gp-bubble.gp-say.gp-tail-right::after { left: auto; right: 1.3em; }
.gp-bubble.gp-say.gp-tail-none::after { display: none; }
.gp-bubble.gp-think { margin-bottom: 1.05em; border-radius: 1.6em; }
.gp-bubble.gp-think::before, .gp-bubble.gp-think::after { content: ''; position: absolute; border-radius: 50%; background: inherit; border: inherit; }
.gp-bubble.gp-think::before { left: 1.1em; bottom: -.62em; width: .55em; height: .55em; }
.gp-bubble.gp-think::after { left: .6em; bottom: -1em; width: .3em; height: .3em; }
.gp-bubble.gp-think.gp-tail-right::before { left: auto; right: 1.1em; }
.gp-bubble.gp-think.gp-tail-right::after { left: auto; right: .6em; }
.gp-bubble.gp-think.gp-tail-none::before, .gp-bubble.gp-think.gp-tail-none::after { display: none; }
`;

if (typeof document !== 'undefined' && !document.getElementById('gp-bubble-css')) {
  const st = document.createElement('style');
  st.id = 'gp-bubble-css';
  st.textContent = BUBBLE_CSS;
  (document.head || document.documentElement).appendChild(st);
}
