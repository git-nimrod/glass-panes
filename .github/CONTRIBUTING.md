# Contributing

Thanks for helping out. Glass Panes is a public beta for the **Lululemon Studio mirror**, and the best help right now is real-world reports.

## The most useful things you can do

- **Report your mirror.** Use the **Report your mirror** form on [GitHub Issues](https://github.com/git-nimrod/glass-panes/issues/new/choose) to tell us your board revision, your stock software version and how far you got. It builds the list in [Which mirrors work](../docs/compatibility.md#which-mirrors-work).
- **Report bugs and ideas** with the bug and feature forms. They ask for the version numbers we need.
- **Try the agent tools** ([Agents and automations](../docs/agents.md)) and tell us what a good agent could do better.

## Ground rules

- **Never paste secrets** into an issue or a pull request: no access tokens, webhook addresses, passwords, mirror serial numbers or Wi-Fi details. Blur entity names you'd rather not share.
- **No personal data in changes.** No IP addresses, entity ids from a real house, names or photos. Shipped panes carry no entity ids.
- **Code an agent can call never handles a token.** The builder's "Set up login" button is the only place a token is made.
- **Check Home Assistant's own source before relying on an API**, and say so in your change if you're unsure.

## Pull requests

Small, focused pull requests are welcome. Please open an issue first for anything bigger, so we can agree on the approach. Maintainers run the full automated test suite before every release (see [How Glass Panes is tested](../docs/testing.md)), and may ask for changes based on it.

## Versions

The Home Assistant integration (`0.10.x`) and the Android mirror app have separate version numbers, because the app changes rarely. [`docs/compatibility.md`](../docs/compatibility.md) says which app version each feature needs.

## Where things are

| Path | What |
|---|---|
| `custom_components/glass_panes/` | The Home Assistant integration (this is what HACS installs) |
| `custom_components/glass_panes/panel/` | The sidebar builder |
| `custom_components/glass_panes/player/` | The page that draws a pane on a display |
| `mirror-app/` | The Android kiosk app for the mirror |
| `docs/` | Documentation |
