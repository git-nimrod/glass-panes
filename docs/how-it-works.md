# How Glass Panes works

A short tour of the pieces, so you know what's doing what when you press a button.

## The big picture

```
 builder (sidebar)  ──saves──▶  Home Assistant  ◀──reads──  player (a web page)
 you design panes             stores panes, entity            draws one pane,
 and bind entities            bindings and displays           live, on one display
                                    │
                         one `select` entity per display
                       (your automations choose the pane)
```

- **The builder** is a full-screen panel in your Home Assistant sidebar (administrators only). You design panes there.
- **Home Assistant** keeps everything: your panes, which entities feed which widgets, your displays, and the pictures and videos you uploaded.
- **The player** is a plain web page that draws one pane on a display. On a Lululemon Studio mirror, the Mirror Kiosk app opens it full screen. Any browser can open it too.

## Panes and widgets

A **pane** is a fixed 1080 x 1920 portrait canvas holding positioned **widgets**: a clock, a weather line, a calendar agenda, now playing, sports, lights, a video and so on. Positions are in plain pixels. The builder snaps to a 40 px grid. The outer 40 px is a safe zone, because a mirror's frame can hide the edge.

Widgets can size themselves to their content and flow below each other, so a section that grows pushes the next one down instead of overlapping it. A widget with nothing to show takes no space, or holds its place if you ask it to.

A **theme** restyles a whole pane at once. Black is see-through on a two-way mirror, which is why dark themes (like Cream Night) suit the glass.

## Panes carry no entities

A pane describes layout only. Which Home Assistant entity feeds a widget is stored separately as a **binding**. That's why you can export a pane and send it to a friend without sending anything about your house, and why the example panes work with nothing bound.

## Displays and switching panes

A **display** is a screen: normally your mirror. Each display gets one **`select` entity** whose options are your panes, plus a button per pane. Choosing an option switches what the display shows, so every normal Home Assistant trigger works: a time, a door, a presence sensor, a media player starting, a scene.

**Show when** rules switch individual widgets on and off (another widget is empty, an entity is in a state, a time of day, certain days).

## Signing a display in

A display signs in once with its own limited login, made with one button (**Set up login**). It is a separate ordinary Home Assistant user: not an administrator, and only allowed from your home network. The token is shown once and Glass Panes keeps it nowhere. Home Assistant can't restrict a user to certain entities, so the login can read what any ordinary user can.

## The mirror app

The Mirror Kiosk app runs on the Lululemon Studio mirror. It shows the player full screen, plays video with Android's own player, and offers a small control server on your home network (brightness, reload, presence on and off) that Home Assistant and the builder's **Display settings** talk to. Camera presence looks for changes in light and sends a few numbers to Home Assistant. It never stores or sends a picture.

## Agents

An AI agent can design a pane for you through Home Assistant's MCP Server, working in a private **draft**: one checked step at a time, never touching a live pane. When it finishes, the draft becomes a normal pane that you can edit by hand. See [Agents and automations](agents.md).

## Where your data lives

Everything stays in your Home Assistant, in its own storage (`config/.storage/glass_panes.*`) and a media folder for uploads. Nothing is sent to anyone. A normal Home Assistant backup includes it all.

## Updates

The integration and the mirror app have separate version numbers. Everything the player draws comes from Home Assistant, so most updates need no change on the mirror. [`compatibility.md`](compatibility.md) says when an app update is needed.

## How it's checked

Each release is checked before it goes out. See [How Glass Panes is tested](testing.md).
