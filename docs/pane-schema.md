# Glass Panes: pane schema (version 1)

## The idea in one paragraph
A **pane** is a fixed **1080x1920 portrait canvas** holding positioned **widgets**.

A pane file is *layout only*: widget types, pixel positions, styling and options. It names **no entities**. The link between a Home Assistant entity and a widget lives in a separate **bindings** file, keyed by pane id and widget id.

That has two benefits:
- A pane can be shared, shipped as an example or exported without leaking anyone's house.
- A new user can drop panes in first and bind entities "at their own leisure".

## Files (all under `custom_components/glass_panes/`)
| File | What it is |
|---|---|
| `schema/pane.schema.json` | JSON Schema for a pane (canvas, style, every widget's options). |
| `schema/bindings.schema.json` | JSON Schema for the bindings file. |
| `schema/widgets.json` | Registry: each widget type and the entity **slots** it accepts (kind, allowed domains, required or not). |
| `panes/*.json` | The three shipped example panes: `mirror`, `house` and `video`. (Earlier versions also shipped `morning`, `night` and `off`. They were removed in 0.10.6, and you can make your own.) |


## Pane
```json
{
  "schema_version": 1,
  "id": "mirror",
  "name": "Mirror",
  "canvas": { "width": 1080, "height": 1920 },
  "background": "#000000",
  "brightness": 35,
  "widgets": []
}
```
- `id`: lowercase letters, digits, `_`. Must match the file name. It is what a display's `select` entity will list.
- `background`: `#000000` is see-through on a two-way mirror, so only widgets "float".
- `own_background`: only with a theme. `true` keeps the pane's own `background` (true black `#000000` when it has none) behind the theme's text colours instead of the theme's background. On a two-way mirror only pure black is see-through, so a theme's lit background, even a dark one, shows as a visible rectangle; this is how a themed pane stays black. In the builder it is the **Theme background** box beside Theme: a dark theme starts with it unticked (true black), and ticking it brings the theme's own background. A light theme (`cream`, `paper`) has dark text and needs its own light background, so it can't drop it. Absent or `false`: the theme's background, exactly as before. Agents set it with `save_pane`.
- `theme`: optional colour theme, one of `moss cream creamnight midnight paper slate`. A theme sets the pane's background and the named colours (see Themes below) in one go. When set, it replaces `background`, unless the pane also sets `own_background: true` (next item). Leave it out for the original look: a pane with no theme renders exactly as it did before themes existed.
- `brightness`: optional backlight percent to request while the pane shows (replaces the old per-mode brightness table).
- `burn_in_saver`: optional, `true` to let the whole pane drift a few pixels over about 40 minutes, so a screen that is on for hours never holds the same pixels. Too slow to notice. (Now playing has its own `burn_in_saver` option for just that widget.)
- `motion`: optional. `{"widgets": "fade"}` makes widgets that "show when" rules switch on and off fade in and out over about half a second instead of popping. Panes made from Glass Panes 0.10.10 on start with it; older panes stay as they were until you tick **Fade** in the builder. A display that asks for reduced motion never fades.
- Max 64 widgets per pane (a Lululemon Studio mirror has about 950 MB of RAM).

## Widget (common fields)
`id`, `type`, `x`, `y`, `w`, `h` are required. Everything is in canvas pixels. A widget must stay inside the canvas.
- `style`: `font`, `size` (px), `weight`, `color`, `opacity`, `align`, `italic`, `uppercase`, `letter_spacing` (px), `line_height`.
- `align` (`left`, `center`, `right`) works on every widget that holds text or a list. That includes sports rows, people, now playing and the light dots.
  - A list of rows (sports, people) moves as one block. A centered list keeps its columns lined up with each other instead of centering each row on its own.
  - `progress_ring` fills its box, so move or resize the box instead.
  - The `house` example centers its sports section and the section title above it.
- `color` is a token (`fg dim faint accent warn good bad`) or `#rrggbb`.
- `font` is one of the ten bundled open-licence fonts (`inter outfit jost space-grotesk jetbrains-mono`, and the formal set `cormorant-garamond playfair-display montserrat lora dm-serif-display`) or a system stack (`system-sans system-serif system-mono`). A font file only downloads when a pane uses it.
- `auto_height`: the widget's height follows its content instead of staying `h`. With nothing to show it takes no space.
- `flow`: `{ "after": <widget id or several>, "gap": <px>, "show_if": <widget id> }` places the widget below whatever it follows, wherever that ends up. A section that grows pushes the next one down instead of landing on it.
  - Empty things above are skipped over.
  - In the builder, dragging a widget that is placed below another keeps the link: up and down change `gap`, sideways changes `x`. The Unlink button (or choosing "Nothing") removes it.
  - A `divider` line only shows when something other than a divider is above it. A divider with `look: box` frames a group, so it is always shown (give it its own show-when rule to hide it).
  - `show_if` shows a widget (such as a section title) only while another widget has content.
  - `y` and `h` still hold the starting position for the builder.
- `show_when`: a rule that switches the widget on and off (see "Show when" below).
- `style_rules`: conditional formatting for a widget with an `entity` slot (entity value, progress ring, message, image). Up to 8 rules, checked in order; the first that holds changes the look, and the widget's own `style` applies when none does.
  - A rule is `{ "test", "value", "to", "attribute", "style" }`. `test` is `above`, `below`, `between` (both ends count, `to` is the high end), `is` or `is_not` (`value` is a state as text, or a list of texts).
  - `attribute` tests one attribute of the entity instead of its state. A state that is not a number never matches a number test, and nothing matches before the entity has loaded.
  - `style` may change only `color`, `size`, `weight`, `opacity` and `icon` (the icon of an `icon` widget, or the one beside an `entity_value`). The entity itself is bound as usual in the bindings file, so a rule never holds an entity id.
- A column's `style_rules` (on a `table`) work the same way, but look at each cell's own value, so one column can turn amber when a drive is long. Their `attribute` is ignored there.
- `when_hidden`: `collapse` (default) or `keep`. It sets what an off or empty widget does to the layout (below).
- Nothing is ever clipped or cut off with an ellipsis. Text wraps. If a fixed-size widget's content outgrows its box, the player's overflow check (below) reports it instead of hiding the extra.
- `options`: depends on `type` (below). Unknown options are rejected, so typos fail loudly.
- `z`, `name`: stacking order and a label for the builder.

## Themes
`theme` restyles a whole pane. The player puts the theme's colours on CSS variables on the pane's stage: `--gp-fg`, `--gp-dim`, `--gp-faint`, `--gp-accent`, and for the light themes `--gp-warn`, `--gp-good` and `--gp-bad`. Every widget that uses a named colour follows the theme. A colour written as `#rrggbb` stays exactly as written. The list lives in `player/themes.js`.

| Theme | Background | fg | dim | faint | accent | Look |
|---|---|---|---|---|---|---|
| (none) | `background` (default `#000000`) | `#f2f2f2` | `#8a8a8a` | `#5f5f5f` | `#6fb4ff` | The original look |
| `moss` | `#1f2a1c` | `#e6ecd8` | `#a3b08f` | `#7f8d6c` | `#b5c96a` | Deep olive green, soft sage text, lime-leaf accent |
| `cream` | `#f3efe0` | `#2b2a24` | `#625e50` | `#8a8678` | `#3f6b3a` | Warm cream paper, dark ink, forest-green accent (darker warn/good/bad) |
| `creamnight` | `#0d0b08` | `#efe8d2` | `#b9b093` | `#8c8570` | `#c9b36a` | The cream palette on a very dark warm background, for mirror glass (only dark is see-through) |
| `midnight` | `#0b1220` | `#e8edf7` | `#93a0b8` | `#66728a` | `#7aa8ff` | Near-black navy, cool white text, bright blue accent |
| `paper` | `#faf8f3` | `#141414` | `#55524b` | `#85817a` | `#8b1e1e` | Off-white newsprint, black ink, oxblood red accent (darker warn/good/bad) |
| `slate` | `#2b3138` | `#eceff2` | `#a0a9b3` | `#7b8590` | `#5fb3b3` | Blue-grey charcoal, light text, teal accent |

In the builder, while editing, the **Theme** menu above the preview switches the theme with an instant preview ("Original" removes it). The readability warning in the Text section checks against the theme's own background and colours. Big opaque pictures and videos are not recoloured.

## Show when (widgets that switch on and off)
Several widgets can share one area of the pane. Each carries a rule, and only the ones whose rule holds are shown. For example, the sports widget shows while a team plays today, and a photo fills the same spot when it does not.
```json
{ "id": "sports", "type": "sports", "x": 40, "y": 800, "w": 1000, "h": 300, "auto_height": true },
{ "id": "photo",  "type": "image",  "x": 40, "y": 800, "w": 1000, "h": 300,
  "options": { "media": "m_..." },
  "show_when": { "conditions": [ { "kind": "empty", "widget": "sports" } ] } }
```
With the sports option "Only on game day" on, `sports` has nothing to show on other days. It counts as "empty", so `photo` takes its place.

`show_when` is `{ "match": "all" | "any", "conditions": [ ... ] }`. `match` defaults to `all`, and you can have up to 8 conditions. The widget is shown while the rule holds. A widget with no `show_when` is always on. Condition kinds:

| `kind` | Fields | Holds when |
|---|---|---|
| `has_content` | `widget` | that widget is showing something (it is on and, if `auto_height`, not empty) |
| `empty` | `widget` | that widget is showing nothing. This is what makes a fallback: "show me when the other one is empty" |
| `entity` | `slot`, `test`, `value` | the entity bound to that slot meets the test. `test`: `is` / `is_not` (`value` is one text or a list, any of them; case does not matter), `above` / `below` (`value` is a number), `unavailable` (no value; holds when the state is `unavailable` or `unknown`, or the entity does not exist) |
| `time` | `from`, `to` (`"HH:MM"`) | the time is in the window, in the display's timezone. The start counts, the end does not. `from` later than `to` runs through midnight (`22:00` to `06:00` is the night). Equal times are refused |
| `days` | `days` (`mon` ... `sun`) | today is one of those days |

- **Entities never go in the pane.** An `entity` condition names a **slot**: `when_` plus a name, such as `when_door`. The entity id is kept in the bindings, next to the widget's other entities: `{ "<pane>": { "<widget id>": { "when_door": "binary_sensor.xyz" } } }`.
  - Exports, imports and shipped panes stay free of entity ids, and `set_pane_bindings` works as before.
  - A slot with no entity bound (or an entity not loaded yet) never holds, so the widget simply stays off. A shipped or imported pane behaves this way until someone binds it.
  - A `when_` slot takes exactly one entity id.
- **Conditions can look at other widgets**, so widgets can depend on each other. They cannot depend on each other in a circle. "A shows while B has content, B shows while A has content" is refused by the checks (builder and `save_pane`). So is naming a widget that is not in the pane, or the widget itself. A looping video (`video`) cannot take a rule, because the display app plays it by itself.
- **`flow.show_if: <id>` still works.** It is exactly a `has_content` condition on that widget, combined with `show_when` (both must allow it). The builder shows it as that condition and moves it into `show_when` the first time you edit the rule.
- **Day and time are separate conditions.** A window through midnight is judged on the clock alone. "Friday, 22:00 to 02:00" cannot be written as one condition, because Saturday 01:00 would fail the Friday test.

### When it is off or empty: close the gap, or keep the space
`when_hidden` is set per widget.
- `collapse` (the default): an off widget, or an `auto_height` widget with nothing to show, takes no space. Whatever `flow`s below it moves up.
- `keep`: the widget holds its box height `h`, so the widgets below stay where they are. If it is shown with more content than `h`, it takes the taller height.

Use `keep` where a jumping layout would bother you, for example a warning slot in the middle of a column.

### Preview only
The builder can force a widget on or off so you can see both layouts. Use the eye on its box, "Preview on/off" in the toolbar, or the inspector. This is never saved, and the pane does not know about it. The player takes `?force=sports:hide,photo:show` for the same purpose.

### How the player evaluates it
`player/conditions.js` is a pure module (no page, no Home Assistant). The unit tests run it in Node with a frozen clock.

The engine re-evaluates the rules:
- when a watched entity changes
- when a widget's size changes
- on the minute boundary, but only if some rule uses time or days (it lays out again only if a time rule actually flipped)

Nothing runs per frame.

## Widget types
| Type | Shows | Entity slots | Notable options |
|---|---|---|---|
| `clock` | Time | none | `style` (`digital` the default, `analog` a traditional round face, or `alarm` a bedside alarm clock), `face` (`light` or `dark`, for the two round looks), `timezone` (a name such as `America/Chicago`; empty = the display's own), `format` 12h/24h, `hide_meridiem`, `show_seconds` (digital: the seconds; round looks: a red second hand) |
| `date` | Date | none | `format`, `day_offset` (1 = tomorrow), `prefix`, `timezone` (as on the clock) |
| `text` | Fixed text | none | `text`, `fit` (`shrink` keeps one line and shrinks to fit) |
| `image` | An uploaded image, or the picture of an `image` or `camera` entity | `entity` (optional: an image or camera entity) | `media` (a picture from the media library; set by Upload in the builder), `fit`, `refresh_s` (how often an entity's picture is asked for again: default 10 s for a camera, 300 s for an image entity, which also updates the moment its state changes). `asset` (a plain file name) is the older way and still works. With an entity bound and no `media`, the entity's picture is shown, shrunk to the widget's size by Home Assistant first |
| `slideshow` | Photos from a Home Assistant media folder, one after another | none | `folder` (a folder inside a media folder, such as `photos/family` or `local/photos/family`), `interval_s` (5 to 86400, default 60), `shuffle` (default on: every photo once before any repeats), `fit` contain/cover, `fade` (crossfade, default on). Photos are shrunk to the widget's size by Home Assistant before the display gets them |
| `video` | Full-screen loop (played natively by the display app) | none | `media` (a video from the media library), or `sources` (older: file names, tried in order) |
| `divider` | A rule line (add one wherever you want a break; none are on `house` by default), or a rounded box that frames a group | none | `thickness`, `style` (`solid`, `dashed`, `dotted`, `double`, `fade`), `look` (`line` or `box`), `radius`, `fill`, `fill_opacity` |
| `icon` | A symbol from the bundled Material Design Icons library (7,400+ icons) | `entity` (optional: with no `icon` option it shows the entity's own icon, and style rules can swap it) | `icon` (a name such as `thermometer` or `door-open`, or `auto`) |
| `table` | Rows and columns: each bound entity is a row; each column shows its name, state, one attribute or fixed words | `rows` (several entities) | `columns` (up to 8: `header`, `source` = `name`/`state`/`attribute`/`text`, `attribute`, `text`, `format` = `auto`/`time`/`date`/`datetime`/`relative`/`duration`/`number`/`raw`, `decimals`, `unit`, `duration_unit`, `align`, `style_rules`), `show_header`, `max_rows` |
| `message` | A rotating line, or an entity's text | `entity` (optional) | `lines`, `rotate_minutes`, `prefix`, `suffix` |
| `entity_value` | Any entity's value, or one of its attributes | `entity` | `label`, `look` (`plain`, `tile` or `chip`: a rounded card with the icon in a tinted circle, or a small pill), `show_icon`, `radius`, `icon` (an icon before the value: a name, or `auto` for the entity's own), `unit`, `decimals`, `attribute` (show an attribute such as a thermostat's `temperature` instead of the state), `format` (`auto`, `relative`, `time`, `date`, `datetime`, `raw`: how dates and times read), `raw_state` (keep `on` instead of Home Assistant's word, like "Open") |
| `weather` | Temperature, condition, high/low | `weather` | `layout` line/stacked, `show`, `day_offset` (tomorrow shows its high, then "low N°") |
| `calendar_agenda` | Upcoming events | `calendars` | `max_items`, `skip` (leave out the first N, e.g. what a "next up" line already shows), `day_offset`, `days`, `time_style`, `hide_when_empty` |
| `todo_list` | Open to-do items | `list` | `max_items`, `bullets` |
| `now_playing` | What is playing | `players` | `show_art`, `style` (`card` the default, `vinyl` or `cd`; see docs/player.md), `cd_case` (cd look only, default on: the cover as a CD case with the disc sliding out of it), `paused_timeout_minutes`, `idle_text` (empty by default: nothing playing means nothing is drawn, so an `auto_height` widget takes no space) |
| `people` | Who is home | `people` | `avatar_size` |
| `lights_summary` | "N of M on" with a dot per light | `lights` | `show_dots` |
| `status_summary` | Calm "all good", or only what is wrong | `checks` | `ok_text`, `hide_when_ok`, `stale_days` |
| `progress_ring` | A percentage ring | `entity` | `warn_below`, `crit_below`, `warn_above`, `crit_above` |
| `sports` | Scores and next games | `teams` | `layout` line/rows/box, `max_games`, `show_next`, `game_day_only` (live games, tonight's game and a final only until midnight; never announces a later game), `show_logos`, `verbose_text`, `head_top` (rows layout: headline above the logos, for narrow columns) |
| `news` | Headlines | `feeds` | `max_stories`, `keywords`, `max_age_hours` |

`sports` expects Team Tracker style sensors. Team Tracker is a HACS integration that you install separately. `news` expects Home Assistant `event` entities from the Feedreader integration. Both are optional extras. A pane without those widgets needs neither. (This was checked against how the original page reads those attributes, not against the integrations' current docs.)

## Bindings
```json
{
  "schema_version": 1,
  "bindings": {
    "<pane id>": {
      "<widget id>": { "<slot name>": "<entity id>" }
    }
  }
}
```
A slot value is one entity id, a list of entity ids, or (for `status_summary` and `news`) a list of rules: `{ "entity", "name", "text", "bad", "ok", "below", "above", "filter" }`.

Slot names, kinds and usual domains come from `widgets.json`. The exception is slots named `when_...`. They hold the one entity of a "show when" condition (see above) and are not in the registry.

Nothing has to be bound. An unbound widget draws nothing (or its empty text), so every shipped pane renders with no bindings at all.

### Where bindings are kept
Bindings live in Home Assistant's own storage (`config/.storage/glass_panes.bindings`). They sit behind a login and never go in the folders that are served publicly.

There are two ways in or out over HTTP and services, plus the builder's own websocket commands (`glass_panes/bindings/get` and `glass_panes/bindings/set`). All are checked against the same rules (`custom_components/glass_panes/bindings.py`, which agrees with `schema/bindings.schema.json`):
- **Web:** `GET /api/glass_panes/bindings` returns the document to any logged-in user (so a display can run as a plain non-admin user). `PUT /api/glass_panes/bindings` replaces it and needs an administrator. A bad document is refused with a list of what is wrong and nothing is saved.
- **Services:** `glass_panes.get_bindings` returns the document. `glass_panes.set_bindings` with `bindings: { <pane id>: { <widget id>: { <slot>: ... } } }` replaces it. Only administrators can use it, the same rule Home Assistant's own admin services follow.
- Setting bindings replaces everything, so send the whole document.

## Icons
Icons are Material Design Icons (Pictogrammers, Apache 2.0; the licence text ships in `player/icons/LICENSE-mdi.txt`). A display never downloads the library: it asks Home Assistant for the icons its pane draws (`/glass_panes/icons?names=home,thermometer`) and gets back just those paths, a few hundred bytes each, so the mirror holds nothing it does not draw. Icon names are written without the `mdi:` prefix. Icons from other sets (such as `hue:`) are not included and show nothing.
