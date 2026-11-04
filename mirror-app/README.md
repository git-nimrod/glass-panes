# Mirror app (Android kiosk)

This folder is the **separate** half of the project: a small Android app that runs the Glass Panes player full screen on a physical smart mirror (the Lululemon-style hardware). It also does camera presence detection, which sends **numbers only, never pictures**.

The app is for the Lululemon Studio mirror. Any other screen with a browser (a tablet, a wall panel, a laptop) can open the player page without it. The Home Assistant integration (`custom_components/glass_panes/`) and this app are built and released separately.

**To put the app on a Lululemon Studio mirror, follow [`docs/mirror-app/install-app-lululemon-studio.md`](../docs/mirror-app/install-app-lululemon-studio.md).** It has every command, and says which steps carry risk and how to undo them.

| | |
|---|---|
| Package | `com.nimrod.mirrorkiosk` |
| Version | The app has its **own** version, separate from the Home Assistant integration's: `versionName` in `app/build.gradle.kts` (`0.10.4` at the time of writing), changed only when the app's code changes; `versionCode` = major x 10000 + minor x 100 + patch (`0.10.4` is `1004`) and must always go up. Releases are tagged `app-v<version>` ([CONTRIBUTING.md](../.github/CONTRIBUTING.md)) |
| Runs on | Android 6.0.1 (API 23), 64-bit ARM; the reference mirror is a Qualcomm MSM8916 with about 950 MB of RAM |
| Browser engine | GeckoView 143 (Firefox's engine), 64-bit ARM build, pulled by Gradle from Mozilla's Maven repository |
| What is in git | Source only. **APK files are attached to GitHub releases, never committed** |

## What the app does

- **Shows one page full screen** (the Glass Panes player for your display): black background, no browser bars, screen kept awake. It is the device's home screen, so Android starts it at boot and restarts it if it crashes.
- **Launch screen**: a black screen with the Glass Panes boot animation while the page loads. If the network or Home Assistant is not reachable, it shows a calm "Waiting for Wi-Fi or Home Assistant" line and retries automatically. The mirror never shows white or a browser error page. If no page address is set, it says "Not set up yet".
- **Control server on port 8099** (local network), so Home Assistant and the player can talk to it (below).
- **Native video**: Android's own player draws a looping video above the page (the browser engine cannot start a video decoder on this device).
- **Camera presence**: motion from changes in light, no faces. See `docs/mirror-app/install-app-lululemon-studio.md` ("What the camera does and does not do").
- **Display fix**: turns off Qualcomm's adaptive backlight and post-processing, which otherwise stripe thin text on a mostly black screen (`DisplayPostProc.kt`; the method is credited in that file).

## Control server

`http://<mirror address>:8099/`. Everything is a plain `GET` that answers JSON. If you set a key (`--es key`), calls from **other devices** need `?key=<key>`. Calls from the mirror itself (the player) never do.

| Address | What it does |
|---|---|
| `/status` | Everything below in one JSON document |
| `/reload` | Load the page again |
| `/rotation/<auto\|portrait\|portrait_reverse\|landscape\|landscape_reverse>` | Turn the picture (the panel is landscape-native). Remembered. `portrait` and `portrait_reverse` are the two ways up; if one comes out upside down use the other. `auto` leaves it to Android. Also settable with `adb ... --es rotation portrait`. **Unproven**: on a mirror whose Android rotation was already set to portrait it changed nothing (Android keeps the system rotation then). The supported way is the `adb settings` commands in the flashing guide. Full list of calls: [`docs/mirror-app/api.md`](../docs/mirror-app/api.md) |
| `/brightness/<0-100>`, `/brightness/default` | Backlight percentage, or hand control back to Android |
| `/video/start?url=<address>`, `/video/stop` | Play or stop the looping video |
| `/display/fix` | Run the display clean-up again |
| `/presence` | Presence numbers and its settings |
| `/presence/on`, `/presence/off` | Switch camera presence on or off (remembered) |
| `/presence/tune?scans=&vscans=&hold=&thr=&fps=&report=` | Presence settings (any can be left out; table in the install guide) |
| `/presence/size?w=<160-1920>` | Camera picture width |

### `/status` fields

These fields are unchanged: `ok`, `app`, `page_ok`, `seconds_since_page_load`, `brightness`, `video`, `display_pp`, `display_pp_detail`, `uptime_s`. New or changed fields:

| Field | Meaning |
|---|---|
| `version` | The installed app's own `versionName` (not the integration's version) |
| `presence` | `present`, `motion`, `state` (`off`, `starting`, `running`, `no camera`, `error: ...`), `cameras`, `preview` (picture size), `fps` (the frame-rate range the camera was given), `last_report` (result of the last message to Home Assistant) and `settings` (see below). `distance_m`, `faces`, `hardware_faces`, `seconds_since_face` and `rotation` are kept so older automations keep working; they are always `-1` / `0` now because faces are no longer used |
| `presence.settings` | `enabled`, `scans_per_min`, `video_scans_per_min`, `hold_s`, `threshold`, `preview_w`, `preview_fps` (`0` = slowest), `report_interval_s`, `webhook_set` (true or false; the id itself is never shown) |
| `memory` | **Real measurements taken on the device at the moment of the request** (nothing is estimated), below |

### `memory` fields (megabytes unless noted)

| Field | Meaning |
|---|---|
| `total_mb` | Total RAM Android can use |
| `available_mb` | RAM Android says is available to apps now |
| `low_memory` | `true` when Android considers the device low on memory |
| `threshold_mb` | The available-memory level below which `low_memory` becomes true |
| `free_mb`, `cached_mb` | `MemFree` and `Cached` from `/proc/meminfo` (`-1` if unreadable) |
| `app_pss_mb` | The app's own main process |
| `engine_pss_mb` | The browser engine's separate processes (content, GPU and so on), all started by this app |
| `app_total_pss_mb` | `app_pss_mb` plus `engine_pss_mb`: what the app really holds |
| `processes` | The list behind those two numbers: `[{"name": "...", "pss_mb": n}, ...]` |
| `presence_enabled` | Whether camera presence is on, so readings can be compared with and without it |

"PSS" is the memory a process really holds, with memory shared between processes divided among them, so adding the processes together does not count anything twice. The numbers move with whatever the page and video are doing. To learn what a given pane or video costs, read `/status` while it is on screen. **Checked on a real mirror (Nov 4 2026, a fresh install):** `/status` returned real numbers (929 MB total, 330 MB available, `low_memory` false), and `engine_pss_mb` (128 MB) covered the browser engine's separate processes (a content tab, the GPU process and the crash helper), so it does see the engine's processes on Android 6.0.1. Numbers from one unit and one pane, not a benchmark.

## Build it yourself

You need:

- **JDK 17 or newer** (21 was used to check this build).
- **Android SDK Platform 35** and the matching Build-Tools. The easiest way is to install Android Studio and open this folder (`mirror-app/`) as the project. It offers to download the pieces. Without Studio, install the command-line tools, run `sdkmanager --licenses`, install `platforms;android-35`, and point `ANDROID_HOME` at the SDK folder.
- Internet access the first time (Gradle downloads itself, the Android plugin, Kotlin 2.2.20 and GeckoView).

From this folder:

```bash
./gradlew assembleDebug        # macOS and Linux
gradlew.bat assembleDebug      # Windows
```

The result is `app/build/outputs/apk/debug/app-debug.apk` (about 90 MB, mostly the browser engine). The `D8` messages about "Kotlin metadata" are expected. GeckoView is built with a newer Kotlin than the toolchain reads, and `app/build.gradle.kts` tells the compiler to tolerate that.

**Signing.** A debug build is signed with a key Android Studio makes on your computer. Android only accepts an update if it is signed with the **same key** as the installed copy. So builds from two computers (or release builds from the project) cannot update each other. You would have to uninstall first, which erases the app's settings. If you build for yourself, keep using one computer, or share one key between them. Release APKs from the project are signed with the project's release key, which is never stored in git. You can check a release file against the certificate fingerprint in [the install guide](../docs/mirror-app/install-app-lululemon-studio.md#3-check-the-app-file-is-genuine). The test APKs that CI builds on every push use a throwaway key, so they cannot update a release build or each other. Do not commit a keystore (`.gitignore` blocks `*.keystore` and `*.jks`).

## Where things are

| File | What it holds |
|---|---|
| `app/src/main/java/com/nimrod/mirrorkiosk/MainActivity.kt` | The screen: browser, launch screen, native video, page loading and retries, brightness |
| `.../ControlService.kt` | The control server on port 8099 |
| `.../Presence.kt` | Camera presence (motion from light, settings, report to Home Assistant) |
| `.../Kiosk.kt` | Shared state, version string, memory measurements |
| `.../DisplayPostProc.kt` | The Qualcomm display clean-up |
| `app/src/main/res/drawable-nodpi/boot_00.png` .. `boot_20.png` | The launch-screen animation frames, made from `brand/boot-animation.gif` by `tools/make_boot_frames.py` on a black background |
| `app/src/main/res/values/strings.xml` | The launch-screen messages |

## No personal data in this folder

The source contains **no** addresses, webhook ids or tokens, and none are defaults. Everything personal is entered on the mirror (`adb ... --es url / token / key / webhook`, see the install guide) and kept in the app's private storage on the device. Before you commit a change here, search your diff for `192.168.`, `webhook`, `token` and your own addresses.

Licences: GeckoView is Mozilla's (MPL 2.0). The display clean-up approach comes from the community repurposing project credited in `DisplayPostProc.kt` (Apache-2.0). The rest follows this repository's licence.
