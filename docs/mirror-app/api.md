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
| `/brightness/<n>` | `n` = `0` to `100`, or `default` | Backlight percent, or hand control back to Android. Remembered | `{"ok":true,"brightness":n}` (`-1` for default) |
| `/video/start` | `url=<video address>` (URL-encoded, `http` or `https` only from app 0.10.5) | Plays a looping video in Android's own player above the page | `{"ok":true}` |
| `/video/stop` | none | Stops the video | `{"ok":true}` |
| `/display/fix` | none | Runs the display clean-up again (turns off Qualcomm's adaptive backlight and post-processing, which stripe thin text) | `{"ok":true}` |
| `/presence` | none | Camera presence: the numbers and its settings (the same JSON the webhook sends) | the presence JSON |
| `/presence/on`, `/presence/off` | none | Switch camera presence on or off. Remembered | `{"ok":true,"presence":"on"}` or `"off"` |
| `/presence/tune` | any of `scans`, `vscans`, `hold`, `thr`, `fps`, `report` | Presence settings, remembered (below) | `{"ok":true}` |
| `/presence/size` | `w=160` to `1920` | Camera picture width (default 320; bigger uses more CPU). Restarts the camera | `{"ok":true,"preview_w":w,...}` |
| `/rotation/<value>` | `auto`, `portrait`, `portrait_reverse`, `landscape`, `landscape_reverse` | Turns the app's own picture. Remembered. **Unproven**: it had no visible effect on a mirror whose Android rotation was already portrait, so use the `adb settings` commands instead | `{"ok":true,"orientation":"..."}` |

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
| `state` | `off`, `starting`, `running`, `no camera` or `error: ...` |
| `last_report` | The result of the previous report (`HTTP 200`, `HTTP 404`, `failed: ...`) |
| `settings` | The presence settings in force |
| `distance_m`, `faces`, `hardware_faces`, `seconds_since_face`, `rotation` | Kept so older automations keep working. Faces are no longer used, so these are always `-1`, `0` or `0` |

**No pictures.** Each look squashes the camera image into a grid of 16 by 12 brightness numbers, compares it with the last grid, and throws both away.

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
