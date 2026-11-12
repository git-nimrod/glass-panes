## Mirror app 0.12.0

A start-up that no longer gets stuck after a power cut, and setting a mirror up with a six-digit code instead of a long command.

### Starting up

- **The loading screen no longer sticks over a working page.** When Wi-Fi took a while after power-on, the first page loads failed (as expected) and were retried. But the first load that worked after Wi-Fi came up was mistaken for the black "can't reach it" page, so the loading screen stayed up over a page that was running fine, and nothing retried. Fixed. As a safety net, the page's own "still running" heartbeat now also takes the loading screen away; if it ever has to, the diary (`/log`) gets a `page_alive` line.
- **No more pointless app restart a minute after a power cut.** The mirror has no clock battery, so after a power cut its clock can start in 1970 and jump to today when Wi-Fi sets the time. Every timer in the app used to see that jump as "the start has taken 56 years" and restarted the app or reloaded the page for no reason (the diary showed lines like `not finished after 29905261 min`). All timers now count time since the mirror switched on, which never jumps. The diary still shows real dates and times.
- `/status` and `/log` keep the same fields. `uptime_s` and the diary's `t` are now measured with the same steady clock.

### Pairing

- **Pair with a code:** a mirror that is not set up now shows a six-digit code and its own network address on its screen. In Home Assistant, open Glass Panes, **Displays**, press **Pair a mirror** on your display and type the code and the address. Home Assistant makes the display's login and sends the mirror its page address, the login and a control key over your home network. Nobody copies or pastes a token. This needs Glass Panes 0.12.0.
- **Protected by the code:** a right code works once and then changes. Five wrong tries lock pairing for a minute and also change the code. The mirror refuses anything that is not a Glass Panes player address, a login or a control key in the expected form.
- **Pairing again:** run `adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es pair 1"` to show a code on a mirror that is already set up. `--es pair 0` cancels it.
- **New call:** `/pair` on the control server (see [api.md](../mirror-app/api.md)). It works only while the mirror has no page address yet, or after `--es pair 1`.
- The old way (an `adb` command with the login token) still works and nothing else changes: your settings, the audio player and the other calls are as in 0.11.0.

### Install

`adb install -r mirror-kiosk-v0.12.0.apk` over a signed 0.10.3 or newer keeps your settings. If the mirror has a test build on it, uninstall it first, which erases the app's settings. The [update guide](https://github.com/git-nimrod/glass-panes/blob/main/docs/mirror-app/update-app.md) has every step.

### Known limits

- The start-up fix was traced from the diary of the tested unit and checked against the app's logic tests. Starting up still waits for the mirror's Wi-Fi, which on the tested unit takes one to two and a half minutes after power-on.
- The pairing rules (the code, the five-try lock, what is accepted) are covered by automated tests, and Home Assistant's side was tested against a pretend mirror. The pairing screen has not yet been tried on a real mirror. The code and the login travel as plain `http` on your home network.
