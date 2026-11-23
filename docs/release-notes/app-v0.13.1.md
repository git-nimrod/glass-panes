## Mirror app 0.13.1

A small one, and both changes came straight out of your issues. Videos now swap with no black flash in between, and the app can take the screen back when another app covers it.

### Videos swap with no black gap

- When `/video/start` gets a different video while one is already playing, the last frame now stays on screen until the new video draws its first one. Before, the glass went black for a second or so in between, and on a two-way mirror that black shows up as the glass suddenly turning back into a mirror.
- Only one video decoder is open at a time, same as before, so it doesn't cost any extra memory.
- A video that hasn't opened after 20 seconds now counts as an error (`/status` shows `error -110/0`), instead of waiting forever.
- This one was written by a community contributor (#8, #9), and I think that's pretty cool. Thank you!

### Coming back to the front

- **New call `/front`:** if another app's screen has covered the mirror page (a camera app that opens itself at boot, say), `/front` brings Glass Panes back and puts the app's own rotation back. The page keeps running, so nothing reloads. You can call it from Home Assistant with a `rest_command` (#4).
- **Or let the app do it:** `/recovery/tune?reclaim_front=60` makes the app come back by itself once something has covered it for 60 seconds. It's **off by default**, because otherwise it takes the screen away from you while you're in Android's settings over `scrcpy`. It only acts while the screen is on, so the Screen switch and quiet hours still work like before.
- If you rely on this, set the app's rotation once (`/rotation/portrait`). Without one, the app follows Android's rotation, and some apps turn auto-rotate on.
- `/status` lists the new `front` capability. Older versions of the integration just ignore it.

### Install

> [!NOTE]
> **On mirror-android-3:** the mirror's **Mirror app** update entity in Home Assistant installs it, with no cable.

On image 1 or 2: `adb install -r mirror-kiosk-v0.13.1.apk` installs it over a signed 0.10.3 or newer and keeps your settings. The [update guide](https://github.com/git-nimrod/glass-panes/blob/main/docs/mirror-app/update-app.md) has every step.

### Known limits

<details>
<summary>What's been tested</summary>

<br>

- The video swap was tested by its author on their own mirror with 1080x1920 loops. Our side of it is the app's automated tests (when a swap happens, the video's shape, and when the held frame comes down).
- `/front` and `reclaim_front` are covered by the app's automated tests for when they should and shouldn't act. Neither one has been tried on a real mirror with a second app yet. If you try it, please tell us how it goes on #4.

</details>
