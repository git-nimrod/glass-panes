# Mirror app API: the control server and the presence webhook

The Mirror Kiosk app talks to the outside world in two ways:

1. A **control server** on the mirror (port 8099) that Home Assistant, a script or a browser can call.
2. A **presence webhook**: the app calls *Home Assistant* when someone is in front of the mirror.

For the Home Assistant side (services, the web API and the websocket API of the integration), see [../api.md](../api.md) and [../agents.md](../agents.md). Everything here uses plain HTTP on your home network. No pictures are sent; camera presence sends only numbers.

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
| `/pair` | `code`, and `url`, `token`, `key` (or `check=1` instead of those) | 0.12.0+. Sets the mirror up from the six-digit code on its screen. Works only while the mirror has no page address yet, or after `--es pair 1`; needs no key (the code is the credential: five wrong tries lock it for a minute and change the code, and a right code is used once). With `check=1` it only says whether the code is right. Home Assistant calls this for you from **Pair a mirror**. | `{"ok":true}`, or 403 `wrong code`, 400 if the page address, token or key is not in the expected form |
| `/brightness/<n>` | `n` = `0` to `100`, or `default` | Backlight percent, or hand control back to Android. Remembered | `{"ok":true,"brightness":n}` (`-1` for default) |
| `/video/start` | `url=<video address>` (URL-encoded, `http` or `https` only from app 0.10.5) | Plays a looping video in Android's own player above the page | `{"ok":true}` |
| `/video/stop` | none | Stops the video | `{"ok":true}` |
| `/display/fix` | none | Runs the display clean-up again (turns off Qualcomm's adaptive backlight and post-processing, which stripe thin text) | `{"ok":true}` |
| `/presence` | none | Camera presence: the numbers and its settings (the same JSON the webhook sends) | the presence JSON |
| `/presence/on`, `/presence/off` | none | Switch camera presence on or off. Remembered | `{"ok":true,"presence":"on"}` or `"off"` |
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

## Calling the control server from Home Assistant

Any normal Home Assistant mechanism works. For example, a `rest_command`:

```yaml
rest_command:
  mirror_brightness:
    url: "http://<mirror address>:8099/brightness/{{ level }}?key=<your key>"
    method: GET
```

Keep the key in `secrets.yaml`, not in a file you share.
