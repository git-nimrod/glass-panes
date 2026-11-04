# `adb`, `fastboot` and `scrcpy` command glossary

This page lists every command the guides use with the mirror: what it does, when you need it, and what it can break. You don't need to read it top to bottom. Look a command up when a guide sends you here.

Run them all in **PowerShell**, on the computer plugged into the mirror's micro-USB port. Words in `<angle brackets>` are placeholders for your own values.

**Where the tools come from:** `adb` and `fastboot` are part of Google's *Platform-Tools*, which Android Studio's SDK Manager installs. `scrcpy` is a separate free tool (`winget install Genymobile.scrcpy`). If you don't want to type the folder every time, add it to the path for the current window:

```powershell
$env:Path += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```

**Risk key:** ✅ changes nothing · ⚠️ changes the mirror, but is easy to undo · ⛔ erases something or cannot be undone.

## Connecting

| Command | What it does | Risk |
|---|---|---|
| `adb devices -l` | Lists connected devices. The mirror should say **`device`**. `unauthorized` means the mirror does not trust your computer's key (see [step 4 of part 1](install-android-lululemon-studio.md#4-use-the-project-adb-key-on-your-computer)). An empty list means there is no connection. Try another cable or port, or wait, because it takes about 3 to 5 minutes after boot | ✅ |
| `adb kill-server` | Stops the background `adb` helper so the next command starts a fresh one. You need this after you swap the key in `%USERPROFILE%\.android\`, because an old helper keeps using the old key | ✅ |
| `scrcpy` (or `scrcpy -w`) | Shows the mirror's screen in a window on your computer, and lets you click it with the mouse (the mirror's own touch screen does not work). `-w` keeps the mirror awake. The first time, the mirror may ask **"Allow USB debugging?"**. Tick *Always allow* and click OK | ✅ |
| `adb shell ip -f inet addr show wlan0` | Prints the mirror's Wi-Fi address (look for `inet 192.168...`) | ✅ |
| `adb shell wm size` | Prints the screen size. On the reference mirror: `1920x1080` (the panel is landscape-native; the picture is turned to portrait) | ✅ |

## The app

| Command | What it does | Risk |
|---|---|---|
| `adb install <file>.apk` | Installs the app | ✅ |
| `adb install -r <file>.apk` | Installs an update over the existing app and **keeps its settings**. Only works if both are signed with the same key (the project's signed releases are) | ✅ |
| `adb uninstall com.nimrod.mirrorkiosk` | Removes the app **and erases its settings** (page address, login, webhook, brightness, presence on/off). Write them down first | ⛔ |
| `adb shell pm list packages com.nimrod.mirrorkiosk` | Shows whether the app is installed | ✅ |
| `adb shell pm grant com.nimrod.mirrorkiosk android.permission.CAMERA` | Lets the app use the camera (for presence detection). The app has no screen where it can ask. Run it again after any uninstall | ⚠️ |
| `adb shell am force-stop com.nimrod.mirrorkiosk` | Stops the app (Android starts it again if it is the home screen) | ✅ |

### Starting the app and giving it settings

`am start` launches the app. Each `--es name 'value'` is one setting. **Only the settings you include are changed.** Everything else stays as it was. Always wrap the command like this, with double quotes outside and single quotes inside, so the `&` characters in the address are not cut off:

```powershell
adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es url '<page address>' --es token '<display login token>' --es webhook '<webhook id>'"
```

| Setting | Meaning |
|---|---|
| `--es url '...'` | The player address for this mirror: `<Home Assistant address>/glass_panes/player/index.html?display=<display id>&kiosk=1&tokenkey=glass_panes_token` |
| `--es token '...'` | The display's login token (made with **Set up login** in the builder, shown once). Never share or screenshot it |
| `--es webhook '...'` | The id of the Home Assistant webhook that receives presence reports (id only, not the address) |
| `--es key '...'` | Optional password for the control server (port 8099), required from other devices if set |
| `--es rotation '...'` | `portrait`, `portrait_reverse`, `landscape`, `landscape_reverse` or `auto`. **Unproven**: see "Turning the picture" below |

If you see `Warning: Activity not started, its current task has been brought to the front`, don't worry. It is normal when the app was already running, and the app still received the new settings.

## Screen and rotation

| Command | What it does | Risk |
|---|---|---|
| `adb shell settings put global stay_on_while_plugged_in 7` | Keeps the screen awake while the power is connected | ⚠️ |
| `adb shell settings put system screen_off_timeout 2147483647` | Stops the screen turning itself off (about 24 days) | ⚠️ |
| `adb shell input keyevent 82` | Presses the Menu key, which dismisses the lock screen | ✅ |
| `adb shell settings put system accelerometer_rotation 0` | Turns off auto-rotate (the mirror has no rotation sensor to use anyway) | ⚠️ |
| `adb shell settings put system user_rotation 3` | **Stands the picture up in portrait.** If it comes out upside down use `1`. `0` is the original landscape | ⚠️ |

### Turning the picture

Use the two `settings put` commands above. They are the supported way. The app also has its own setting (`/rotation/<value>` on the control server, or `--es rotation`). On a mirror whose Android rotation was already set to portrait, it changed nothing, because Android keeps the system rotation in that case and ignores the app's request. Nobody has tried it on a mirror with the system rotation left at `0`, so treat it as experimental.

## Flashing the Android (part 1, see [install-android-lululemon-studio.md](install-android-lululemon-studio.md))

| Command | What it does | Risk |
|---|---|---|
| `adb reboot bootloader` | Restarts the mirror into fastboot over the cable (works once the replacement Android is on it). Before that, hold the **VOL-** button while switching the power on | ⚠️ |
| `fastboot devices` | Lists the mirror while it is in fastboot (the glass stays black, which is normal) | ✅ |
| `fastboot getvar <name>` | Reads one value from the bootloader (for example `product`, `partition-size:userdata`). `getvar all` prints nothing on this bootloader | ✅ |
| `fastboot flash system system.img` | Writes the Android system. **Permanently replaces the system** (about 82 seconds, in four chunks) | ⛔ |
| `fastboot -S 0 flash userdata userdata.sparse` | Writes the data partition **whole** (`-S 0` matters) and **erases everything in it** | ⛔ |
| `fastboot reboot` | Starts the mirror normally. Cut the wall power for a few seconds afterwards for a clean picture | ✅ |

## Keys and checks on your computer

| Command | What it does | Risk |
|---|---|---|
| `Get-FileHash <file> -Algorithm SHA256` | Prints a file's fingerprint so you can check a download against the published one | ✅ |
| `Copy-Item "<key>" "$env:USERPROFILE\.android\adbkey" -Force` | Puts the project ADB key where `adb` looks for it. **Back up your own `adbkey` and `adbkey.pub` first**, this replaces them | ⚠️ |
| `apksigner verify --print-certs <file>.apk` | Shows who signed an APK; compare its SHA-256 with the one in [part 2, step 3](install-app-lululemon-studio.md#3-check-the-app-file-is-genuine) | ✅ |

## The mirror's control server (a browser or `curl`, not `adb`)

These are web addresses on the mirror (`http://<mirror address>:8099/...`), listed with their parameters in [api.md](api.md): `/status`, `/reload`, `/brightness/<0-100>`, `/video/start?url=...`, `/presence/on`, `/presence/off`, `/presence/tune?...` and more.

## Windows quoting, the one thing that goes wrong

Most failed commands fail because of quotes. Three habits help:

- Paste long `adb shell "..."` commands as **one line**. A line break in the middle breaks them.
- Inside the double quotes, use **single quotes** around values. The ending must be `'"` (single then double).
- Build the command in Notepad first, so you can check both ends before you paste it.
