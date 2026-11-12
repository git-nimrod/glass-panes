## Mirror app 0.12.0

A reliability fix for starting up, mostly noticed after a power cut.

- **The loading screen no longer sticks over a working page.** When Wi-Fi took a while after power-on, the first page loads failed (as expected) and were retried. But the first load that worked after Wi-Fi came up was mistaken for the black "can't reach it" page, so the loading screen stayed up over a page that was running fine, and nothing retried. Fixed. As a safety net, the page's own "still running" heartbeat now also takes the loading screen away; if it ever has to, the diary (`/log`) gets a `page_alive` line.
- **No more pointless app restart a minute after a power cut.** The mirror has no clock battery, so after a power cut its clock can start in 1970 and jump to today when Wi-Fi sets the time. Every timer in the app used to see that jump as "the start has taken 56 years" and restarted the app or reloaded the page for no reason (the diary showed lines like `not finished after 29905261 min`). All timers now count time since the mirror switched on, which never jumps. The diary still shows real dates and times.
- `/status` and `/log` keep the same fields. `uptime_s` and the diary's `t` are now measured with the same steady clock.

Install: `adb install -r mirror-kiosk-v0.12.0.apk` over a signed 0.10.3 or newer keeps your settings. The [update guide](https://github.com/git-nimrod/glass-panes/blob/main/docs/mirror-app/update-app.md) has every step.

Known limits: the start-up fix was traced from the diary of the tested unit and checked against the app's logic tests; the fixed build has not yet been through a cold start on a mirror. Starting up still waits for the mirror's Wi-Fi, which on the tested unit takes one to two and a half minutes after power-on.
