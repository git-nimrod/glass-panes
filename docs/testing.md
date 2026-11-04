# How Glass Panes is tested

Glass Panes controls what a screen in your home shows and creates logins, so we check it hard before every release. Hundreds of automated checks run in four groups. We don't publish the test code, but this is what they cover.

## Inside a real Home Assistant

The integration runs inside a real Home Assistant core, not a simulation. The checks cover:

- **Who may do what.** Signing in is required, only administrators can change anything, and a display's login can read but never change.
- **Your data.** Panes, displays, bindings and uploads survive a reload and an update, and are kept when the integration is removed.
- **Entities.** Each display gets its `select` entity and pane buttons, switching works through every route, and everything cleans up after itself.
- **Refusing bad input.** An invalid pane, display, address or upload is refused with a plain reason, and nothing is changed.
- **Secrets.** A mirror's key and a display's token are never returned by anything, and never appear in logs.

## The pane rules

Panes are checked against a written schema plus layout rules: widgets stay on the canvas, ids are unique, flows never loop, and "show when" rules never wait on each other.

## The builder in a real browser

A real browser opens the builder the way Home Assistant does, then clicks through it: adding, moving, resizing and aligning widgets, uploading pictures, themes and fonts, the vinyl and CD looks, "show when" rules, the mirror settings and the Mirror view, on desktop, tablet and phone sizes. It also checks that nothing logs an error.

## Agents

Everything an agent can do is held to the same rules as the builder: every step is checked, a refused step changes nothing, drafts stay private until finished, and only administrators can use the tools.

## On every change

Home Assistant's own validators (hassfest) and HACS's validation run on every push to this repository, and the app is built and signed by CI.

If you find something we missed, please tell us on [GitHub Issues](https://github.com/git-nimrod/glass-panes/issues/new/choose).
