# Lululemon Studio mirror, part 2: install the Glass Panes app

This is the second of two guides for the **Lululemon Studio mirror**. It installs the **Mirror Kiosk** app, which shows your Glass Panes player full screen, and then points it at your display. Every command is copy-and-paste. Words in `<angle brackets>` are placeholders you replace with your own values.

> **Delete the `<` and `>` as well.** `<mirror address>` becomes the address itself (the four numbers your router shows for the mirror), not those numbers inside `<` and `>`. Leaving the brackets in is the most common reason a command fails (a typical message is "hostname contains invalid characters"). The next most common are a missing quote and a display id with capital letters; step 7 shows how to avoid both.

1. [Part 1: install Android](install-android-lululemon-studio.md) (do this first).
2. **This guide:** install the app.

Already installed and just updating? See [Update the app](update-app.md).

## Before you start

You need all of these:

- [ ] **A mirror that already runs the replacement Android** from part 1, with Wi-Fi on and the picture upright.
- [ ] **A computer with `adb`.** It comes in Google's free "SDK Platform-Tools" download. Unzip it, then open a terminal in that folder. On Windows, click the folder's address bar, type `cmd` and press Enter.
- [ ] **A data micro-USB cable** from the mirror to the computer. Wi-Fi `adb` never authorizes on this mirror, so use the cable.
- [ ] **Glass Panes installed in Home Assistant**, with a **display** added in the Glass Panes sidebar panel.
- [ ] **The app file**: `mirror-kiosk-v<version>.apk`, from the newest release on this project's [Releases page](https://github.com/git-nimrod/glass-panes/releases) whose tag starts with **`app-v`**. App releases are marked *pre-release* on purpose, so HACS ignores them. Releases up to `v0.10.4` also carry an identical copy.

Placeholders used below:

| Placeholder | What it is |
|---|---|
| `<HA address>` | Your Home Assistant address **as the mirror can reach it**, for example `http://homeassistant.local:8123` or its IP. Not `localhost` |
| `<display id>` | The id of your display: **lowercase** letters, digits and underscores only. In Glass Panes, open **Displays**: the small grey text under your display's name reads `select.glass_panes_hall_mirror`, and the id is what comes after `select.glass_panes_` (here `hall_mirror`). It is **not** the name you typed, and capital letters make the player say it can't find the display. Step 7 shows how to copy it exactly |
| `<mirror address>` | The mirror's IP address on your network (see your router's device list) |

### What can go wrong, and how to undo it

| Step | Risk | What can go wrong | Undo |
|---|---|---|---|
| 1 to 4 | Low | Nothing changes until step 4. If another copy of the app is installed with a different signing key, Android refuses. The only way past that is to uninstall it, which **erases its saved settings** | [Undo it](#undo-it) |
| 5 Camera permission | Low | The app can then use the camera. It only ever produces a few numbers (see [What the camera does](#what-the-camera-does-and-does-not-do)) | `/presence/off`, or uninstall |
| 7 Address and login | Low | The login token is stored in the app on the mirror. It also appears in your computer's command history | **Replace** the login in the builder, which stops the old one working |
| The control port (8099) | **Medium, by design** | Until you set a key, anyone on your home network can change brightness, play video or switch presence. It never exposes camera pictures | Set a key ([optional step](#optional-protect-the-control-port-with-a-key)). Keep the mirror on a network you trust |

## 1. Connect the mirror to your computer

1. Plug the micro-USB cable into the mirror and your computer.
2. In the terminal, run:
   ```bash
   adb devices
   ```
3. **Expected:** one device, listed as `device`.
   - If it says `unauthorized`, look at the mirror's screen for **Allow USB debugging?**, tick **Always allow**, tap **OK**, and run `adb devices` again. If it still does, redo [part 1, step 4](install-android-lululemon-studio.md#4-use-the-project-adb-key-on-your-computer).
   - If nothing is listed, try another cable or another USB port. The cable is the most common cause: many micro-USB cables only charge, and people have gone through several before finding one that carries data.
   - If it worked before and now lists nothing, try a different USB port on the computer, then run `adb kill-server` and `adb devices` again. That has brought a lost connection back.

## 2. Check what is on the mirror (nothing changes)

```bash
adb shell pm list packages com.nimrod.mirrorkiosk
```

**Expected:** no output on a fresh mirror. If it prints `package:com.nimrod.mirrorkiosk`, the app is already installed and step 4 will update it.

## 3. Check the app file is genuine

Every signed release app is signed with the project's release certificate. If you have the Android build-tools, check yours:

```bash
apksigner verify --print-certs mirror-kiosk-v<version>.apk
```

The SHA-256 digest it prints must be exactly:

```
f01c1695256290f39fb5d552538aed723434157ffd4714ac6a19bf169af58dba
```

If it is different, this project did not sign that file. **Don't install it.** (Skipping this check is fine if you downloaded the file from this project's Releases page, but it's the only way to be sure.)

## 4. Install the app

Put the `.apk` in the same folder as `adb`, then run:

```bash
adb install -r mirror-kiosk-v<version>.apk
```

`-r` means "replace it if it is already there, and keep its settings". **Expected:** it prints `Success`.

**If you see `INSTALL_FAILED_UPDATE_INCOMPATIBLE`:** the copy on the mirror was signed with a different key. Uninstall it and install again. This **erases the app's settings**, so write down its page address and login first:

```bash
adb uninstall com.nimrod.mirrorkiosk
adb install mirror-kiosk-v<version>.apk
```

## 5. Allow the camera (for presence detection)

The app has no screen where it can ask, so on Android 6 you allow the camera from your computer. Run this again after any uninstall, because an uninstall removes the permission:

```bash
adb shell pm grant com.nimrod.mirrorkiosk android.permission.CAMERA
```

Skip it if you don't want presence detection. The rest of the app works without it.

## 6. Make a login for the display

1. In Home Assistant, open **Glass Panes** in the sidebar, then **Displays**.
2. On your display, press **Set up login**.
3. You get a link that contains the display's access token. **It is shown once.** Keep that tab open for the next step, and don't paste the token anywhere except the command below (never into a chat, a forum post or an issue). If you close the tab before you have used it, or you pasted it somewhere public, press **Set up login** again (or **Replace**), which stops the old token working.

## 7. Start the app and point it at your display

### The short way: pair with a code (app 0.12.0 and newer)

If your app is 0.12.0 or newer, skip steps 6 and 7 below. You don't make a login or run a long command.

1. Start the app on the mirror (restart the mirror, or run `adb shell am start -n com.nimrod.mirrorkiosk/.MainActivity`). A mirror that is not set up shows **a six-digit code and its own address** on the screen.
2. In Home Assistant open **Glass Panes**, then **Displays**, and on your display press **Pair a mirror…**.
3. Type the six digits and the mirror's address (shown under the code), check the Home Assistant address (it must be the one **the mirror** can reach, such as `http://homeassistant.local:8123`, not `localhost`), and press **Pair**.
4. **Expected:** a message that the mirror is set up, and a moment later your pane on the mirror. Nothing was copied or pasted: Home Assistant made the display's login and sent it straight to the mirror.

If the code is refused, check the digits on the screen. After five wrong tries the mirror waits a minute and shows a new code. To pair a mirror that is already set up (for example after moving to a new Home Assistant), run `adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es pair 1"`, which shows a code again.

The code and the login travel over your home network as plain `http`, like everything else between the mirror and Home Assistant. Pair on your own network, not a shared one.

The older way, with a login token and one `adb` command, still works and is described next.

People most often get stuck at this step, usually on a small typo. Take it in three short parts.

### 7a. Get your player address from Glass Panes

The address has your display's id in it, and the id is **lowercase**. Don't type it from memory: let Glass Panes give it to you.

1. In Home Assistant, open **Glass Panes**, then **Displays**, and press **Open this display's player** under your display.
2. **Expected:** a new tab with a sign-in screen asking for a token (don't enter anything yet), or, if this browser has signed in before, your pane. An error page or a blank page means something is wrong with the display or with Home Assistant, so fix that before you touch the mirror.
3. Copy the address from the browser's address bar. It looks like `http://homeassistant.local:8123/glass_panes/player/index.html?display=hall_mirror`. That whole address, up to and including `display=hall_mirror`, is your `<player address>` below.
4. It has to be an address **the mirror** can reach, so it must not be `localhost`. If your browser shows a cloud or `https://` address, use your local `http://` address instead (the same address, with `http://`, your Home Assistant's IP or `homeassistant.local`, and port `8123`). Android 6 on the mirror does not trust many modern HTTPS certificates.

### 7b. Send it to the mirror

Run this as **one command**. Replace `<player address>` with what you copied, and `<token>` with the part of the login link from step 6 that comes after `#t=`:

```bash
adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es url '<player address>&kiosk=1&tokenkey=glass_panes_token' --es token '<token>'"
```

The odd quotes matter. The outer double quotes keep Windows happy, and the inner single quotes stop the mirror's own shell from treating each `&` as "run in the background", which would cut the address short. Type them exactly as shown, and keep `&kiosk=1&tokenkey=glass_panes_token` on the end of the address.

**If that one long command keeps going wrong,** send it as two short ones. The app keeps each setting separately and only changes the ones you give it, so this does the same thing:

```bash
adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es url '<player address>&kiosk=1&tokenkey=glass_panes_token'"
```

```bash
adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es token '<token>'"
```

What the parts mean:

- `url` is the Glass Panes player for **your** display. `kiosk=1` lets the page use the app for brightness and video. `tokenkey=glass_panes_token` is the name the player saves its login under (the default).
- `token` is the display's login. The app adds `#t=<token>` when it loads the page. The player saves it and removes it from the address. You only need to give it once.

If Android asks **which app to use as the home screen**, choose **Mirror Kiosk** and **Always**. The app declares itself a home screen so that Android starts it at boot and restarts it if it crashes. The exact wording of the prompt depends on the Android build.

**If the mirror is showing Android's Settings or its home screen instead,** the app isn't running. Send the command above again, or press the home key from your computer:

```bash
adb shell input keyevent 3
```

Choose **Mirror Kiosk**. If **Always** isn't offered the first time, run the key command once more and choose again. After this the app starts by itself when the mirror is switched on (give it about two and a half minutes for Wi-Fi), so a reboot is a fine way to restart it.

### 7c. What you should see

| What the mirror shows | What it means and what to do |
|---|---|
| The launch animation, then your pane | It works. |
| "Waiting for Wi-Fi or Home Assistant" | The mirror can't reach Home Assistant yet. After a cold power-up, the first Wi-Fi connection can take about two and a half minutes. If it never goes away, open `<HA address>` in a browser on another computer to check it is up, and check the mirror's Wi-Fi. |
| "Not set up yet" | Step 7 wasn't done, or the address was cut short (check the quotes). |
| A plain **white** screen | Open `http://<mirror address>:8099/status` and look at **`seconds_since_heartbeat`**. If it is **`-1`**, the page is not the working player: the address or display id is wrong (check it is lowercase and copied from **Open this display's player**), the token is wrong or was replaced, or the mirror can't reach Home Assistant. Redo 7a and 7b. If it is a **small number** (a few seconds up to a minute), the player is running and the pane simply has nothing to draw: in Glass Panes, **Displays**, choose a pane with something on it (**House** or **Looping video**) under **Showing**. |
| Android's Settings app or its home screen | The app isn't running. See the home-key command above. |

**If the picture is sideways**, the screen is still in landscape. Turn it upright (use `1` instead of `3` if it comes out upside down):

```bash
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 3
```

(The app also has its own rotation setting at `http://<mirror address>:8099/rotation/portrait`, but it is **unproven**: on a mirror whose Android rotation was already portrait it changed nothing. Use the `adb` commands above.)

## 8. Check that it works

Open this address in a browser on a computer on the same network:

```
http://<mirror address>:8099/status
```

**Expected:** JSON that includes:

- `"version"` matching the release you installed (for example `0.10.4`),
- `"page_ok": true` once the page has loaded,
- `"seconds_since_heartbeat"`: seconds since the player page last said "I'm alive". A **small number** means the player is running. **`-1`** means it never has (needs app 0.10.6 or newer), which with `page_ok: true` usually means a wrong address or display id,
- `"presence"` with the camera state, and `"memory"` with RAM measurements (every field is explained in [`mirror-app/README.md`](../../mirror-app/README.md)).

In the `presence` part, `"last_report": "no webhook set"` is normal until you do the optional presence step below. It does not mean anything is wrong.

If `page_ok` stays `false`, or the screen is white, see the table in step 7c and [Troubleshooting](#troubleshooting). You can reload the page any time with `http://<mirror address>:8099/reload`.

## 9. Try a looping video

The mirror plays video with Android's own player above the page, so it is worth checking once on your unit.

1. In Home Assistant, open **Glass Panes**, then **Panes**, and choose **Looping video**.
2. Press **Edit pane**, click the video in the preview, and in the panel on the right choose **Upload**. Pick a video from your computer or phone (MP4, MOV or WebM, up to 100 MB). A short, low-resolution clip is the safest first try.
3. Press **Save**.
4. Open **Displays**, and under **Showing** pick **Looping video** for your display.

**Expected:** the video fills the mirror and loops. Brightness goes to 100 while that pane shows.

If the screen stays black, open `http://<mirror address>:8099/status` and look at `video` and `memory` (`available_mb`, `low_memory`). Then try presence off (`/presence/off`), a smaller video, or a lower `vscans` setting (see below).

## Optional: protect the control port with a key

```bash
adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es key '<a-long-random-key>'"
```

After this, every call to port 8099 from **another device** needs `?key=<a-long-random-key>` on the end. The player running **on the mirror itself** doesn't need it, so brightness and video from the player keep working. If you give only some extras, the others stay as they were.

## Optional: send presence to Home Assistant

The mirror can tell Home Assistant "someone is there" (numbers only). It posts to a **webhook** that you create, so nothing about your house is built into the app.

1. In Home Assistant, create an automation whose trigger is **Webhook**, set to local-only. Note its webhook id.
2. Give the id to the mirror:
   ```bash
   adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es webhook '<webhook id>'"
   ```
3. The automation receives JSON like `{"present": true, "motion": 0.18, ...}`. Use `trigger.json.present`.

With no webhook set, nothing is sent. `http://<mirror address>:8099/presence` always shows the same numbers.

### Presence settings

These are remembered after restarts. Open the addresses in a browser, adding `&key=...` or `?key=...` if you set a key. The current values show up under `presence.settings` in `/status`.

| Address | What it does |
|---|---|
| `/presence/on`, `/presence/off` | Switch camera presence on or off |
| `/presence/tune?scans=120` | How many times a minute the camera picture is checked (1 to 240, default 120) |
| `/presence/tune?vscans=6` | The same, but while a video plays (default 12). Lower is lighter on the mirror |
| `/presence/tune?hold=30` | Seconds to keep saying "someone is there" after the last movement (5 to 600, default 30) |
| `/presence/tune?thr=10` | How big a change in light counts as movement (2 to 60, default 10; lower is more sensitive) |
| `/presence/tune?fps=0` | Camera frame rate: 0 means the slowest the camera offers (default), otherwise 1 to 30. Applies the next time the camera starts (`/presence/off`, then `/presence/on`) |
| `/presence/tune?report=60` | Seconds between "still here" messages to Home Assistant (10 to 3600, default 60) |
| `/presence/size?w=320` | Camera picture width (160 to 1920, default 320; bigger uses more memory and CPU) |

You can combine several: `/presence/tune?scans=30&vscans=6&hold=60`. You can also change these in the builder: the **Settings** gear next to Dark mode, then **Display settings** (see [Getting started](../getting-started.md#display-settings-if-the-mirror-runs-the-mirror-kiosk-app)).

### What the camera does and does not do

- It looks for **changes in light**, not faces. It never recognises or identifies anyone.
- Each look squashes the picture into a grid of 16 by 12 brightness numbers, compares it with the last grid and throws both away. No picture is saved or sent, ever.
- A frosted or blurry cover over the lens doesn't stop it working, because only rough light and shadow matter.
- Presence needs memory and CPU. The mirror is tightest on RAM while a video plays, so the app looks much less often then (`vscans`). You can also switch presence off with `/presence/off`.

## Undo it

- **Stop presence only:** open `http://<mirror address>:8099/presence/off`.
- **Stop the app for now:** `adb shell am force-stop com.nimrod.mirrorkiosk` (Android starts it again if it is the home screen).
- **Remove the app:** `adb uninstall com.nimrod.mirrorkiosk`. This erases its settings. The mirror goes back to whatever home screen the Android build has.
- **Revoke the display's login:** in Glass Panes, **Displays**, **Revoke** on the display.

## Troubleshooting

| What you see | What to try |
|---|---|
| `adb` is "not recognized" (Windows) | Your terminal isn't in the platform-tools folder. Open that folder in File Explorer, click its address bar, type `cmd` and press Enter. In PowerShell you can also run `.\adb` from that folder |
| "hostname contains invalid characters", or a command complains about `<` or `>` | A placeholder still has its angle brackets. Replace the whole `<...>`, brackets included |
| `adb devices` shows nothing | A different cable (many are charge-only, and several people tried four or five before one worked) or USB port. On Windows, check Device Manager for the mirror |
| `adb` worked, and now shows nothing | Try a different USB port on the computer, then `adb kill-server` and `adb devices` |
| The screen is plain white | See the table in [step 7c](#7c-what-you-should-see): check `seconds_since_heartbeat` in `/status` |
| The player says it can't find the display, or the page is blank in a browser | The display id has a capital letter or a typo. Copy the address from **Open this display's player** in Glass Panes instead of typing it |
| The mirror shows Android's Settings or its home screen | The app isn't running: run step 7 again, or `adb shell input keyevent 3` and choose **Mirror Kiosk**, **Always** |
| `unauthorized` | Accept **Allow USB debugging?** on the mirror's screen, or redo the project key step in part 1 |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | See step 4 (a different signing key; uninstalling erases the settings) |
| The screen says "Not set up yet" | Step 7 was not done, or the address was cut short (the quoting in step 7 matters) |
| The screen stays on "Waiting for Wi-Fi or Home Assistant" | Open `<HA address>` in a browser on a computer to check it is up. Check the mirror's Wi-Fi. After a cold power-up, wait a few minutes |
| `page_ok` is `false` but the screen shows the pane | Reload with `/reload`. If it stays, report it with the `/status` output |
| Nothing at `http://<mirror address>:8099/status` | Wrong address, mirror asleep, or the app isn't running: start it again with the command in step 7 |
| Brightness or video stop working after setting a key | They shouldn't (calls from the mirror itself need no key). Check you didn't set the key on the player's address |
| Presence never turns on | Check `/presence`: `state` should be `running`. `no camera` means Android sees no camera, and `error:` shows the reason. Redo step 5 |
| The mirror is slow while a video plays | Check `/status` under `memory` (`available_mb`, `low_memory`). Try `/presence/off`, a smaller video, or a lower `vscans` |

If something here is wrong or missing for your mirror, please open an issue and include the output of `/status`. Read it before you post. When a report fails, the presence `last_report` line can contain your Home Assistant's address, so remove anything you don't want public.

Every command used in these guides is explained in the [command glossary](adb-commands.md), and the control server's calls are in the [mirror app API](api.md).
