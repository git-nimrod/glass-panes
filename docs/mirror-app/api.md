# Mirror app API: the control server and the presence webhook

The Mirror Kiosk app talks to the outside world in two ways:

1. A **control server** on the mirror (port 8099) that Home Assistant, a script or a browser can call.
2. A **presence webhook**: the app calls *Home Assistant* when someone is in front of the mirror.

For the Home Assistant side (services, the web API and the websocket API of the integration), see [../api.md](../api.md) and [../agents.md](../agents.md). Everything here uses plain HTTP on your home network. No pictures are sent; camera presence sends only numbers.

`esphome` (0.13.0+) is the `/esphome` document above.

---

## 0. The kiosk API contract (kiosk API 1)

The control server is a **contract**, not just "what the Android app happens to do". Any kiosk can drive a Glass Panes display: this Android app on the Qualcomm board, or a Linux kiosk on another board. If it speaks this contract, Home Assistant, the player and the builder treat it the same. The machine-readable copy is [`custom_components/glass_panes/schema/kiosk_api.json`](../../custom_components/glass_panes/schema/kiosk_api.json).

**Rules for every call:** port 8099, HTTP `GET`, JSON answers with `Content-Type: application/json` and `Access-Control-Allow-Origin: *`, the `?key=` rule and the `400` / `403` / `404` errors described in section 1. A call a kiosk does not have answers `404 {"ok":false,"error":"not found"}`.

**`/status` must have:** `ok` (true), `app`, `version`, `platform` (`android` or `linux`), `board` (1 to 40 lowercase letters, digits, `_` `.` `-`, for example `msm8916`; `unknown` if the kiosk can't tell), `kiosk_api` (`1`), `capabilities` (the names below that this kiosk has, required ones included), `page_ok` and `uptime_s`. Everything else in the `/status` section below is optional.

**Required** calls are on every kiosk. **Optional** ones are there only when the kiosk lists their name in `capabilities`; Home Assistant and the player check that list before using them (for example, with no `video` the player plays a video in the page itself, and with no `screen` there is no Screen switch). A kiosk too old to send `capabilities` (the Android app before 0.13.0) is taken to be the Android app of its version.

| Name | | Paths | What it is |
|---|---|---|---|
| `status` | Required | `/status` | Everything about the kiosk in one document |
| `reload` | Required | `/reload` | Load the player page again |
| `log` | Required | `/log` | The kiosk's diary, kept across power cycles |
| `pair` | Required | `/pair` | Set the kiosk up from the code on its screen |
| `brightness` | Required | `/brightness/<n>` | Backlight 0 to 100, or `default` |
| `screen` | Optional | `/screen`, `/screen/on`, `/screen/off` | Screen on or off while the network stays up |
| `presence` | Optional | `/presence`, `/presence/on`, `/presence/off`, `/presence/tune`, `/presence/size` | Camera presence, numbers only |
| `video` | Optional | `/video/start`, `/video/stop` | A looping video played natively above the page |
| `audio` | Optional | `/audio`, `/audio/play`, `/audio/pause`, `/audio/resume`, `/audio/stop`, `/audio/seek`, `/audio/volume` | The kiosk's own speaker |
| `recovery` | Optional | `/recovery`, `/recovery/tune` | Settings for getting unstuck and the still-alive message |
| `display_fix` | Optional | `/display/fix` | Board-specific display clean-up |
| `rotation` | Optional | `/rotation/<value>` | Turn the kiosk's own picture |
| `mic_test` | Optional | `/mic/test` | How loud the microphone hears, numbers only |
| `bluetooth_test` | Optional | `/bluetooth/test` | Whether a Bluetooth radio works, counts only |
| `engine` | Optional | `/engine`, `/engine/tune` | Memory switches for the kiosk's browser engine; they apply at the next start |
| `app_update` | Optional | `/update`, `/update/install` | The kiosk installs a newer version of itself that Home Assistant sends |
| `esphome` | Optional | `/esphome`, `/esphome/lock/on`, `/esphome/lock/off`, `/esphome/key/forget` | An ESPHome-style server on port 6053 for the Bluetooth proxy and voice (section 3) |
| `bluetooth_proxy` | Optional | `/esphome/bt/on`, `/esphome/bt/off` | Bluetooth proxy for Home Assistant, off by default |
| `voice` | Optional | `/esphome/voice/on`, `/esphome/voice/off`, `/voice/test` | The kiosk's mic and speaker as a Home Assistant voice assistant, off by default |
| `wake_word` | Optional | `/esphome/wake/on`, `/esphome/wake/off`, `/wake/selftest` | Listen for a wake word on the kiosk itself, off by default; needs voice |

The Android app (0.13.0 and later) lists all of them, except `app_update`, which it lists only when it can install by itself (the app built into mirror-android-3 or later). Paths, parameters and answers are in section 1; a kiosk on another board answers in the same shapes.

**Check a kiosk against the contract.** [`mirror-app/tools/check_kiosk_contract.py`](../../mirror-app/tools/check_kiosk_contract.py) needs only Python 3:

```
python mirror-app/tools/check_kiosk_contract.py http://<kiosk address>:8099 --key <key>
```

It reads `/status`, calls the read-only paths of every listed capability, checks that unlisted ones answer 404, and says in plain lines what passes and what doesn't. It changes nothing on the kiosk unless you add `--write` (then it also calls `/reload` and `/brightness/default`).

---

## 1. The control server

`http://<mirror address>:8099/<path>`

- Every call is an HTTP **GET**. Every answer is JSON with `Content-Type: application/json` and `Access-Control-Allow-Origin: *`, so a web page can call it.
- **Key.** If you set one (`--es key '<password>'`, see [adb-commands.md](adb-commands.md)), calls from **other devices** must add `?key=<password>` (or `&key=...`). Calls from the mirror itself never need it. A wrong or missing key gets `403 {"ok":false,"error":"bad key"}`.
- **No key is set by default.** Until you set one, anyone on your home network can change brightness, play video and switch presence. It never exposes camera pictures. Keep the mirror on a network you trust.
- Errors: `400` for a bad value (with a short reason), `403` for a bad key, `404 {"ok":false,"error":"not found"}` for an unknown path.

### Endpoints

| Path | Parameters | What it does | Success answer |
|---|---|---|---|
| `/` or `/status` | none | Everything about the app in one document (below) | the status JSON |
| `/reload` | none | Loads the player page again | `{"ok":true}` |
| `/pair` | `code`, and `url`, `token`, `key` (or `check=1` instead of those) | 0.12.0+. Sets the mirror up from the six-digit code on its screen. Works only while the mirror has no page address yet, or after `--es pair 1`; needs no key (the code is the credential: five wrong tries lock it for a minute and change the code, and a right code is used once). With `check=1` it only says whether the code is right. Home Assistant calls this for you from **Mirrors > Add mirror** (or **Pair with a code** on a mirror's card). | `{"ok":true}`, or 403 `wrong code`, 400 if the page address, token or key is not in the expected form |
| `/brightness/<n>` | `n` = `0` to `100`, or `default` | Backlight percent, or hand control back to Android. Remembered | `{"ok":true,"brightness":n}` (`-1` for default) |
| `/video/start` | `url=<video address>` (URL-encoded, `http` or `https` only from app 0.10.5) | Plays a looping video in Android's own player above the page | `{"ok":true}` |
| `/video/stop` | none | Stops the video | `{"ok":true}` |
| `/display/fix` | none | Runs the display clean-up again (turns off Qualcomm's adaptive backlight and post-processing, which stripe thin text) | `{"ok":true}` |
| `/presence` | none | Camera presence: the numbers and its settings (the same JSON the webhook sends) | the presence JSON |
| `/presence/on`, `/presence/off` | none | Switch camera presence on or off. Remembered | `{"ok":true,"presence":"on"}` or `"off"` |
| `/screen`, `/screen/on`, `/screen/off` | none | *(app 0.13.0)* Read, or switch the screen on or off. Off is Android's sleep: fully black on mirror-android-2 and later, while the network stays awake so you can switch it back on. On mirror-android-3 and later the built-in app switches this on by itself. On older images, off needs a one-time step from a computer: `adb shell dpm set-active-admin com.nimrod.mirrorkiosk/.ScreenAdmin` (to uninstall the app later, switch it off first in Settings > Security > Device administrators). *(Not yet run on a mirror.)* | `{"ok":true,"screen":"on"}` or `"off"`; `/screen` gives `{"ok":true,"screen":{"on":true,"off_ready":true}}`; off without the step: code 409 with the reason |
| `/presence/tune` | any of `scans`, `vscans`, `hold`, `thr`, `fps`, `report` | Presence settings, remembered (below) | `{"ok":true}` |
| `/presence/size` | `w=160` to `1920` | Camera picture width (default 320; bigger uses more CPU). Restarts the camera | `{"ok":true,"preview_w":w,...}` |
| `/rotation/<value>` | `auto`, `portrait`, `portrait_reverse`, `landscape`, `landscape_reverse` | Turns the app's own picture. Remembered. **Unproven**: it had no visible effect on a mirror whose Android rotation was already portrait, so use the `adb settings` commands instead | `{"ok":true,"orientation":"..."}` |
| `/log` | optional `boot=` (`previous`, `current`, a number, or `all`, the default) and `since=` (skip the first n lines) | The mirror's diary: what it did and when, kept in a file so it **survives a power cycle**. Each line has the boot number, the seconds into that boot (`t`), a kind and a short detail. Tokens and keys are never written. Newest 500 lines | `{"ok":true,"count":n,"events":[...]}` |
| `/audio` | none | The audio player (0.11.0+): `state` (`idle`, `buffering`, `playing`, `paused`, `error`), `volume` 0 to 100, `title`, `artist`, `position_s`, `duration_s` (-1 when not known), `error` | `{"state":"playing","volume":50,...}` |
| `/audio/play` | `url=` an `http://` or `https://` address, optional `title=`, `artist=`, `volume=0-100`, `start=` (seconds) | Plays that stream through the mirror's own speaker, replacing anything playing. Only web addresses: never files on the mirror. Write `&` and `?` inside the address as `%26` and `%3F` | `{"ok":true}` |
| `/audio/pause`, `/audio/resume`, `/audio/stop` | none | Pause, carry on, or stop and clear | `{"ok":true}` |
| `/audio/seek` | `s=` seconds from the start | Jump inside the track (kept inside its length) | `{"ok":true}` |
| `/audio/volume` | `v=0` to `100` | Speaker volume, remembered across restarts. It is the app's own level (a gentle curve), on top of the mirror's system volume | `{"ok":true,"volume":v}` |
| `/mic/test` | optional `seconds=` 1 to 10 (default 3) | Listens for a few seconds and reports **how loud it was**: `rms_db`, `peak_db` (0 = loudest the format goes, -60 = silent), `zero_share`, and a `verdict` in plain words. It answers one question: does this mirror have a working microphone? Nothing is recorded, saved, sent or written to the diary. Needs the microphone permission once: `adb shell pm grant com.nimrod.mirrorkiosk android.permission.RECORD_AUDIO` | `{"ok":true,"rms_db":-31.2,"peak_db":-12.4,...,"verdict":"..."}` |
| `/bluetooth/test` | optional `seconds=` 1 to 15 (default 5) | Finds out whether the mirror has a working Bluetooth radio. Turns Bluetooth on if it was off, listens for a few seconds and reports **counts only**: `advertisements`, `devices_heard`, `strongest_rssi`, `turned_on`, and a `verdict` in plain words. No addresses or names of nearby devices are kept, logged or sent, and Bluetooth is switched off again if the test turned it on. Needs the location permission once (Android 6 requires it for scan results): `adb shell pm grant com.nimrod.mirrorkiosk android.permission.ACCESS_COARSE_LOCATION`, and Android's Location setting switched on | `{"ok":true,"turned_on":true,"advertisements":42,...,"verdict":"..."}` |
| `/recovery` | none | The settings for getting unstuck and for the "still alive" messages (below) | the settings JSON |
| `/recovery/tune` | any of `load_timeout`, `restart_after`, `reload_hours`, `alive_report` | Change them, remembered. Out-of-range values are refused | `{"ok":true,"recovery":{...}}` |
| `/update` | none | *(app 0.13.0)* The self-updater: `can_install` (true only when the app is built into the mirror's Android image, mirror-android-3 and later), `state` (`idle`, `receiving`, `checking`, `installing`, `failed`), `detail` (the reason when it failed), `received_bytes`, `total_bytes`, `version_code`, `cert_sha256` (the installed app's signing certificate) | the update JSON |
| `/update/install` | **POST**, `sha256=` the file's SHA-256 (64 lower-case hex), the APK as the body with its `Content-Length` | *(app 0.13.0)* Home Assistant's **Mirror app** update sends a new version here. The mirror installs it only if the bytes match the SHA-256, it is this app, its version is newer, and it is signed with the same key as the installed app. Needs the control key (pairing sets one); refused from the mirror itself and from web pages. The app restarts as the new version about half a minute later, and the diary says `app_updated`. *(Not yet run on a mirror.)* | `{"ok":true,"state":"installing"}`, or 409 with the reason |
| `/esphome` | none | *(app 0.13.0)* The Bluetooth proxy, voice and wake word (section 3): the three switches, `encrypted` (Home Assistant has handed over its key), `voice_state` (`off`, `waiting_for_key`, `waiting_for_home_assistant`, `waiting_for_assist`, `ready`), `running` (port 6053 open), `name` (the mirror's name in Home Assistant's ESPHome integration), `ha_connected`, `link` (`none`, `plain`, `encrypted`), `mdns`, counts (`connections`, `refused`, `wrong_key`, `plaintext_refused`, `advertisements_sent`, `turns`), `mic_open`, `turn_active`, `last_turn`, `wake` (`model`, `phrase`, `listening`, `loaded`, `wakes`, `model_ms_per_s`), `java_heap_kb`, `native_heap_kb`, `error`. Never a key, a Bluetooth address or audio | `{"ok":true,"esphome":{...}}` |
| `/esphome/bt/on`, `/esphome/bt/off` | none | *(app 0.13.0)* The Bluetooth proxy switch. Remembered; off by default. Home Assistant's **Bluetooth proxy** switch calls it | `{"ok":true,"esphome":{...}}` |
| `/esphome/voice/on`, `/esphome/voice/off` | none | *(app 0.13.0)* The voice switch (**Voice** in Home Assistant). Remembered; off by default | `{"ok":true,"esphome":{...}}` |
| `/esphome/wake/on`, `/esphome/wake/off` | none | *(app 0.13.0)* The wake-word switch (**Wake word** in Home Assistant). Remembered; off by default. Does nothing while voice is off | `{"ok":true,"esphome":{...}}` |
| `/esphome/lock/on`, `/esphome/lock/off` | none | *(app 0.13.0)* On (the default): port 6053 takes connections only from the Home Assistant host of the paired page address. Switch it off if your Home Assistant reaches the mirror from another address | `{"ok":true,"esphome":{...}}` |
| `/esphome/key/forget` | none | *(app 0.13.0)* Forget the encryption key Home Assistant handed over. Use it only when the mirror moves to another Home Assistant, or its ESPHome entry was deleted there and re-added fails with "invalid encryption key": the next Home Assistant to connect hands over a new key | `{"ok":true,"esphome":{...}}` |
| `/voice/test` | optional `source=` `vr` (default), `vc` or `mic`, `aec=0` or `1` | *(app 0.13.0)* Starts one voice conversation now, as if the wake word had been heard. `source` picks Android's mic mode and `aec` its echo canceller (both remembered; which works best is still being tried on a mirror). Needs voice ready (`voice_state` `ready`) and the microphone permission | `{"ok":true}`, or 409 with the reason |
| `/wake/selftest` | none | *(app 0.13.0)* Checks the wake-word models without the mic: runs a built-in test sound through each and compares with the answers TensorFlow Lite gave on a PC (`match`, `max_difference`), and says how long it took (`ms_for_3s_audio`) | `{"ok":true,"models":[...]}` |
| `/engine` | none | *(app 0.13.0)* The browser engine's two memory switches: `gpu_process` (a separate drawing process, about 47 MB on the tested mirror) and `crash_helper` (Firefox's crash reporter process), and `restart_needed` when a saved change has not applied yet. Both are on (as Firefox has them) until you change them | `{"gpu_process":true,"crash_helper":true,"restart_needed":false}` |
| `/engine/tune` | `gpu_process=0` or `1`, `crash_helper=0` or `1`, optional `restart=1` | *(app 0.13.0)* Change them, remembered. They apply when the app next starts; `restart=1` restarts it now. An experiment for the memory budget: compare `/status` `memory` before and after. *(Not yet measured on a mirror.)* | `{"ok":true,"engine":{...}}` |

`/presence/tune` values (leave out any you do not want to change):

| Parameter | Meaning | Allowed |
|---|---|---|
| `scans` | Looks per minute at the camera | 1 to 240 (default 120) |
| `vscans` | Looks per minute **while a video plays** (the mirror is tightest on memory then) | 1 to 240 (default 12) |
| `hold` | Seconds to stay "present" after the last movement | 5 to 600 (default 30) |
| `thr` | How big a change in brightness counts as movement (lower is more sensitive) | 2 to 60 (default 10) |
| `fps` | Camera frame rate (`0` = slowest the camera offers) | 0 to 30 (default 0) |
| `report` | Seconds between "still here" reports to Home Assistant | 10 to 3600 (default 60) |

Example: `http://<mirror address>:8099/presence/tune?hold=60&scans=60`

`/recovery/tune` values (leave out any you do not want to change):

| Parameter | Meaning | Allowed |
|---|---|---|
| `load_timeout` | Seconds a page load may sit with no end (neither finished nor failed) before the browser is rebuilt and the load tried again, waiting 10 s, 30 s, 1 min, 2 min, then 5 min between tries | 30 to 600 (default 90) |
| `restart_after` | Minutes a start may take before the app restarts itself. At most once every 30 minutes. `0` = never | 0 to 240 (default 15) |
| `reload_hours` | Load the page again every this many hours. `0` = never | 0 to 168 (default 0) |
| `alive_report` | Seconds between "still alive" messages to Home Assistant (needs an alive webhook, see section 2). `0` = off | 0 to 3600 (default 60) |

The app cannot restart Android itself (there is no root on the mirror). A full power cycle needs a smart plug, controlled from Home Assistant.

**Loading bar.** While the launch screen is up, a bar under the boot animation fills as the steps finish: app started, control server, Wi-Fi, page loaded and, with Glass Panes 0.10.12 or newer, the selected pane showing. A step taking much longer than usual turns the bar amber and the line under it says which step. The same steps are in `/status` under `boot`.

### The `/status` document

```json
{
  "ok": true, "app": "mirror-kiosk", "version": "0.10.4",
  "page_ok": true, "seconds_since_page_load": 154,
  "brightness": 80, "orientation": "auto", "video": "stopped",
  "display_pp": "disabled", "display_pp_detail": "",
  "presence": { "present": false, "motion": 0, "state": "running", "last_report": "HTTP 200", "settings": { "...": "..." } },
  "memory": { "total_mb": 929, "available_mb": 303, "low_memory": false, "app_total_pss_mb": 280, "...": "..." },
  "uptime_s": 159
}
```

`boot` (0.11.0+) says how the start went: `boot_id` (counts every start of the app), `fully_booted` (the selected pane is showing; with an older player, the page has loaded), `seconds_to_ready`, `percent`, the step it is `waiting_for` and for how long, `stuck` (true when that step is taking longer than usual) and the seconds at which each step happened. `recovery` shows the settings above and `alive_report` the result of the last "still alive" message.

[../../mirror-app/README.md](../../mirror-app/README.md) explains every field (`/status` fields and `memory` fields). The ones to watch: `page_ok` (the player loaded), `presence.last_report` (`HTTP 200` is healthy; `no webhook set`, `HTTP 404` or `failed: ...` are not), and `memory.low_memory`.

---

## 2. The presence webhook (the mirror calls Home Assistant)

If you give the app a webhook id (`--es webhook '<id>'`), it **POSTs** to Home Assistant:

```
POST <Home Assistant address>/api/webhook/<webhook id>
Content-Type: application/json
```

The Home Assistant address comes from the player address the app was given (its scheme, host and port). The id is never built into the app and never shown; `/status` only says whether one is set.

**When it posts:** whenever `present` changes (at most once every 2 seconds), and as a heartbeat every `report` seconds (default 60) even when nothing changed. With no webhook set, nothing is sent and `last_report` says `no webhook set`.

**Body**, the same JSON as `GET /presence`:

```json
{
  "present": true,
  "distance_m": -1.0,
  "faces": 0,
  "motion": 0.18,
  "seconds_since_face": -1,
  "seconds_since_motion": 3,
  "state": "running",
  "cameras": 1,
  "hardware_faces": 0,
  "preview": "320x240",
  "fps": "15-15",
  "rotation": 0,
  "last_report": "HTTP 200",
  "settings": { "enabled": true, "scans_per_min": 120, "video_scans_per_min": 12, "hold_s": 30, "threshold": 10,
                "preview_w": 320, "preview_fps": 0, "report_interval_s": 60, "webhook_set": true }
}
```

| Field | Meaning |
|---|---|
| `present` | Someone is there (movement within the last `hold_s` seconds) |
| `motion` | The size of the latest change in light, about 0 to 1 |
| `seconds_since_motion` | Seconds since the last movement, `-1` if none yet |
| `state` | `off`, `starting`, `running`, `no camera`, `stalled` or `camera error <code>` (the camera went quiet or failed and is being reopened, app 0.10.7+) or `error: ...` |
| `seconds_since_frame` | Seconds since the camera last sent a picture (app 0.10.7+) |
| `camera_restarts` | Times the camera was reopened after an error or 30 s without pictures (app 0.10.7+) |
| `last_report` | The result of the previous report (`HTTP 200`, `HTTP 404`, `failed: ...`) |
| `settings` | The presence settings in force |
| `distance_m`, `faces`, `hardware_faces`, `seconds_since_face`, `rotation` | Kept so older automations keep working. Faces are no longer used, so these are always `-1`, `0` or `0` |

**No pictures.** Each look squashes the camera image into a grid of 16 by 12 brightness numbers, compares it with the last grid, and throws both away.

### The "still alive" message (0.11.0+)

Separately from presence, the app can tell Home Assistant it is running, so Home Assistant can tell "the mirror is gone" from "nobody is there", and keep the important lines of the diary even if the mirror later dies. Give the app its own webhook id (`--es alive_webhook '<id>'`, see [adb-commands.md](adb-commands.md)); with none set, nothing is sent. It is a different webhook from the presence one on purpose, so an automation reading presence never receives it.

```
POST <Home Assistant address>/api/webhook/<alive webhook id>
{"type":"alive","version":"0.11.0","boot_id":12,"fully_booted":true,"seconds_to_ready":41,"waiting_for":null,
 "stuck":false,"pane":"house","page_ok":true,"uptime_s":3600,
 "events":[{"boot":12,"t":41,"kind":"fully_booted","detail":"41 s after the app started"}]}
```

It goes out every `alive_report` seconds (default 60), and a few seconds after something important happens (start finished, load stalled, app restarted, pane changed). `events` carries only the important lines not yet sent. Numbers and short words only: no pictures, no addresses, no tokens.

### The Home Assistant side

Create an automation with a **Webhook** trigger, set to **local only**, and note its webhook id. Give that id to the mirror. Use `trigger.json.present` in the actions:

```yaml
automation:
  - alias: Mirror presence
    triggers:
      - trigger: webhook
        webhook_id: <your webhook id>
        local_only: true
        allowed_methods: [POST]
    actions:
      - if:
          - condition: template
            value_template: "{{ trigger.json.present }}"
        then:
          - action: input_boolean.turn_on
            target: { entity_id: input_boolean.mirror_someone_there }
        else:
          - action: input_boolean.turn_off
            target: { entity_id: input_boolean.mirror_someone_there }
```

**Test it without the mirror** (PowerShell; a `200` means the id is right):

```powershell
Invoke-WebRequest -UseBasicParsing -Method Post -Uri "<Home Assistant address>/api/webhook/<webhook id>" -Body '{"present":true}' -ContentType "application/json" | Select-Object StatusCode
```

**If the mirror's `last_report` says `HTTP 404`:** Home Assistant does not know that webhook id. Check that the id was copied exactly (no spaces) and the automation is switched on. Then send the id again with `adb` (see [adb-commands.md](adb-commands.md)).

---

## 3. Bluetooth proxy, voice and wake word (port 6053, app 0.13.0)

The mirror can be a **Bluetooth proxy** and a **voice assistant** for Home Assistant. It does that by speaking ESPHome's own protocol on
port 6053, so Home Assistant's built-in **ESPHome** integration adds it like any ESPHome device, and HA's Bluetooth and Assist features
use it from there. Everything is off until you switch it on. *(Built and tested against ESPHome's own client on a PC; not yet run on a mirror.)*

- **Switches.** Glass Panes gives each mirror three switches in Home Assistant: **Bluetooth proxy**, **Voice** and **Wake word**. All are
  off by default, and the mirror runs nothing for them while they are off: port 6053 is closed, Bluetooth is not scanning, the mic is
  closed and no model is loaded.
- **Adding it.** With Bluetooth proxy or Voice on, the mirror announces itself on the network (`_esphomelib._tcp`, named
  `glass-panes-xxxxxx`), and Home Assistant shows it under **Settings > Devices & services > Discovered**. Click **Add**. If it does not
  show up, use **Add integration > ESPHome** with the mirror's address and port 6053.
- **Encryption.** The mirror starts without a key and tells Home Assistant it can take one. On its first connection Home Assistant makes a
  random key itself and hands it over on an encrypted link (ESPHome's "zero-key handover"), then keeps it in the ESPHome entry. From then on
  the mirror accepts only encrypted connections with that key (Noise, as ESPHome devices use). Nobody types a key.
- **Voice needs the key.** Voice is offered to Home Assistant only on the encrypted connection, so mic audio never crosses the network
  unencrypted. Until the key is there, the Voice switch's `voice_state` says `waiting_for_key`.
- **What the mic does.** With Voice on and Wake word off, the mic opens only for a conversation that Home Assistant starts
  (`assist_satellite.start_conversation`, an announcement that asks a question) or `/voice/test`. With Wake word on, the mic stays open
  and the mirror itself listens for the wake word (microWakeWord models built into the app: "Okay Nabu", "Hey Jarvis", "Hey Mycroft";
  pick one in the ESPHome device's **Wake word** setting). Nothing leaves the mirror until the word is heard; then what you say goes to
  Home Assistant's Assist pipeline, and its spoken answer plays on the mirror's speaker. A small dot shows in the top-right corner while
  the mic listens for the wake word, and a **Listening…** sign at the top while what you say goes to Home Assistant.
- **Bluetooth proxy.** A passive scan: the mirror passes the advertisements it hears to Home Assistant (ESPHome's raw-advertisement
  format), for BLE sensors and presence. It does not connect to devices (Android 6 cannot offer that as a proxy). Bluetooth is switched
  on only while the proxy runs, and back off afterwards if the proxy switched it on.
- **Permissions.** Android needs the microphone permission (voice) and the location permission (Bluetooth scans) once, given from a
  computer: `adb shell pm grant com.nimrod.mirrorkiosk android.permission.RECORD_AUDIO` and
  `adb shell pm grant com.nimrod.mirrorkiosk android.permission.ACCESS_COARSE_LOCATION`, and Android's Location setting switched on
  for the scan (the app does not read your location). Without them the switches stay on but `/esphome` `error` says what is missing.

## Calling the control server from Home Assistant

Any normal Home Assistant mechanism works. For example, a `rest_command`:

```yaml
rest_command:
  mirror_brightness:
    url: "http://<mirror address>:8099/brightness/{{ level }}?key=<your key>"
    method: GET
```

Keep the key in `secrets.yaml`, not in a file you share.
