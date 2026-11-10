# Update the Mirror Kiosk app

Updating takes a few minutes. You download the new `.apk`, install it over the old one with `adb`, and the mirror keeps its page address, login and settings. If you set up the mirror with [part 2 of the install guide](install-app-lululemon-studio.md), you already have everything you need.

This page covers the app on the mirror. The Home Assistant side is updated separately through HACS, and a short section at the end covers it.

## Before you start

- A computer with `adb`, and the same micro-USB data cable you used to install. Wi-Fi `adb` never authorizes on this mirror, so the cable is required.
- Your mirror's address, for the version check. Open `http://<mirror address>:8099/status` in a browser and read `"version"`. That is the version you have now.
- A reason to update. The [compatibility page](../compatibility.md) lists which features need which app version, and each app release's notes say what changed. If everything you use works, you can skip an update.

## 1. Download the new app

Open the project's [Releases page](https://github.com/git-nimrod/glass-panes/releases) and look for the newest release whose tag starts with `app-v`. Download `mirror-kiosk-v<version>.apk` from it.

App releases are marked as pre-releases on purpose. HACS would otherwise offer them as integration updates.

To check the file is genuine, follow [step 3 of the install guide](install-app-lululemon-studio.md#3-check-the-app-file-is-genuine). It takes one command.

## 2. Install it over the old one

Put the `.apk` in the same folder as `adb`, open a terminal there, and check the mirror is connected:

```bash
adb devices
```

You should see one device listed as `device`. If it says `unauthorized`, accept **Allow USB debugging?** on the mirror's screen. If nothing is listed, try another cable or USB port.

Then install:

```bash
adb install -r mirror-kiosk-v<version>.apk
```

`-r` replaces the old app and keeps its settings. The command should end with `Success`. Replace `<version>` with the number in your file's name, and delete the angle brackets too.

## 3. Allow any new permission

An update keeps the permissions you already granted, such as the camera. A new version can ask for more. The app has no screen where it could ask you, so you grant them from your computer. The release notes say when that is the case.

App 0.11.0 added two, one for the microphone test and one for the Bluetooth test. Run the lines for the tests you want:

```bash
adb shell pm grant com.nimrod.mirrorkiosk android.permission.RECORD_AUDIO
```

```bash
adb shell pm grant com.nimrod.mirrorkiosk android.permission.ACCESS_COARSE_LOCATION
```

The Bluetooth test needs the location permission because Android 6 requires it for Bluetooth scanning. The app does not read your location. Skip both lines if you don't want those tests. Everything else works without them.

## 4. Check that it worked

Give the app a minute to come back after the install, then open `http://<mirror address>:8099/status` and check three things:

- `"version"` shows the new number.
- `"page_ok"` is `true`.
- `"seconds_since_heartbeat"` is a small number. That means the player page is running.

If the mirror still shows the launch screen or Android's own screen after a minute, start the app yourself. This command changes none of its settings:

```bash
adb shell am start -n com.nimrod.mirrorkiosk/.MainActivity
```

## What an update keeps

It keeps the page address, the login, the webhook id, the control key and the presence settings. It does not touch Android itself.

## If something goes wrong

| What you see | What to do |
|---|---|
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The app on the mirror was signed with a different key, for example a test build. Android refuses to replace it. Uninstall it with `adb uninstall com.nimrod.mirrorkiosk`, then install the new file with `adb install`. This erases the app's settings, so you need to repeat steps 5 to 7 of the [install guide](install-app-lululemon-studio.md) (camera permission, a new login, and the start command). |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | Android won't install an older version over a newer one. To go back, uninstall first (this erases the settings), then install the older file. |
| `adb` is "not recognized" (Windows) | Your terminal isn't in the platform-tools folder. Open that folder in File Explorer, click the address bar, type `cmd` and press Enter. |
| `adb devices` shows nothing | Try another micro-USB cable (many only charge) and another USB port, then run `adb kill-server` and `adb devices`. |
| The version in `/status` didn't change | Run `adb shell "dumpsys package com.nimrod.mirrorkiosk \| grep versionName"` to see which version Android has installed. If it is still the old one, the install didn't finish; run `adb install -r` again and read its output. |
| The screen is white after the update | Check `seconds_since_heartbeat` in `/status`. The table in [step 7c of the install guide](install-app-lululemon-studio.md#7c-what-you-should-see) explains what each result means. |

## Update the Home Assistant side

The Glass Panes integration updates through HACS, and it works separately from the app:

1. In Home Assistant, open **HACS**, find **Glass Panes**, open the three-dot menu and choose **Redownload**. Pick the newest version.
2. Restart Home Assistant if the release notes say to. A release that adds new Python parts needs a restart.
3. Reload the builder page once (Ctrl+F5).

Your panes, uploads and displays are kept. You can update the two sides in either order. A new integration feature that needs a newer app, such as the speaker, stays unavailable until the app is updated. The [compatibility page](../compatibility.md) lists those.
