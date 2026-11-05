## Mirror app 0.10.6

- **Reloads a stuck page by itself.** Once the player (Glass Panes 0.10.9 or newer) has said "I'm alive" at least once, the app expects to hear it again within a minute of loading the page and then every few minutes. If it doesn't, for example because Home Assistant showed "404: Not Found" while it was still starting, the app loads the page again, waiting longer each time (10 seconds up to 5 minutes).
- `/status` shows `seconds_since_heartbeat`.
- Includes everything in 0.10.5 (the security update).

Install: `adb install -r mirror-kiosk-v0.10.6.apk` (keeps your settings).
