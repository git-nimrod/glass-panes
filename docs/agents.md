# Building panes with an agent (MCP and automations)

An AI agent can design a whole pane for you, widget by widget, and leave it ready for you to tweak by hand in the builder. There are two ways in, and both do the same thing with the same safety checks:

- **Home Assistant's MCP Server** offers Glass Panes as a ready-made set of tools to any MCP client (an AI app or a coding assistant). Assist can use the same tools. This is the friendlier route.
- **Services** (`glass_panes.add_widget` and friends) work from any automation, script or agent that can call Home Assistant services, such as the Home Assistant MCP Server add-on.

Every change needs an administrator, like the builder. Nothing an agent does touches a pane that a display is showing until you say so.

## How an agent builds a pane: drafts

An agent works in a **draft**. A draft is private. It isn't shown on any display and it isn't in your pane list. Every step is checked exactly like saving a pane, so a draft is always valid, and a step that would break it is refused with the reasons and changes nothing. When the agent is done, `finish_draft` saves it as an ordinary pane. You can open it in **Glass Panes** and edit it by hand, or show it on a display.

| Step | Tool or service | What it does |
|---|---|---|
| Learn the rules | `get_schema` | The widget types, their entity slots and option names, the pane's own fields, the 1080 x 1920 canvas, the 40 px grid and the layout notes. Call this first. Over MCP it is a short version (about a quarter of the size); the `glass_panes.get_schema` service still returns the full JSON Schema. |
| One widget in full | `get_widget` | Every option of one widget type, with allowed values and defaults, its entity slots and its named looks. |
| Find entities | `find_entities` | The person's entities, filtered by `domain`, `area`, `text` (words in the id, name or area) or `widget` (only entities made for that widget). Each says which widget slots it fits. Names and areas only, no states. Use it before binding: never invent an entity id. |
| Start | `start_draft` | Blank (give a `name`), a copy of a pane (`copy_from`), or a working copy of a pane you want to change (`edit`). Returns the draft's id. At most 10 drafts at a time. |
| Add | `add_widget` | A widget of a given `type`. It goes at `x` and `y`, or directly under another widget (`below`), or in the first free spot. Give `entities` to bind it in the same step. |
| Change | `update_widget` | Name, options, style, `auto_height`, `when_hidden`, the `show_when` rule and `style_rules` (conditional formatting). Options and style are merged over what's there, and `null` removes a key. |
| Move and resize | `place_widget` | `x`, `y`, `w`, `h`, or `below` another widget. Everything stays on the canvas. `snap` rounds to the 40 px grid. |
| Reuse | `add_group` | Drops a widget group the person saved in the builder (for example a table with its title) into the draft: new ids, the first free spot, and the group's entities bound. If the id is wrong, the error lists the saved groups. |
| Bind entities | `bind_widget` | Bind an entity (or a list) to one of a widget's slots, or clear it. Slot names and the right kind of entity come from `get_schema`. |
| Tidy | `align_widgets` | left, center, right, top, middle, bottom, same-width, same-height, and (three or more) distribute-h and distribute-v. |
| The pane itself | `set_pane` | Name, description, theme, background colour, brightness, `fade` (show-when widgets fade in and out; new drafts start with it on), `burn_in_saver` (the whole pane drifts slowly) and `photo_background` (`{folder, photo?, interval_s?, dim?}`: one photo or a slideshow behind the widgets; `{}` removes it). |
| Remove | `remove_widget` | Whatever flowed after it closes up, and its entities are forgotten. |
| Look | `get_draft`, `list_drafts` | The whole draft (every widget and its bindings), or all your drafts. |
| Finish | `finish_draft` | Saves a **new** pane (its id comes from the name). A draft started with `edit` can overwrite that pane, but only if you pass `replace: true`. |
| Give up | `discard_draft` | Throws the draft away. |
| Show it | `preview_draft` | Shows a draft on a display (`display`, `seconds` 10 to 600, default 120); the display goes back to its own pane by itself. Nothing is saved. **Ask the person first**: it takes over a screen in their home. |

Entities are never part of the pane itself. They are kept apart in the bindings, so a pane can be shared or exported without leaking your house.

### Connect an agent through Home Assistant's MCP Server

1. In Home Assistant, go to **Settings > Devices & services > Add integration**, search for **Model Context Protocol Server** and add it. (If it is already there, you're set.)
2. In your MCP client, add a server with the address `http://<your Home Assistant address>:8123/api/mcp/glass_panes`. That address offers only the Glass Panes tools. The plain `/api/mcp` address offers every tool Home Assistant has.
3. The client needs a Home Assistant **long-lived access token** from an **administrator**. A token can do everything its user can, so give the agent **its own administrator user** (for example "Pane agent"): then you can revoke its token on its own, and what it changes shows under its own name in the logbook. Make the user in **Settings > People > Users > Add user** (tick **Administrator**), sign in as it once, then click its name at the bottom of the sidebar, open **Security**, then **Long-lived access tokens**, then **Create token**. Paste it into your client. Never paste it anywhere public, and never into a chat.
4. Ask the agent to build something, for example: "Make me a pane called Morning with the clock, today's date, the weather and my family calendar, in a calm dark theme." Then open **Glass Panes** in the sidebar and look in **Panes**.

Tools are named `glass_panes_<step>` (for example `glass_panes_add_widget`). A request that comes with no known user, or from a non-administrator, is refused.

The Glass Panes tools **design** panes. **Running** displays (which pane a display shows, its screen, quiet hours, brightness) is done with Home Assistant's own entities for each display (a `select`, `switch`, `time` and `number`), which the plain `/api/mcp` address and Assist already offer. A mirror's app version is its `update` entity (**Mirror app**, `update.glass_panes_<display>_mirror_app`): `update.install` installs the newest release on mirror-android-3 and later. Only install when the person asks for it.

### A good routine

`get_schema`, then `find_entities` for what the person asked for, then `start_draft`, then a series of `add_widget` (with `entities` from `find_entities`) / `place_widget` steps, `get_widget` when you need a widget's options, a `set_pane` for the theme, `preview_draft` if the person wants to see it on the display, and `finish_draft`. If `find_entities` has nothing that fits, leave the widget unbound and the person can pick it in the builder.

## Other services

These work as before, and are handy for automations and for editing whole panes at once.

| Task | Service | Notes |
|---|---|---|
| Show photos from a media folder | `glass_panes.add_widget` with `type: slideshow` and `options.folder` | A folder inside a Home Assistant media folder. Photos are shrunk to the widget's size by Home Assistant, so full-size originals are fine. |
| Show headlines from a news site | `glass_panes.add_widget` with `type: rss` and `options.url` (the site's RSS or Atom address) | Home Assistant fetches it, never the display. Ask the person for the address; don't guess one. |
| Put a photo (or a slideshow) behind the whole pane | `glass_panes.set_pane` with `photo_background: {folder: photos/family, photo: lake.jpg, dim: 0.4}` | Leave out `photo` for a slideshow of the folder. Ask before using it on a mirror: a photo hides the mirror (only black is see-through). |
| Show an image or camera entity as a picture | `glass_panes.add_widget` with `type: image` and `entities: {entity: image.my_picture}` (an `image.*` or `camera.*` entity) | Optional `options.refresh_s`. |
| See the uploaded files | `glass_panes.list_media` | Pictures and videos in the library (id, name, kind, size). Use an id as `options.media` on an image or video widget. An agent cannot upload files through services; a person uploads them in the builder. |
| Learn the rules | `glass_panes.get_schema` | Returns the pane JSON Schema, the widget catalogue (each widget's entity slots and domains), the canvas size (1080 x 1920), the 40 px grid, the 40 px safe zone, and plain-language notes. Call this first. |
| See what exists | `glass_panes.list_panes`, `glass_panes.get_pane` | `get_pane` also returns the entities bound to the pane. |
| Make a pane | `glass_panes.create_pane` | Blank, or a copy of another pane. The id is made from the name and never changes. |
| Save a whole pane | `glass_panes.save_pane` | Refused, with the reasons, if anything is invalid (off the canvas, duplicate widget ids, bad flow references, bad or circular `show_when` rules, wrong option types). |
| Bind entities to one pane | `glass_panes.set_pane_bindings` | `pane` and `bindings` (widget id -> slot -> entity id or list; slot names come from `get_schema`). Changes only that pane. Every other pane's bindings stay exactly as they were. An empty object clears the pane's bindings. **Use this one.** |
| Replace every binding | `glass_panes.set_bindings`, `glass_panes.get_bindings` | `set_bindings` replaces the WHOLE document, so anything left out is deleted. Only for restoring a full backup. |
| Delete a pane | `glass_panes.delete_pane` | Refused while a display is showing it. |
| Show a pane | `glass_panes.show_pane`, or `select.select_option` on the display's select, or the pane's button | Same thing three ways. |
| Displays | `glass_panes.save_display`, `glass_panes.delete_display` | `save_display` can set a display's mirror `endpoint` (host and port). |
| Read a mirror's state | `glass_panes.get_mirror_status` | Page loaded, presence state, and the mirror's real measured memory with a plain verdict and the time it was measured. Needs the display to have a mirror endpoint. |
| Mirror settings | `glass_panes.set_mirror_presence`, `glass_panes.tune_mirror_presence`, `glass_panes.set_mirror_brightness` | Same ranges the mirror app enforces. Out-of-range values are refused before anything is sent. |
| Bluetooth proxy, voice, wake word | `switch.turn_on` / `switch.turn_off` on `switch.glass_panes_<display>_bluetooth_proxy`, `..._voice`, `..._wake_word` (mirror app 0.13.0) | All off by default. **Ask the person before switching Voice or Wake word on**: it opens the mirror's microphone. Wake word is refused while Voice is off. `glass_panes.get_mirror_status` returns the `esphome` block (`voice_state`, `encrypted`, counts; never a key, an address or audio). Adding the mirror to Home Assistant's ESPHome integration is a person's step (the Discovered card). |
| What presence costs | `glass_panes.measure_presence_cost` | Needs `confirm: true`. Switches presence OFF for about 20 seconds on a real mirror, then back ON. Ask the person first. Returns measured before/after memory, never an estimate. |

Changing anything needs an administrator, like the builder. Panes never contain entity ids. Bindings are kept apart.

A pane can also set `theme` (`moss`, `cream`, `creamnight`, `midnight`, `paper`, `slate`) to restyle its colours and background at once. For a mirror, add `own_background: true` with a dark theme so the pane stays true black (see-through) behind the theme's colours. It is in the schema `get_schema` returns, and leaving it out keeps the original look. `style.font` accepts ten bundled families plus three system stacks (also in the schema).

If you already have a whole finished pane, `create_pane` or `save_pane` plus `set_pane_bindings` still work, and `show_pane` puts it on a display.

## Widgets that switch on and off (`show_when`)

Several widgets can share an area, with a rule deciding which one shows. Put a rule on a widget:
`"show_when": {"match": "all", "conditions": [...]}`. Condition kinds: `{"kind": "has_content", "widget": "<id>"}`, `{"kind": "empty", "widget": "<id>"}` (a fallback that takes the place of another widget), `{"kind": "entity", "slot": "when_door", "test": "is", "value": "on"}` (`is`, `is_not`, `above`, `below`, `unavailable`), `{"kind": "time", "from": "22:00", "to": "06:00"}` (display timezone; through midnight when `from` is later), `{"kind": "days", "days": ["sat", "sun"]}`. Add `"when_hidden": "keep"` to make an off or empty widget hold its space instead of letting the widgets below move up.

In a draft, set a rule with `update_widget` (`show_when`) and bind its `when_` slot with `bind_widget`. An entity condition names a slot, never an entity: outside a draft, bind it with `set_pane_bindings`, for example `{"door_warning": {"when_door": "binary_sensor.xyz"}}`. Until it is bound the widget stays off. `save_pane` refuses a rule, with the reason, if it names a widget that is not in the pane, waits on itself or in a circle (A needs B and B needs A), has a bad time or value, or is attached to a looping video. `get_schema` returns the full description (`pane_schema` has `show_when` and `condition`) and a short example. Details and examples: [pane-schema.md](pane-schema.md#show-when-widgets-that-switch-on-and-off).

## Newer widgets and options an agent can use

`get_schema` lists all of these in its widget catalogue and notes; this is the short version.

- **Tiles and chips.** An `entity_value` with `options.look: tile` is a rounded card (the icon in a tinted circle, the name over the value); `look: chip` is a small pill with the icon and the value. Both use the entity's own icon unless `icon` names another (`show_icon: false` hides it), and a `style_rules` colour tints the icon while the words keep the theme's colours.
- **Icons.** (The mirror asks Home Assistant for only the icons a pane draws.) The `icon` widget, or `options.icon` on an `entity_value`, takes a Material Design Icons name without the `mdi:` prefix (`thermometer`, `door-open`), or `auto` for the bound entity's own icon.
- **Tables.** A `table` binds several entities to its `rows` slot (one row each). `options.columns` says what each column shows: `source` is `name`, `state`, `attribute` (with `attribute`) or `text` (with `text`), plus `header`, `format` (`auto`, `time`, `date`, `datetime`, `relative`, `duration`, `number`, `raw`), `decimals`, `unit`, `duration_unit`, `align`.
- **Conditional formatting.** `style_rules` on a widget with an `entity` slot, or on a table column: `[{"test": "above", "value": 30, "style": {"color": "bad"}}]`. Tests are `above`, `below`, `between` (with `to`), `is` and `is_not`. The style may change `color`, `size`, `weight`, `opacity` and `icon`. The first rule that holds wins.
- **Dividers.** `options.style` is `solid`, `dashed`, `dotted`, `double` or `fade`. `options.look: box` draws a rounded outline (`radius`, `fill`, `fill_opacity`) around a group of widgets.
- **Warnings.** A `status_summary`'s `checks` slot takes entity ids or rules `{entity, name, text, bad: [states]}`, `{ok: [states]}`, `{below: n}` or `{above: n}`. Add `from` and `to` (`HH:MM`, the display's time zone) to warn only in that part of the day: `{entity: "light.porch", bad: ["on"], from: "01:00", to: "04:00"}`. A `from` later than `to` runs through midnight.
- **Time zones.** A display's `timezone` can be left empty to follow Home Assistant's own.
- **Decorations.** `sparkles` needs no entity: little twinkles (`count`, `min_size`, `max_size`, `palette`) and optional bigger stars (`stars`, `star_palette`), a new scatter each day (`change: never` keeps one), `twinkle: true` for a slow fade. Its looks are Pastel twinkles, Starry, Gold and Frost. Give it a tall box beside the main content.
- **News rotation.** On `news`, `rotate_minutes` moves on to the next group of `max_stories` headlines every that many minutes; `same_size: true` draws every headline at the widget's size.
- **Weather radar.** `radar` shows the US colour radar composite with `source: us_composite` and a `region` (`conus`, `lot` for Chicago, or a 3-letter NWS office) and `layers` (`counties`, `roads`, `places`, `temps`, `warnings`); or any https radar picture with `source: url` and `url`; or a radar `camera.*` / `image.*` entity bound to its `entity` slot (an entity wins). The display loads web pictures itself. Framed for glass: `frame` (`rounded`, `square`, `circle`, `none`), `dim` (percent darker), `show_updated`, `label`, `refresh_s`. Looks: Rounded, Round window, Edge to edge. `get_schema`'s widget catalogue has no data source of its own: Environment Canada and Buienradar make radar cameras (switch the camera entity on first), and a Generic Camera can point at any radar picture address. The plain `image` widget still shows any image or camera entity.
- **Broadcast scorebugs.** `sports` with `options.layout: bug` draws TV-style scorebugs; `bug` picks one by id (`get_schema` lists them under `scorebugs`), or `auto` uses `bug_by_league` and then each league's default. `bug_tv` (`auto`/`clean`/`soft`/`vhs`) sets the old-TV picture; retro bugs default to soft. `bug_marks` (`both`/`league`/`ha`/`none`) puts the league's logo where the broadcast showed it and the Home Assistant logo where the network's mark was; `bug_logos` (`default`/`dark`) picks the team logo version. Live details (possession, down and distance, timeouts, bases and count, shots) come from Team Tracker.
- **Sports looks.** The `sports` widget's looks are Scorebug (`layout: rows`), Big score (`rows`, `head_top: true`, `style.size: 44`), Compact (`box`) and One line (`line`); they only set existing options. Its data comes from the Team Tracker integration (HACS).
- **ASCII art.** `ascii_art` draws text art: `show: art` with `art` from the built-in library (coffee, cat, mountains, rocket, sun, moon, plant, waves, heart, house) or `art: custom` with your own `text` (newlines for rows), `show: clock` (big `#` digits), or `show: weather` (bind a weather entity to the `weather` slot). `look` is `green`, `amber` or `plain`; `scanlines` and `cursor` add the old-screen feel. The characters size themselves to the box.
- **Anime-inspired looks** (our own drawings, no characters or names from any show): `petals` (falling cherry-blossom petals: `count`, `palette` sakura/plum/white/autumn, `motion` fall or still, `speed`), `sparkles` with `shape: kira` (thin glints), `message` with `look: bubble` or `thought` (and `tail`, `bubble_color`), and `weather` with `icon: chibi` (little drawn icons with faces). Each widget's `looks` in `get_schema` includes these.
- **Lily pond.** `art_pond` arranges cut-outs from Monet's *Water Lilies* (built in, public domain; the default `set: monet_lilies`) like a pond strip, anew each day: `clusters`, `per_cluster`, `accents`, `edge`, `size`, `depth`. With `set: own` it uses the person's own pictures instead: `options.pieces` is a list of `{media, role}` (a media id from `list_media`; role `base`, `accent` or `edge`). An agent cannot upload pictures; the person uploads them in the builder.
- **Vertical clocks.** A digital `clock` with `options.orientation: stacked` puts the hours over the minutes (seconds and AM/PM in a small row underneath); `sideways` turns the line so it reads top to bottom along a narrow strip. The widget's box sizes the digits, so make it tall and narrow (for example 240 x 420 stacked, 120 x 600 sideways). The clock's `looks` include Stacked and Sideways.
- **Moon phase.** `moon` draws tonight's moon (no entity needed; bind `slots.entity` to the Moon integration's sensor for its phase names, or to Lunar Phase's from HACS for illumination, next full and new moons and rise and set times). Looks: Real moon photo (NASA's hourly picture), Realistic, Moon and words, Line drawing, Glowing moon. It sits in the builder's Sky & stars group.
- **Planes overhead.** `flights` needs a flight-tracking integration from HACS: bind `slots.entities` to FlightRadar24's `sensor.flightradar24_current_in_area`, or to Flights Above's Flights overhead sensor and its Flight 1..n sensors. Looks: Nearest plane, Radar, Airport board.
- **Lookalike fonts.** `get_schema` lists them under `fonts` (id, name, group, what it looks like): free fonts with the feel of famous paid fonts and screen looks. Set `style.font` to the id.
- **Galactic.** `style.font: galactic` sets any text in an alien alphabet. The clock's Galactic look adds `options.plain_line: true` (a small line in ordinary digits underneath); the message widget's Galactic bubble look is a speech bubble in that font.

## What is not built yet

- **A rendered preview** an agent can look at (a screenshot of the pane). Agents place widgets by the numbers in the pane, so they can't see
  where the player draws things that flow or size themselves. Not started.
- **Widget-level changes to a pane that isn't a draft.** Today an agent edits a draft and finishes it. That's deliberate, so a half-built pane is never live.

## Safety

A mirror's key (if you set one) is write-only: no service takes it and none returns it. You enter it in the builder's
"Connect by address and key" form (or pairing sets it for you), so an agent that controls a mirror never sees it. The mirror services fail with a plain reason if the mirror is
unreachable, so check `get_mirror_status` before relying on a setting.

The same rules apply as everywhere. Agents never need passwords or tokens, panes carry no entity ids, and the services that change things are
administrator-only. You can undo anything an agent saves by resetting the pane to its built-in version (for built-in panes) or deleting it.
