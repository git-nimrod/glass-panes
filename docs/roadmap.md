# Roadmap

What we plan to build next, and what each piece depends on. Treat everything here as a plan. There are no dates, the order can change, and any item can be dropped if it turns out not to work on the hardware. It was last updated for v0.12.0 (November 2026).

Each item says where it stands now:

- Not started: an idea, with nothing built.
- Hardware checked: we tested that the mirror can do the underlying thing, and nothing else is built yet.
- In progress: someone is working on it.

## What v0.12.0 already does

Icons, tiles and chips, a Table widget, colours and sizes that follow a value, a widget catalogue, an editable warnings list, reusable widget groups, a snap grid and zoom, a time zone per display, pairing a mirror with a six-digit code, a Brightness number and a Presence detection switch per mirror with a blueprint that uses them, and a mirror app that starts up cleanly after a power cut. The full list is in the [v0.12.0 release notes](release-notes/v0.12.0.md).

Before that, v0.11.0 added a photo slideshow, pictures from image and camera entities, the mirror's own speaker as a Home Assistant media player (Music Assistant works), a printed-CD look for Now playing, clock looks and time zones, and a Settings page ([v0.11.0 release notes](release-notes/v0.11.0.md)).

## 1. Bluetooth proxy

What you'd get: the mirror listens for Bluetooth Low Energy devices (thermometers, door sensors, trackers) and passes what it hears to Home Assistant, so one more room is covered with no extra hardware. This is the same job an ESPHome Bluetooth proxy does.

Where it stands: hardware checked. On the tested mirror, the Bluetooth radio turns on and hears nearby devices in the mirror app's built-in test (`/bluetooth/test`). Nothing else is built.

How we plan to do it:
- The Mirror Kiosk app learns ESPHome's native API, so Home Assistant finds the mirror as an ESPHome device and treats it as a Bluetooth proxy.
- Scanning is limited so it doesn't starve the camera and the page.
- It needs the Android location permission for scanning, which the 0.11.0 app already declares for its Bluetooth test. The app does not read your location.
- It would be off until you turn it on, with a switch on the Settings page.
- It would come in a new app version, 0.13 or later, with the Home Assistant side following.

Why first: it is the smaller of the two, and it has no privacy question.

What could stop it: the mirror has under 1 GB of memory and is already close to Android's low-memory line when a pane, the camera and music run together. Everything here is measured on a real mirror before it ships. It is also not yet proven that Home Assistant accepts the mirror as a proxy.

## 2. Voice assistant (a Home Assistant Assist satellite)

What you'd get: talk to Home Assistant through the mirror. Say the wake word, ask something, and hear the answer from the mirror's own speaker.

Where it stands: hardware checked. On the tested mirror the microphone works in the app's built-in test (`/mic/test`, which reports loudness numbers only and records nothing). The speaker is already used for music. Nothing else is built.

How we plan to do it:
- Over the same ESPHome connection as the Bluetooth proxy, using Home Assistant's own voice pipeline.
- The wake word is recognised on your Home Assistant server (the openWakeWord add-on), so the mirror needs no wake-word model.
- Later, and only if memory allows, an on-device wake word.

Rules we will keep:
- It will be off by default, and you switch it on yourself.
- Microphone audio will go only to your Home Assistant, and only after the wake word (or a button).
- Nothing will be recorded or stored on the mirror.
- The mirror will show a visible sign while it is listening.

What could stop it: the speaker next to the microphone makes echo, and how well Android cancels it depends on the device, so this has to be tested on the real unit. Memory is the other limit.

## 3. Support for the other FCC ID mirror

The two boards. The regulatory sticker near the power input tells you which mirror you have. FCC ID `2AOSD-RLSYM1R0` is the Qualcomm board this project is built and tested on. A sticker that says "Contains: FCC ID `VPYLBEE5HY1MW`" is the newer NXP (i.MX8M Mini) board. The Android images and the Mirror Kiosk app here do not work on it.

Where it stands: not started, and we need people with the hardware. The community already has Linux running on that board, with display, speakers, microphone and camera working. Nobody has yet put a web kiosk on it that shows a Glass Panes pane. The write-ups and projects are on the [compatibility page](compatibility.md#other-boards-and-write-ups).

How we'd approach it, one step at a time:
1. Show a pane. A kiosk browser on the community Linux image opens the display's player page, signed in with the display login.
2. Match the Android app's control calls. A small service on the mirror offers the same control calls (`/status`, brightness, reload, audio), so Display settings, the Settings page and the speaker work unchanged.
3. Camera and sound. Presence, the speaker and the microphone, as far as the hardware allows.
4. Documentation for this board. What works, which files, and which commands, kept apart from the Qualcomm guides.

How you can help:
- If you have this board, tell us its FCC ID, what firmware it started on, and what you get when you try step 1.
- If you publish your own write-up or repository for it, tell us in an issue and we'll link it.

We don't publish instructions for building or modifying system images. We link to the people who have done it.

## Also on the list

These are ideas with no order:

- A screen on/off switch, and brightness driven by light sensors. This waits on a backlight test on the mirror. (Brightness and presence as Home Assistant entities arrived in v0.12.0.)
- A direct player in the app (DLNA or Sendspin) so Music Assistant sees the mirror without Home Assistant in between.
- A game scores card and a few experiments with video.
- A page per board revision (what works, exact files and commands), and a guide to getting fastboot working on Linux.
- Cutting the mirror's memory use.

## Tell us what matters

Open a [GitHub issue](https://github.com/git-nimrod/glass-panes/issues/new/choose) with what you'd like, or with what you find on your own mirror. Never paste tokens or webhook addresses.
