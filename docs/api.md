# Glass Panes: displays, panes, services and APIs

## The model
- A **pane** is a layout (see `docs/pane-schema.md`). Three are shipped as files (`mirror`, `house` and `video`). A pane **saved from the builder** is kept in Home Assistant's storage. A saved pane with the same id as a shipped one *replaces* it. Delete the saved one and the shipped one comes back.
- A **display** is a screen, normally your mirror: with an `id`, a `name`, an optional `timezone` for the times it shows, and the pane it is showing now.
- Each display also gets a **`button` entity per pane** (for dashboards, voice and scenes). Pressing it shows that pane on that display. Its visible name follows the pane's name, but its entity id is fixed when it is created (for example `button.glass_panes_mirror_movie_night`). Buttons for the built-in panes start **disabled**, so a fresh install does not add a screenful of entities. Enable them in the entity settings. Buttons for panes you create start enabled and are removed with the pane.
- Each display gets one **`select` entity** whose options are all the panes and whose state is the pane it is showing. Its device is called "Glass Panes <name>", so a display named "Mirror" is `select.glass_panes_mirror`. Choosing an option switches the display. The option is the pane's permanent id, so renaming a pane never breaks an automation. That means every native Home Assistant trigger already works for switching panes: a state change, a time, a presence sensor, a scene. Example automation action:
  ```yaml
  action: select.select_option
  target: { entity_id: select.glass_panes_mirror }
  data: { option: house }
  ```
- **Bindings** say which entity feeds which widget (see `docs/pane-schema.md`).

## Services
| Service | Who | What it does |
|---|---|---|
| `glass_panes.set_pane_bindings` | administrators | `pane`, `bindings` (widget id -> slot -> entity). Replaces the entities of that one pane and leaves every other pane's alone; an empty object clears it. Prefer this to `set_bindings`. |
| `glass_panes.get_schema` | anyone | Returns the pane schema, the widget catalogue, the canvas, grid and safe-zone numbers, and notes: what an agent needs to write a valid pane. The notes and `pane_schema` cover `show_when` rules and `when_hidden`, and a `show_when_example` shows a fallback pair (a widget that shows while another is empty). See `docs/agents.md`. |
| `glass_panes.list_media` | anyone | Returns the uploaded pictures and videos in the library (id, name, kind, size). Use an id as `options.media` on an image or video widget. Services cannot upload files; a person uploads them in the builder. |
| `glass_panes.start_draft` | administrators | Start building a pane in a private draft: `name`, or `copy_from` a pane, or `edit` a working copy of one. Returns the draft's id. Up to 10 drafts. See [agents.md](agents.md). |
| `glass_panes.add_widget`, `update_widget`, `place_widget`, `remove_widget`, `align_widgets`, `bind_widget`, `set_pane` | administrators | One checked step on a draft each: add a widget, change it, move or resize it, remove it, line widgets up, bind an entity to a slot, change the pane's name, theme, background or brightness. A step that would make an invalid pane is refused with the reasons and changes nothing. |
| `glass_panes.get_draft`, `glass_panes.list_drafts` | administrators | The whole draft (pane and bindings), or a list of drafts. |
| `glass_panes.finish_draft` | administrators | Save the draft as a **new** pane. A draft started with `edit` overwrites that pane only when you pass `replace: true`. The draft is removed. |
| `glass_panes.discard_draft` | administrators | Throw a draft away. |
| `glass_panes.list_panes` | anyone | Returns every pane (id, name, description, source, widget count). |
| `glass_panes.get_pane` | anyone | `pane`. Returns the pane, where it came from, and the entities bound to it. |
| `glass_panes.create_pane` | administrators | `name`, optional `description`, optional `copy_from`. Returns the new pane (blank or a copy); its id comes from the name. |
| `glass_panes.save_pane` | administrators | `pane` (a whole pane). Same checks as the builder. A pane that is not valid is refused with the reasons, and nothing is saved. |
| `glass_panes.delete_pane` | administrators | `pane`. Only a saved pane; refused while a display shows it. |
| `glass_panes.show_pane` | anyone | `display`, `pane`. Same as choosing the option on the select entity. |
| `glass_panes.get_mirror_status` | administrators | `display`. Returns the live status of the display's mirror app, as read by Home Assistant: `ok`, `page_ok`, `presence` (`present`, `state`, `last_report`, `settings`), `memory` (real measured megabytes: `total_mb`, `available_mb`, `threshold_mb`, `app_total_pss_mb`, `engine_pss_mb`, `low_memory`, `presence_enabled`, ...), `measured_at` and a plain-language `verdict` (`level` ok, tight, low or unknown, and `text`). It never returns the key or the mirror's address. If the mirror cannot be reached, the call fails with the reason. |
| `glass_panes.set_mirror_presence` | administrators | `display`, `enabled` (true/false). Turns camera presence on or off on that mirror. |
| `glass_panes.tune_mirror_presence` | administrators | `display` and any of `scans` (looks per minute, 1-240), `vscans` (looks per minute while a video plays, 1-240), `hold` (seconds to stay present, 5-600), `thr` (sensitivity threshold, 2-60, lower is more sensitive), `fps` (0-30, 0 = slowest), `report` (seconds between reports, 10-3600). These are the same ranges the app enforces. A value out of range is refused before anything is sent. |
| `glass_panes.set_mirror_brightness` | administrators | `display`, `brightness` (0-100). |
| `glass_panes.measure_presence_cost` | administrators | `display`, `confirm` (must be `true`). Reads the mirror's memory, turns presence OFF, waits about 20 seconds, reads again, then turns presence back ON (always, even if a step fails). Returns `before`, `after` (each with `measured_at`), `difference` (`app_total_mb`, `available_mb`, `text`) and `presence_restored`. If presence was already off nothing is touched. Presence is off for about half a minute, so only run it on purpose. |
| `glass_panes.save_display` | administrators | `name` (needed to create one), `id`, `timezone`, `pane`, `endpoint` (the mirror app's address as `host` or `host:port`, port 8099 if left out; empty removes it). The mirror **key cannot be set here** (see below). Creates a display (the id is made from the name if you give none) or changes the one with that id. Only the fields you give are changed. Returns the display. |
| `glass_panes.delete_display` | administrators | `display`. Removes the display, its select entity and its device. |
| `glass_panes.set_bindings` | administrators | `bindings`: pane id -> widget id -> slot -> entity id(s). Replaces all bindings. |
| `glass_panes.get_bindings` | anyone | Returns the bindings document. |

## Web API (a login is required for all of it)
Any logged-in user can read, so a display can run as a plain non-admin user.
- `GET /api/glass_panes/bindings`, `PUT /api/glass_panes/bindings` (administrators)
- `GET /api/glass_panes/panes/<pane id>`: one pane (a saved one wins over the shipped one)
- `GET /api/glass_panes/displays`, `GET /api/glass_panes/displays/<id>`: includes the `entity_id` that switches it

The player, the shipped panes and the schemas are also served **without** a login at `/glass_panes/player/`, `/glass_panes/panes/` and `/glass_panes/schema/`; those only ever hold layouts and code, never entities.

## Websocket API (used by the sidebar builder panel, `/glass-panes`, admins only)
Any logged-in user can read. Every command that changes something needs an administrator. A refused or invalid request gets an error with a plain-language reason, and nothing is changed.

| Command | Fields | Result |
|---|---|---|
| `glass_panes/panes/list` | | `panes`: id, name, description, `source` (`shipped` or `user`), `customized`, widget count |
| `glass_panes/panes/get` | `pane_id` | `pane`, `source` |
| `glass_panes/panes/save` (admin) | `pane` | the list. Checked against the schema and the extra rules (unique widget ids, on the canvas, flow references) |
| `glass_panes/panes/create` (admin) | `name`, optional `description`, optional `copy_from` | `pane` and the list. A blank pane or a copy of one; the id is made from the name (`Movie Night` -> `movie_night`, then `_2`, ...) and never changes |
| `glass_panes/panes/update` (admin) | `pane_id`, optional `name`, optional `description` | the list. Renames only the label: the id, so every automation that uses it, stays the same |
| `glass_panes/panes/delete` (admin) | `pane_id` | the list. Only a saved pane; refused while a display is showing it |
| `glass_panes/displays/list` | | `displays` |
| `glass_panes/displays/save` (admin) | `display` | `display` (same fields as the service) |
| `glass_panes/displays/delete` (admin) | `display_id` | `displays` |
| `glass_panes/displays/login/create` (admin) | `display_id` | `token` (shown once, never stored), `user`, `display`. Makes a dedicated ordinary (non-admin, home-network-only) user for the display with one long-lived token; replaces an existing login. Websocket only: there is deliberately no service for this |
| `glass_panes/displays/login/revoke` (admin) | `display_id` | `display`. Removes the display's user and so its token |
| `glass_panes/mirror/connect` (admin) | `display_id`, `endpoint`, optional `key`, optional `clear_key` | `display`. Saves the mirror app's address (`host`, `host:port`, `http://host:port`; nothing else: a login, path or query in it is refused; an empty address disconnects). `key` is **write-only**: it is stored and never returned by anything, only `key_set` (true/false). Giving a different address drops the saved key, so a key made for one device is never sent to another. |
| `glass_panes/mirror/status` (admin) | `display_id` | Same as the `get_mirror_status` service, plus `endpoint` and `key_set` (admin only). |
| `glass_panes/mirror/presence` (admin) | `display_id`, `enabled` | `{ok, presence}` |
| `glass_panes/mirror/tune` (admin) | `display_id`, any of `scans`, `vscans`, `hold`, `thr`, `fps`, `report` | `{ok, applied}` |
| `glass_panes/mirror/brightness` (admin) | `display_id`, `level` (0-100) | `{ok, brightness}` |
| `glass_panes/mirror/audio` (admin) | `display_id`, `action` (`status`, `pause`, `resume`, `stop` or `volume`), `level` (0-100, with `volume`) | `{ok, audio}` where `audio` is the speaker's state (`state`, `volume`, `title`, `artist`, `position_s`, `duration_s`, `error`) for `status`, and `null` for the others. Needs Mirror Kiosk app 0.11.0. |
| `glass_panes/mirror/measure` (admin) | `display_id`, `confirm` (true) | Same as the `measure_presence_cost` service. Takes about half a minute. |
| `glass_panes/media/list` | | `media`: every uploaded picture and video (id, name, kind, size, created) with an expiring signed `url` a display can load without a login |
| `glass_panes/media/add` (admin) | `file_id`, optional `name` | `media`, `all`. Takes a file the browser already sent to Home Assistant's `/api/file_upload` into the library. Checked by its contents (JPEG, PNG, GIF, WebP images up to 25 MB; MP4, MOV, WebM videos up to 100 MB); anything else is refused with the reason |
| `glass_panes/media/delete` (admin) | `media_id` | `all`. Refused while a saved pane uses the file |
| `glass_panes/bindings/get` | | the bindings document |
| `glass_panes/bindings/set` (admin) | `bindings` | the bindings document |
| `glass_panes/widgets/list` | | `widgets`: every widget type and the entity slots it takes (what the builder's palette and entity picker are made from) |

## Display settings: how Home Assistant talks to a mirror
A display can have the address (and optionally a key) of a Mirror Kiosk app's control server ([mirror app API](mirror-app/api.md)). Only Home Assistant calls it, never the browser. A page opened over https cannot call a plain http address, and the key must not reach the browser. The rules:
- **Mirror commands answer in two ways.** A request that cannot be done (no such display, no mirror set up, a value outside its range, a measurement not confirmed) is an error with a reason. A mirror that cannot be reached, or says no, is a normal websocket result with `ok: false` and a plain-language `error` (the services raise an error with the same text instead). Nothing raises into the websocket.
- **Fixed paths only**: `/status`, `/presence/on`, `/presence/off`, `/presence/tune`, `/brightness/<n>`, on the address you typed. Redirects are never followed (a mirror that answers with one is refused). Timeouts are 6 seconds, answers over 64 KB are ignored, and only the status fields documented above are passed on.
- **The key** is sent to the mirror as `?key=` (the only way the app takes it, plain http on the home network). It is stored in `config/.storage/glass_panes.displays`, written readable by the Home Assistant user only. It is never returned by a websocket command, service or web endpoint, never logged, and scrubbed from any text coming back from the mirror. It can only be set with `glass_panes/mirror/connect` (the builder), not through any service, so automations and agents never handle it. Deleting the display deletes it.
- The display endpoints and `displays/list` (readable by any logged-in user) show only `has_mirror` and `key_set`, not the address.
- **Memory numbers are measured**: they come from the mirror's `/status` at the time shown in `measured_at`. Nothing is estimated.

## Uploaded pictures and videos
Uploads go to Home Assistant's own `/api/file_upload` first (any logged-in user can reach it; 100 MB limit), then an administrator's `glass_panes/media/add` moves the file into `config/glass_panes/media/` and records it. Files are never served as plain static files. `GET /api/glass_panes/media/<id>` needs a login or a signed link (`authSig`). The link is made with Home Assistant's `async_sign_path` for its read-only content user, is valid for 7 days, and is regenerated each time the list is read. `GET /api/glass_panes/media` lists them with those links. A widget uses a file with `options.media: "<id>"` (image and video widgets).

## The player
`/glass_panes/player/index.html?display=<id>` follows a display: it looks the display up, uses its select entity, its timezone and its current pane, and switches panes live when the select changes. A pane saved from the builder is loaded from the API before the shipped file. See `docs/player.md` for every address option.

## After an update
- **Player files** (`player/`) are served straight from disk. A HACS update is enough; then refresh the page (Ctrl+F5 if it looks old).
- **Pane files** (`panes/`) are read from disk each time the integration sets up, and the player loads panes through the API. So after an update, **reload the integration** (Settings > Devices & services > Glass Panes > the three dots > Reload) to serve the new panes. Before version 0.4.1 they were read only once per Home Assistant run, so you needed a restart.
- **Python code** (anything in `custom_components/glass_panes/*.py`, `services.yaml`, `translations/`, `manifest.json`) needs a Home Assistant restart, as for any integration.
- Saved panes, displays and bindings are never touched by an update or a reload.

## Where things are stored
Home Assistant's own storage, in `config/.storage/`: `glass_panes.bindings`, `glass_panes.panes` (saved panes only), `glass_panes.displays`. A stored file that fails its checks when read back is ignored with a warning. It is never half-trusted.
