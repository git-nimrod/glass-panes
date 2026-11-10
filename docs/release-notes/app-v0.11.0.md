## Mirror app 0.11.0

> Wow! Thank you for the feedback and for testing on all of your units. This is another beta build with some new features, better logging, and stability and ease-of-use updates for the associated web app. It's much easier to install if you already had the previous .apk on your mirror: download the new .apk, install it over the old one, and update the integration in HACS. Steps are in the [update guide](https://github.com/git-nimrod/glass-panes/blob/main/docs/mirror-app/update-app.md). Please give me some more feedback and show me what you've been building! This is really exciting, and I'm hoping to keep supporting it.

The mirror can now play music, tells you when a start gets stuck, and can check its own microphone and Bluetooth.

- **Music through the mirror's speaker:** the app plays an `http` or `https` audio stream through the mirror's own speaker: play, pause, resume, stop, seek and volume (`/audio/*` on the control server). With Glass Panes 0.11.0 it shows up as a Home Assistant media player. Only web addresses are played, never files on the mirror, and a stream that does not start within 25 seconds is reported as an error instead of hanging.
- **A start that can't get stuck unnoticed:** a loading bar on the launch screen names the step it is on and turns amber when one is slow. A diary of what the mirror did (`/log`) is kept in a file and survives a power cycle, so a stuck boot leaves evidence. A page load that never finishes is stopped and tried again with growing pauses; if the mirror still has not finished booting after 15 minutes, the app restarts itself (settings at `/recovery/tune`). It can also send a small "still alive" message to Home Assistant.
- **A microphone test:** `/mic/test` listens for a few seconds and reports only how loud it was, so you can find out whether your mirror has a working microphone. Nothing is recorded, saved or sent.
- **A Bluetooth test:** `/bluetooth/test` turns Bluetooth on if needed, counts the Bluetooth devices it hears nearby, and switches Bluetooth off again. No addresses or names of nearby devices are kept.
- `/status` gains `boot`, `recovery`, `alive_report` and `audio` sections.
- **New permissions:** the microphone test needs the microphone permission and the Bluetooth test needs the location permission, which Android 6 requires for Bluetooth scanning (the app does not read your location). Allow them from your computer, once, like the camera:
  `adb shell pm grant com.nimrod.mirrorkiosk android.permission.RECORD_AUDIO`
  `adb shell pm grant com.nimrod.mirrorkiosk android.permission.ACCESS_COARSE_LOCATION`
  Skip them if you don't want those tests. Everything else works without them.
- Includes everything in 0.10.7 (the camera watchdog and the navigation lock) and the unreleased 0.10.8 work.

Install: `adb install -r mirror-kiosk-v0.11.0.apk` keeps your settings when the app already on the mirror is a signed release. If the mirror has a test build on it, uninstall it first. That erases the app's settings, so note down its page address, login and webhook ids. The [update guide](https://github.com/git-nimrod/glass-panes/blob/main/docs/mirror-app/update-app.md) has every step.

Known limits: the audio player has been heard playing real music from Music Assistant on one mirror, and automated tests cover its error handling. It has not been tried on other mirrors or other streaming services. The microphone and Bluetooth tests ran once on one unit and answer whether the hardware works; the app does not yet use the microphone or Bluetooth for anything else. A Bluetooth proxy and a voice assistant are planned for a later app version.
