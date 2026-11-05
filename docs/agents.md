# Building panes with an agent (MCP and automations)

An AI agent can design a whole pane for you, widget by widget, and leave it ready for you to tweak by hand in the builder. There are two ways in, and both do the same thing with the same safety checks:

- **Home Assistant's MCP Server** offers Glass Panes as a ready-made set of tools to any MCP client (an AI app or a coding assistant). Assist can use the same tools. This is the friendlier route.
- **Services** (`glass_panes.add_widget` and friends) work from any automation, script or agent that can call Home Assistant services, such as the Home Assistant MCP Server add-on.

Every change needs an administrator, like the builder. Nothing an agent does touches a pane that a display is showing until you say so.

## How an agent builds a pane: drafts

An agent works in a **draft**. A draft is private. It isn't shown on any display and it isn't in your pane list. Every step is checked exactly like saving a pane, so a draft is always valid, and a step that would break it is refused with the reasons and changes nothing. When the agent is done, `finish_draft` saves it as an ordinary pane. You can open it in **Glass Panes** and edit it by hand, or show it on a display.

| Step | Tool or service | What it does |
|---|---|---|
| Learn the rules | `get_schema` | The widget types, their options and entity slots, the 1080 x 1920 canvas, the 40 px grid and the layout notes. Call this first. |
| Start | `start_draft` | Blank (give a `name`), a copy of a pane (`copy_from`), or a working copy of a pane you want to change (`edit`). Returns the draft's id. At most 10 drafts at a time. |
| Add | `add_widget` | A widget of a given `type`. It goes at `x` and `y`, or directly under another widget (`below`), or in the first free spot. Give `entities` to bind it in the same step. |
| Change | `update_widget` | Name, options, style, `auto_height`, `when_hidden` and the `show_when` rule. Options and style are merged over what's there, and `null` removes a key. |
| Move and resize | `place_widget` | `x`, `y`, `w`, `h`, or `below` another widget. Everything stays on the canvas. `snap` rounds to the 40 px grid. |
| Bind entities | `bind_widget` | Bind an entity (or a list) to one of a widget's slots, or clear it. Slot names and the right kind of entity come from `get_schema`. |
| Tidy | `align_widgets` | left, center, right, top, middle, bottom, same-width, same-height, and (three or more) distribute-h and distribute-v. |
| The pane itself | `set_pane` | Name, description, theme, background colour, brightness, `fade` (show-when widgets fade in and out; new drafts start with it on) and `burn_in_saver` (the whole pane drifts slowly). |
| Remove | `remove_widget` | Whatever flowed after it closes up, and its entities are forgotten. |
| Look | `get_draft`, `list_drafts` | The whole draft (every widget and its bindings), or all your drafts. |
| Finish | `finish_draft` | Saves a **new** pane (its id comes from the name). A draft started with `edit` can overwrite that pane, but only if you pass `replace: true`. |
| Give up | `discard_draft` | Throws the draft away. |

Entities are never part of the pane itself. They are kept apart in the bindings, so a pane can be shared or exported without leaking your house.

### Connect an agent through Home Assistant's MCP Server

1. In Home Assistant, go to **Settings > Devices & services > Add integration**, search for **Model Context Protocol Server** and add it. (If it is already there, you're set.)
2. In your MCP client, add a server with the address `http://<your Home Assistant address>:8123/api/mcp/glass_panes`. That address offers only the Glass Panes tools. The plain `/api/mcp` address offers every tool Home Assistant has.
3. The client needs a Home Assistant **long-lived access token** from an **administrator**. Make it yourself: click your name at the bottom of the sidebar, open **Security**, then **Long-lived access tokens**, then **Create token**. Paste it into your client. Never paste it anywhere public, and never into a chat.
4. Ask the agent to build something, for example: "Make me a pane called Morning with the clock, today's date, the weather and my family calendar, in a calm dark theme." Then open **Glass Panes** in the sidebar and look in **Panes**.

Tools are named `glass_panes_<step>` (for example `glass_panes_add_widget`). A request that comes with no known user, or from a non-administrator, is refused.

### A good routine

`get_schema`, then `list_panes` and `get_pane` to see an example, then `start_draft`, then a series of `add_widget` / `place_widget` / `bind_widget` steps, a `set_pane` for the theme, and `finish_draft`. Look up real entity ids first; if you don't know one, leave the widget unbound and the person can pick it in the builder.

## Other services

These work as before, and are handy for automations and for editing whole panes at once.

| Task | Service | Notes |
|---|---|---|
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
| What presence costs | `glass_panes.measure_presence_cost` | Needs `confirm: true`. Switches presence OFF for about 20 seconds on a real mirror, then back ON. Ask the person first. Returns measured before/after memory, never an estimate. |

Changing anything needs an administrator, like the builder. Panes never contain entity ids. Bindings are kept apart.

A pane can also set `theme` (`moss`, `cream`, `creamnight`, `midnight`, `paper`, `slate`) to restyle its colours and background at once. For a mirror, add `own_background: true` with a dark theme so the pane stays true black (see-through) behind the theme's colours. It is in the schema `get_schema` returns, and leaving it out keeps the original look. `style.font` accepts ten bundled families plus three system stacks (also in the schema).

If you already have a whole finished pane, `create_pane` or `save_pane` plus `set_pane_bindings` still work, and `show_pane` puts it on a display.

## Widgets that switch on and off (`show_when`)

Several widgets can share an area, with a rule deciding which one shows. Put a rule on a widget:
`"show_when": {"match": "all", "conditions": [...]}`. Condition kinds: `{"kind": "has_content", "widget": "<id>"}`, `{"kind": "empty", "widget": "<id>"}` (a fallback that takes the place of another widget), `{"kind": "entity", "slot": "when_door", "test": "is", "value": "on"}` (`is`, `is_not`, `above`, `below`, `unavailable`), `{"kind": "time", "from": "22:00", "to": "06:00"}` (display timezone; through midnight when `from` is later), `{"kind": "days", "days": ["sat", "sun"]}`. Add `"when_hidden": "keep"` to make an off or empty widget hold its space instead of letting the widgets below move up.

In a draft, set a rule with `update_widget` (`show_when`) and bind its `when_` slot with `bind_widget`. An entity condition names a slot, never an entity: outside a draft, bind it with `set_pane_bindings`, for example `{"door_warning": {"when_door": "binary_sensor.xyz"}}`. Until it is bound the widget stays off. `save_pane` refuses a rule, with the reason, if it names a widget that is not in the pane, waits on itself or in a circle (A needs B and B needs A), has a bad time or value, or is attached to a looping video. `get_schema` returns the full description (`pane_schema` has `show_when` and `condition`) and a short example. Details and examples: [pane-schema.md](pane-schema.md#show-when-widgets-that-switch-on-and-off).

## What is not built yet

- **A rendered preview** an agent can look at (a screenshot of the pane). Agents place widgets by the numbers in the pane, so they can't see
  where the player draws things that flow or size themselves. Not started.
- **Widget-level changes to a pane that isn't a draft.** Today an agent edits a draft and finishes it. That's deliberate, so a half-built pane is never live.

## Safety

A mirror's key (if you set one) is write-only: no service takes it and none returns it. You enter it in the builder's
"Connect a mirror" form, so an agent that controls a mirror never sees it. The mirror services fail with a plain reason if the mirror is
unreachable, so check `get_mirror_status` before relying on a setting.

The same rules apply as everywhere. Agents never need passwords or tokens, panes carry no entity ids, and the services that change things are
administrator-only. You can undo anything an agent saves by resetting the pane to its built-in version (for built-in panes) or deleting it.
