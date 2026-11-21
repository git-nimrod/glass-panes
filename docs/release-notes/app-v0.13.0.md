## Mirror app 0.13.0

With this release the mirror becomes a **voice assistant** with its own wake word and a **Bluetooth proxy**. It can also **turn its screen fully off**, and when it's built into the `mirror-android-3` image it **installs its own updates** sent from Home Assistant. New installs don't need any typing on the mirror anymore, since Wi-Fi, permissions and pairing are all handled for you.

> [!IMPORTANT]
> Everything new is **off until you switch it on** from Home Assistant. With Bluetooth proxy, Voice and Wake word off, none of that code runs.

> [!NOTE]
> You need Glass Panes **v0.13.0** for the new switches. Older integrations keep working with this app like they did before.

### Voice assistant and wake word

The mirror talks to Home Assistant over an ESPHome-compatible link on port 6053. Home Assistant's own ESPHome integration finds the mirror and adds it as a voice assistant and Bluetooth proxy. There's no ESPHome firmware involved, because the app speaks the same protocol.

The link is encrypted, and there's no key to type. The mirror starts without a key and says so. On the first connection, Home Assistant makes a random key and hands it over, the same way it does for ESPHome devices, and from then on the mirror only accepts encrypted connections with that key. Voice is only ever offered on the encrypted link, and by default only the Home Assistant that paired the mirror can connect.

The wake word runs on the mirror. It ships with "Okay Nabu", "Hey Jarvis" and "Hey Mycroft", which are open models (Apache 2.0) inside the app and never downloaded. You pick the word in Home Assistant. The sound processing was ported to the app and gives the same results as the reference version, value for value. On the tested mirror it uses about 3% of one CPU core.

- **Audio only leaves the mirror during a question:** after the wake word, or when Home Assistant starts a turn. The second or so you say right after the wake word is kept, so nothing is lost while Home Assistant gets ready.
- **On-screen signs:** a small dot while it listens for the wake word, **"Listening…"** while it records your question, then **"Thinking…"**. If a video covers the page, a short pop-up shows instead.
- **Answers and announcements** play through the mirror's speaker. While its own answer plays, and for a moment after, the wake word is paused so the mirror doesn't hear itself.
- **Safety limits:** a question listens for 15 seconds at most, and then Home Assistant gets up to 30 more seconds to answer.
- **Three microphone modes** (`/voice/test?source=vr|vc|mic`), and the mirror remembers the one you pick. Voice-call mode was the clearest on the tested unit.

### Bluetooth proxy

The mirror passively scans for nearby Bluetooth devices (sensors, trackers, presence) and sends them to Home Assistant in small batches. Bluetooth is only switched on while the proxy is on, and if the app turned it on, it switches it back off afterwards. Android's Bluetooth service uses about 32 MB while the proxy runs.

### Screen

`/screen/off` and `/screen/on` make the panel go fully dark and come back. The app does this by locking the screen as a device admin. The page watchdog doesn't reload the page while the screen is off. Home Assistant's Screen switch, Screen mode and quiet hours all use this.

Built into `mirror-android-3`, the app turns on its own screen-off permission. On older images, run this once:

```
adb shell dpm set-active-admin com.nimrod.mirrorkiosk/.ScreenAdmin
```

### Updates from Home Assistant

Home Assistant can send the mirror a new app with **`POST /update/install`**. Only Home Assistant can do this (never a web page or the mirror itself), and only with the mirror's control key. Before installing anything, the app checks that:

- the file's fingerprint matches;
- it's signed with **exactly the same certificate** as the installed app, so only the project's release key can update it;
- its version number is higher.

It installs itself and comes back as the new version in about half a minute. This needs the app **built into the image** (`mirror-android-3`), because only a built-in app is allowed to install packages. `/status` tells you whether it can (`update.can_install`).

### Setup with no typing on the mirror

- **Wi-Fi from the installer:** the installer passes your network name and password to the app, which adds the network to Android's own settings. The app doesn't store the password.
- **The pairing code stays on screen** on a fresh install. The empty start page doesn't hide it anymore (that was the 0.12.0 bug).
- **Built into the image**, the app starts as the home screen with camera, microphone and location already granted, and Android restarts it if it ever stops.

### Security

- **An unpaired mirror only answers pairing and status requests from the network.** Everything else is refused until Home Assistant has paired it and given it a control key. The page on the mirror and `adb` aren't affected.
- The control key is still checked in constant time, and web pages from other sites are still refused.

### Also new

- **Kiosk API 1:** `/status` reports `platform`, `board`, `kiosk_api` and a list of `capabilities`, so Home Assistant knows what this mirror can do and can say "needs a newer mirror app" instead of just failing.
- **Two optional browser-engine memory switches** (`/engine/tune`), both off by default. Turning off the separate graphics process saved memory on the tested mirror, but it caused visual glitches, so leave it on.
- `/status` reports the Bluetooth, voice and wake-word state, and how much CPU the wake word is using.

### Install

**Easiest:** flash `mirror-android-3`, which has 0.13.0 built in.

**On an older image:** `adb install -r mirror-kiosk-v0.13.0.apk` over a signed 0.10.3 or newer keeps your settings. Then grant the microphone and location if you want voice or Bluetooth:

```
adb shell pm grant com.nimrod.mirrorkiosk android.permission.RECORD_AUDIO
adb shell pm grant com.nimrod.mirrorkiosk android.permission.ACCESS_COARSE_LOCATION
```

The [update guide](https://github.com/git-nimrod/glass-panes/blob/main/docs/mirror-app/update-app.md) has every step.

### How it was tested

<details>
<summary>On the tested unit (a RevP21) with <code>mirror-android-3</code> and Glass Panes v0.13.0</summary>

<br>

- first boot to the pairing code with no taps;
- Wi-Fi from the installer;
- built-in permissions;
- the screen fully off and on;
- the unpaired lockdown;
- Home Assistant discovering the mirror and handing over the key;
- the encrypted link;
- 14,000+ Bluetooth advertisements in 15 minutes;
- voice questions answered;
- all three wake-word models matching the reference on a test recording;
- "Okay Nabu" by voice, several times in a row;
- 270 MB of memory free with everything on.

That session found one bug: a second wake-word question within 15 seconds got cut off. It's fixed in this release. The app's unit tests cover the voice protocol, the encryption, the wake-word processing, the update checks, the Wi-Fi rules and the pairing rules.

</details>

### Known limits

- Hearing from across a room is weak, so the microphone works best within a few meters.
- False wakes over a long evening with TV or music haven't been counted yet.
- There are no timers yet, and you can't interrupt an answer while it plays.
- After you switch Wake word on or off, the mirror drops Home Assistant's connection once, so Home Assistant re-reads the list of wake words.
- The control key and pairing code travel as plain `http` on your home network.
