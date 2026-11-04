# Glass Panes project ADB key (public on purpose)

`adbkey` in this folder is a **private** ADB key, and it is **published on purpose**. It is not a leak, and it protects nothing else.

It is the one key the ready-made mirror Android images trust (see [`docs/mirror-app/install-android-lululemon-studio.md`](../../../docs/mirror-app/install-android-lululemon-studio.md)). We publish it so that anyone who flashes those images can control their own mirror over USB, without building anything.

| File | What it is |
|---|---|
| `adbkey.pub` | The public half. It is built into the ready-made images |
| `adbkey` | The private half. Put it on your computer so `adb` and `scrcpy` can talk to a mirror running the ready-made image |

## What this means for you

Anyone with a USB cable plugged into a mirror that runs the ready-made image can control it. The image does not turn on `adb` over Wi-Fi (and it never authorized on the tested unit), so this is physical access only.

**Never use this key for anything else.** Do not authorize it on your phone, your other computers or any device you care about.

## How to use it

`adb` looks for its key in `%USERPROFILE%\.android\` (Windows) or `~/.android/` (macOS and Linux). To use the project key, you put it there. That **replaces your own key for every Android device you have authorized**, so back yours up first and put it back when you are done.

The exact PowerShell commands (back up, copy, restart `adb`, and how to undo it) are in the install guide: [step 4 of the install guide](../../../docs/mirror-app/install-android-lululemon-studio.md#4-use-the-project-adb-key-on-your-computer).

Pointing `adb` at the key with the `ADB_VENDOR_KEYS` setting instead of copying it did **not** work on the tested unit, so the guides do not use it.

Code scanners that flag "private key in repository" are right: it is a private key. This file explains why that is fine.
