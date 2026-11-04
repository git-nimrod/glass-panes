# Lululemon Studio mirror: hardware notes

Glass Panes is built for the **Lululemon Studio mirror** ("Model One", formerly Mirror.co). The Mirror Kiosk app runs on a mirror that already has the replacement Android 6.0.1 from [part 1](install-android-lululemon-studio.md).

This page says what the app was tested on and how to tell which board you have. For the list of boards and firmware versions people have tried, see [Which mirrors work](../compatibility.md#which-mirrors-work).

## What it was built and tested on

| | |
|---|---|
| Mirror | Lululemon Studio "Model One", rotated to portrait |
| Board | `MIR63A0-00-P1`, sticker reads `PCA#500240 RevP21` |
| Stock software | 1.25.0 |
| Chipset | Qualcomm MSM8916 |
| Memory | about 950 MB of RAM |
| Android | 6.0.1 (API 23), 64-bit ARM |
| Screen | 1080 x 1920 portrait (the panel is landscape-native and rotated) |
| Connection | micro-USB for `adb`. `adb` over Wi-Fi was not usable on this unit |

Other boards and firmware versions are untested by the project. If you try one, please tell us how it went. There is an issue form for it ([Report your mirror](https://github.com/git-nimrod/glass-panes/issues/new/choose)).

## Which board do I have?

Look for the sticker on the main board, near the micro-USB and Ethernet end. It reads like `MIR63A0-00-P1` followed by a revision (`RevP21`). The "FW AD V1.01" sticker is **not** the board id. The stock software version is in the mirror's original settings (for example `1.25.0`).

## What the bootloader reports

On the tested unit, `fastboot getvar <name>` returned these. Run the same on your mirror and compare **before you flash**. `getvar all` prints nothing on this bootloader, so ask for one value at a time.

| Value | Tested unit |
|---|---|
| `product` | MSM8916 |
| `secure` | yes |
| Unlocked / tampered | `false` / `false` (the bootloader is locked) |
| `max-download-size` | 256 MiB |
| `partition-size:system` | 1,288,491,008 bytes |
| `partition-size:userdata` | 5,583,458,304 bytes |

The ready-made images were made for these sizes. If your mirror reports a different `partition-size:userdata` or `partition-size:system`, **stop and open an issue** before you flash. fastboot may print the numbers in hex.

The locked bootloader refuses reads (no backups, no partition dumps) and accepts writes to `system` and `userdata` only. That is why there is no way back to the original software.

## Order of operations

1. [Part 1: install Android](install-android-lululemon-studio.md). This is the risky step, and it permanently removes the lululemon software.
2. Check that `adb devices` lists the mirror.
3. [Part 2: install the Glass Panes app](install-app-lululemon-studio.md).

If you only want to try panes in a browser first, you can skip the mirror guides for now.
