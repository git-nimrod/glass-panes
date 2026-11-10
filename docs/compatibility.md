# Which mirror app works with which integration version

The Home Assistant integration (installed through HACS) and the Android mirror app have **separate version numbers**. The app changes rarely, and you only need to update it when a feature you want needs a newer one.

Everything the **player page** shows (panes, widgets, themes, fonts, Now playing, sports, "show when" rules) comes from Home Assistant and needs **no** app update.

**Which app do I have?** Open `http://<mirror address>:8099/status` in a browser and read `"version"`. To update it, see [Update the app](mirror-app/update-app.md).

## App versions

| Mirror app version | What it adds | Needed for |
|---|---|---|
| 0.11.0 | **The mirror can play music.** An audio player in the app (`/audio/*`) that plays a web address through the mirror's own speaker; Glass Panes 0.11.0 shows it as a Home Assistant media player (Music Assistant can play to it). Also **a start that can't get stuck unnoticed.** A loading bar on the launch screen that names the step it is on and turns amber when one is slow. A diary of what the mirror did (`/log`) that survives a power cycle, so a stuck start can be read afterwards. A page load that never ends is stopped and retried; a start that has not finished after 15 minutes restarts the app (settings: `/recovery/tune`). An optional "still alive" message to Home Assistant. New `/status` blocks: `boot`, `recovery`, `alive_report`. See [mirror-app/api.md](mirror-app/api.md) | Recommended for everyone. The "fully booted" check needs Glass Panes 0.10.12 or newer; with an older one the page loading counts as booted |
| 0.10.7 | Steadier: the camera is reopened by itself if it fails or goes quiet (presence used to stop until a restart), an engine that keeps crashing is rebuilt with growing pauses instead of in a tight loop, and the mirror refuses to load any page but your Home Assistant one (the browser engine no longer gets security fixes on Android 6). New `/status` numbers: `presence.seconds_since_frame`, `presence.camera_restarts`, `engine_restarts`, `blocked_loads`. | Recommended for everyone using presence |
| 0.10.6 | Reloads a stuck or frozen page by itself, using the player's heartbeat (Glass Panes 0.10.9+). `seconds_since_heartbeat` in `/status`. | Stuck-page protection |
| 0.10.5 | Security update: web pages from other sites can no longer drive the mirror, `/video/start` only plays web addresses, a sturdier control server, keys with symbols work, debugging off in release builds. | Recommended for everyone |
| 0.10.3 (and the identical 0.10.4) | The first signed release. A launch screen with the boot animation. Memory numbers in `/status`. Presence settings and the reporting rate. The control-server calls listed in [mirror-app/api.md](mirror-app/api.md). Updates install over the top and keep your settings. | Everything in the integration so far |

## What each integration feature needs

| Integration feature | Minimum app | Notes |
|---|---|---|
| Panes, builder, uploads, sports, Now playing (card, vinyl, CD, burn-in saver), themes (including Cream Night), fonts, "show when" rules | any | Drawn by the player page. No app change. |
| Per-display login ("Set up login") | any | The app only needs the page address and the token. |
| Display settings and the memory readout (the mirror's status, presence on/off and rates, brightness) | 0.10.3 | Uses `/status`, `/presence/*` and `/brightness/*` on the control server. |
| The mirror's speaker as a media player (`media_player.glass_panes_<display>_speaker`), including playing to it from Music Assistant | 0.11.0 | Needs the display's mirror address set up. An audio guide is planned. |
| The Settings page's Speaker card (what is playing, volume, pause, resume, stop) | 0.11.0 | Uses `/audio` and `/audio/*` on the control server, like the speaker above. |
| Clock looks, clock and date time zones, the CD look and the CD case | any | Drawn by the page, so no app change is needed. |
| Presence reaching Home Assistant | any signed app with a webhook set | `--es webhook '<id>'`. See [mirror-app/adb-commands.md](mirror-app/adb-commands.md). |

## Which mirrors work

Glass Panes is built for the **Lululemon Studio mirror** ("Model One"). The board has a revision printed on a sticker (for example `MIR63A0-00-P1 RevP21`), and the mirror's original software has a version number. Both can change what works, so we keep a list of what people have tried. Please add yours: use the **Report your mirror** form on [GitHub Issues](https://github.com/git-nimrod/glass-panes/issues/new/choose).

**Check before you buy, not after.** There's a faster check than opening the case: a regulatory sticker near the power input lists an FCC ID. See [Which board do I have?](mirror-app/hardware.md#which-board-do-i-have) for what to look for.

| Board | Stock software | Android installed | App and player | Reported by |
|---|---|---|---|---|
| `MIR63A0-00-P1` RevP21 | 1.25.0 | Yes, with the project's ready-made images | Works: the player loads, and `/status` shows presence and memory numbers | The project (one unit) |
| `MIR63A0-00-P1` RevP21 | 1.27.0 | Replacement Android reported working by another owner | Not tested by the project | Another owner |
| `MIR63A0-00-P1` RevP18 | 1.14.2 | Reported to behave differently | Not tested by the project | Other owners |
| `MIR63A0-00-P1` RevP20 | 1.20.0 | **Yes**, with an image built by the owner of that unit from the RevP21 profile: it boots, `adb` authorizes, the launcher loads, the display and storage are correct, Wi-Fi connects, and the camera and speakers work. The microphone and camera picture quality were not measured, and the checking script's own automatic result still said "not compatible" even though those things worked. The project's ready-made images have **not** been tried on this board. | Not yet tested | Another owner, Nov 2026 |
| Newer NXP-based board (reported as i.MX8M Mini, some later-production units; back-sticker FCC ID `VPYLBEE5HY1MW` reported on at least one such unit, enclosure marked "Mirror v1.1") | | **Not supported by these images**, but a community project ([lemonademirror](https://github.com/ikiiftekhar2/lemonademirror)) has a full mainline Linux port for this exact board (`lululemon Mirror V1.1`) with display, speakers, mic, camera, WiFi and Bluetooth all working. No browser/kiosk layer has been proven on it yet — that's the piece Glass Panes would need. **We're looking for volunteers** with this hardware who want to try getting a web kiosk running on top of it — [open an issue](https://github.com/git-nimrod/glass-panes/issues/new/choose) if that's you | Not tested | Other owners |
| Any other board or software version | | | Unknown. Please tell us | |

**Before you flash**, compare `fastboot getvar partition-size:userdata` and `partition-size:system` with the values on the [hardware page](mirror-app/hardware.md#what-the-bootloader-reports). If yours differ, stop and open an issue.

## Other boards and write-ups

These are separate projects, not part of Glass Panes. We haven't verified their instructions, so follow their own pages and check your board and FCC ID first. We link them so people with the other kind of mirror have somewhere to start.

**Which one do I have?** Look at the regulatory sticker near where the power cable goes in. An FCC ID of **`2AOSD-RLSYM1R0`** is the Qualcomm board this project's images and app are tested on. A sticker that says **"Contains: FCC ID `VPYLBEE5HY1MW`"** is the newer NXP (i.MX8M Mini) board: the images here will **not** work on it.

**Newer NXP board (FCC ID `VPYLBEE5HY1MW`)**
- [Making Lululemonade](https://failedattempts.neocities.org/): a write-up of taking this board apart and getting it to run Linux, with [Part 1: Accessing JTAG](https://failedattempts.neocities.org/part1) and [Part 3a: Bypass SDP programming mode](https://failedattempts.neocities.org/part3a). Its author has said we may link it.
- [lemonademirror](https://github.com/ikiiftekhar2/lemonademirror): mainline Debian Linux on this board, with the display, speakers, microphone and camera working.
- People who followed the write-up reported: the way in is to join two pads (labelled PROG) with **any wire, not a resistor**, **before** power-on, and you can remove it once the board has started; in that mode `adb` does not show up at all, so check with `uuu -lsusb` instead. Treat this as a hint, and the write-up as the reference.
- Glass Panes doesn't run on this board yet. Work to support it is planned, and one owner has said they will publish what they pieced together. See the call for volunteers in the board table above, and the steps in the [roadmap](roadmap.md#3-support-for-the-other-fcc-id-mirror).

**Qualcomm board (FCC ID `2AOSD-RLSYM1R0`)**
- This project's two guides: [Part 1: install Android](mirror-app/install-android-lululemon-studio.md) and [Part 2: install the app](mirror-app/install-app-lululemon-studio.md).
- A long-running [XDA thread about the mirror](https://xdaforums.com/t/lululemon-mirror.4752046/) where much of the early work was shared.

If you find another useful write-up for either board, tell us in an issue and we'll add it here.
