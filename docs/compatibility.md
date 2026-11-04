# Which mirror app works with which integration version

The Home Assistant integration (installed through HACS) and the Android mirror app have **separate version numbers**. The app changes rarely, and you only need to update it when a feature you want needs a newer one.

Everything the **player page** shows (panes, widgets, themes, fonts, Now playing, sports, "show when" rules) comes from Home Assistant and needs **no** app update.

**Which app do I have?** Open `http://<mirror address>:8099/status` in a browser and read `"version"`.

## App versions

| Mirror app version | What it adds | Needed for |
|---|---|---|
| 0.10.3 (and the identical 0.10.4) | The first signed release. A launch screen with the boot animation. Memory numbers in `/status`. Presence settings and the reporting rate. The control-server calls listed in [mirror-app/api.md](mirror-app/api.md). Updates install over the top and keep your settings. | Everything in the integration so far |

## What each integration feature needs

| Integration feature | Minimum app | Notes |
|---|---|---|
| Panes, builder, uploads, sports, Now playing (card, vinyl, CD, burn-in saver), themes (including Cream Night), fonts, "show when" rules | any | Drawn by the player page. No app change. |
| Per-display login ("Set up login") | any | The app only needs the page address and the token. |
| Display settings and the memory readout (the mirror's status, presence on/off and rates, brightness) | 0.10.3 | Uses `/status`, `/presence/*` and `/brightness/*` on the control server. |
| Presence reaching Home Assistant | any signed app with a webhook set | `--es webhook '<id>'`. See [mirror-app/adb-commands.md](mirror-app/adb-commands.md). |

## Which mirrors work

Glass Panes is built for the **Lululemon Studio mirror** ("Model One"). The board has a revision printed on a sticker (for example `MIR63A0-00-P1 RevP21`), and the mirror's original software has a version number. Both can change what works, so we keep a list of what people have tried. Please add yours: use the **Report your mirror** form on [GitHub Issues](https://github.com/git-nimrod/glass-panes/issues/new/choose).

| Board | Stock software | Android installed | App and player | Reported by |
|---|---|---|---|---|
| `MIR63A0-00-P1` RevP21 | 1.25.0 | Yes, with the project's ready-made images | Works: the player loads, and `/status` shows presence and memory numbers | The project (one unit) |
| `MIR63A0-00-P1` RevP21 | 1.27.0 | Replacement Android reported working by another owner | Not tested by the project | Another owner |
| `MIR63A0-00-P1` RevP18 | 1.14.2 | Reported to behave differently | Not tested by the project | Other owners |
| Any other board or software version | | | Unknown. Please tell us | |

**Before you flash**, compare `fastboot getvar partition-size:userdata` and `partition-size:system` with the values on the [hardware page](mirror-app/hardware.md#what-the-bootloader-reports). If yours differ, stop and open an issue.
