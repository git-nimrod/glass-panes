# Glass Panes: player

The player is a static web page that draws one pane on a 1080x1920 canvas. It scales the canvas to fit whatever window it is in (1:1 on a 1080x1920 display). It lives in `custom_components/glass_panes/player/`. There is no build step and there are no dependencies, just plain ES modules.

## Served by Home Assistant
The integration registers three folders as static web paths: `/glass_panes/player/`, `/glass_panes/panes/` and `/glass_panes/schema/`. It uses `hass.http.async_register_static_paths` with `StaticPathConfig` (checked in the 2026.10.4 source) and `cache_headers=False`, so updated files are not held on to. Nothing else in the integration is served.

**Those paths are public.** The HA auth code never blocks a request, and the static handlers do not check it. So anyone who can reach Home Assistant can read these files without logging in. (This is inferred from the source, not stated outright.) That is why they may only hold the player code, pane layouts (no entities in them) and schemas.

**Entity bindings, tokens and anything personal must never be put in those folders.** Bindings are served from a login-protected endpoint instead (see below).

The player loads a pane from `GET /api/glass_panes/panes/<id>` first, so a pane saved from the builder wins over the shipped one. If that is not available, it uses the shipped files.

## Bindings from Home Assistant
With a real Home Assistant, the player fetches `GET /api/glass_panes/bindings` using the same token it uses for everything else. It fetches them again whenever the pane changes, so a change to the bindings shows up the next time the pane switches.

`?bindings=<url>` still overrides this with a file. If the endpoint is missing (an older integration), the widgets show their empty state. See `docs/pane-schema.md` for the endpoint and services.

## Try it with no Home Assistant
From the repo root:
```bash
python -m http.server 8765 --directory custom_components/glass_panes
```
Then open `http://127.0.0.1:8765/player/index.html?pane=house&mock=1&debug=1`. Swap `house` for `mirror` or `video` to see the others. `mock=1` invents data for every widget. In a browser window that is not portrait, the pane is scaled down to fit.

## First-time sign-in
A display signs in once and keeps the login on itself, in that browser's own storage.
- **Easiest:** in the sidebar open Glass Panes, then Displays, then **Set up login** on the display.
  - Home Assistant makes a separate ordinary user for that display ("Glass Panes: <name>"). It is not an admin, and it can only sign in from your home network. It gets one long-lived token, shown once.
  - Open the link it gives you on the display. The link carries the token in the part after `#`, which is never sent to any server. The player saves the token and removes it from the address.
  - **Replace** makes a new token (the old one stops working). **Revoke** removes the user and with it the token. Removing the display also removes its login.
- **By hand:** in Home Assistant click your name at the bottom of the sidebar, open **Security**, then **Long-lived access tokens**, then **Create token**. Paste it on the display's sign-in screen.
- Limits: Home Assistant cannot restrict a user to certain entities, so the display's login can do what any ordinary user can: read every entity, and also control devices (a lock, a garage door, an alarm without a code). It cannot change Home Assistant's settings, and it only works from your home network. Keep the display's link private, and use **Replace** if a device with it is lost. Services never hand out tokens, so an agent calling services never handles one.

## Address options
| Option | Meaning |
|---|---|
| `pane=<id>` | Pane to show (default `mirror`). |
| `display=<id>` | A display set up in Home Assistant (see `docs/api.md`): the player looks it up and uses its select entity, its timezone and its current pane. It switches panes live when the select changes. An explicit `pane=`, `follow=` or `tz=` still wins. |
| `follow=<entity>` | Follow an entity whose state is a pane id (this will be the display's `select`) and switch panes when it changes. An unknown pane id is ignored and the current pane stays. |
| `mock=1` | Made-up data, no Home Assistant. |
| `bindings=<url>` | A bindings file (see `docs/pane-schema.md`). Without one, widgets show their empty state. |
| `tz=<zone>` | Timezone for every time shown, e.g. `America/Chicago`. Default is the device's own zone. A Lululemon Studio mirror's clock is stuck on UTC, so it needs this. |
| `ha=<origin>` | Home Assistant address if the player is not served by Home Assistant itself. |
| `panes=<url/>`, `assets=<url/>` | Where pane files and images/video live. |
| `kiosk=1` | Inside the Mirror Kiosk app only: lets the page set backlight brightness and play video natively through the app on the device itself. Off by default, so a normal browser never sends anything to a local port. |
| `tokenkey=<name>` | Look for the saved access token under this name in the browser's own storage (default `glass_panes_token`). This lets a device that already has a token saved by an older page reuse it, which matters for a display with no keyboard. Only the *name* goes in the address, never the token. The player never deletes a token saved under a borrowed name, even if it is rejected. |
| `force=a:hide,b:show` | Preview only: switch those widgets off or on whatever their "show when" rules say, to look at both layouts of a pane. |
| `debug=1` | Show errors on screen. |

## Layout and the overflow check
Widgets can be `auto_height` and can `flow` below one another (see `docs/pane-schema.md`). Sections push each other down as they grow and collapse when empty. Nothing is clipped.

`window.glassPanesCheck()` measures every widget. It lists any widget whose content is bigger than its box, plus anything that would run off the bottom of the canvas. With `?debug=1`, those get a red dashed outline and are listed on screen.

With mock data, all three example panes report no problems. That includes two stress tests:
- Very long team names. The sports section grew from 84 to 160 px and pushed everything below it down, with nothing overlapping.
- An empty sports section. Its title and one divider disappear, and everything pulls up.

## Empty sections
Nothing is drawn for an empty section.
- The shipped panes set `hide_when_empty` on their calendar lists, so there is no "nothing on the calendar" message.
- The now-playing widget draws nothing when idle.
- `auto_height` plus `flow` close the gap.
- A divider only shows between two things that have content. It does not show after nothing, right after another divider, or when nothing with content comes after it.
- A section title can use `show_if` to appear only while its list has something to show.

## Now playing
When nothing is playing (or a player has been paused longer than `paused_timeout_minutes`), the widget draws nothing. In the `house` example it is `auto_height`, and its title only shows while it has something (`show_if`). The whole section disappears and everything below moves up.

### Looks: card, vinyl, CD
The option `style` picks the look: `card` (the default and the original: album art with a soft glow, then the words), `vinyl` or `cd`. In the builder, select the widget, then choose **Look**.
- **vinyl**: a black record with fine grooves and a soft light streak. The album art is the round centre label (a plain coloured label when there is no art or `show_art` is off). While playing, the record turns slowly (one turn in 8 seconds) and a tonearm swings onto it. When paused, the record stops and the arm swings back to rest beside it.
- **cd**: a bright silver disc with the art in a ring around the centre hole. It turns once in 6 seconds while playing and is still when paused. No tonearm.
- **Burn-in saver** (option `burn_in_saver`, off by default; in the builder, **Burn-in saver (very slow drift)**): the whole Now playing block drifts about 6 pixels around a small square, one lap every 40 minutes.
  - It is far too slow to see, but a screen left on for hours never holds the same pixels.
  - It works with every look and animates `transform` only.
  - It stays on even for people who ask for reduced motion, because you can't perceive it.
- Idle is unchanged for every look. Nothing playing (or paused longer than `paused_timeout_minutes`) draws nothing, or `idle_text`.
- The record is as tall as the widget (the same square the card look uses for the art). The vinyl look adds about a third of that width on the right for the tonearm.
- **Kept cheap for a weak display:**
  - It is drawn with CSS only. There are no picture files, and the only image loaded is the album art.
  - The only animated property is `transform` (`rotate`). The disc spins, and the tonearm swings once when play starts or stops, each on its own layer.
  - There is no blur, shadow, filter, size or position animation, and no JavaScript timers or loops.
  - The spin exists only while a song is playing. Paused or idle, nothing moves.
  - With the system setting "reduce motion" (`prefers-reduced-motion`), the disc does not spin and the arm jumps into place.
  - The turn times (8 s for the record, 6 s for the CD) are a first guess and may change once they've been tuned on more mirrors.
- The builder's Demo data switch and a widget's "Preview with sample data" box play a made-up track with made-up art (a small inline drawing, nothing from the internet).

## Sports
Live games show "Live" plus the period ("Live · 3rd"), never a running game clock.
- The period comes from the sensor's `quarter` (or `period`) attribute when it is a number. Otherwise it is pulled out of the clock text ("3rd", "OT", "Halftime"). If neither gives one, it just says "Live".
- The period is read from the sensor's attributes as described above. This has not been checked against every Team Tracker version yet, so tell us if a live game shows the wrong period.
- Upcoming games still show their start time.
- In the `rows` layout, each game shows only its status beside the logos and score ("Live · 3rd", "Lions win · Final", "Spurs play at 7"). The matchup text and the TV network are left out, because the logos and score already say who is playing.
- The "Next:" lines for games further out do name the teams, since there are no logos for those.
- Team and opponent logos come straight from the sensor's `team_logo` / `opponent_logo` URLs (the old page used the same). A display needs to be able to reach those addresses.
- Previews with mock data use small lettered badges instead.
