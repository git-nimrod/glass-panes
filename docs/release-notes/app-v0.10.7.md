## Mirror app 0.10.7

- **Presence keeps working.** If the camera reports an error, or stops sending pictures for 30 seconds, the app lets go of it and opens it again (waiting 5 s, then longer, up to 5 minutes, until pictures flow). Before, presence could quietly stop until the app was restarted. A camera that failed half way through starting is now released properly, so the next try can succeed.
- **No crash loop.** If the browser engine crashes again and again (for example on a pane that is too heavy), the app waits 1 s, 5 s, 15 s, 1 min, then 5 min between rebuilds instead of rebuilding non-stop. Ten calm minutes reset it.
- **The mirror only ever shows your Home Assistant page.** The browser engine inside the app is the last one Mozilla made for Android 6, and it will not get security fixes any more. So the app now refuses to load anything except the Home Assistant address it was given (same address and port) and its own black waiting page: links, redirects, pop-up windows and scripts that try to go elsewhere are blocked. `/status` counts them in `blocked_loads`. If you change your Home Assistant address, set the new one on the mirror as before.
- `/status` shows `presence.seconds_since_frame`, `presence.camera_restarts`, `engine_restarts` and `blocked_loads`.
- Includes everything in 0.10.6 (the stuck-page reload) and 0.10.5 (the security update).

Install: `adb install -r mirror-kiosk-v0.10.7.apk` (keeps your settings).
