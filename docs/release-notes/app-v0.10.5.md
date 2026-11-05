## Mirror app 0.10.5

A security update for the Mirror Kiosk app on the Lululemon Studio mirror.

### What changed

- **Web pages can't drive your mirror any more.** Before, any web page opened in a browser on your home network could quietly switch presence, change brightness or play a video on the mirror. Now a request that comes from a web page is only accepted from the mirror's own player page. Home Assistant and typed addresses work as before.
- **Videos only from web addresses.** `/video/start` plays `http` and `https` addresses only, never files or other apps' content on the device.
- **Sturdier control server.** Oversized or endless requests are cut off, at most 8 are handled at once, and a bad request can no longer crash the app.
- **Mirror keys with symbols now work**, and the key is checked in a way that can't be guessed a character at a time.
- **Debugging is off in this release build.** Remote debugging and `about:config` are only on in debug builds.

### Install

Download `mirror-kiosk-v0.10.5.apk` below, then `adb install -r mirror-kiosk-v0.10.5.apk`. It installs over 0.10.3 or 0.10.4 and keeps your settings. Steps: part 2 of the install guide.
