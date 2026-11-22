# Board page: `MIR63A0-00-P1` RevP21 (Qualcomm MSM8916)

One page per board revision: how to recognise it, what works on it with Glass Panes, and the exact commands. This is the board the project's ready-made Android images and the Mirror Kiosk app are tested on (one unit, stock software 1.25.0). Other revisions and what people reported for them are in [Which mirrors work](../compatibility.md#which-mirrors-work).

## Recognise it

| Where | What it says on the tested unit |
|---|---|
| Back sticker, near the power input | FCC ID `2AOSD-RLSYM1R0` (a sticker reading "Contains: FCC ID `VPYLBEE5HY1MW`" is the newer NXP board: **not this page, and these images will not work on it**) |
| Main board, near the micro-USB and Ethernet end | `MIR63A0-00-P1`, `PCA#500240 RevP21` (the "FW AD V1.01" sticker is not the board id) |
| `fastboot getvar product` | `MSM8916` |
| `fastboot getvar secure` | `yes` (locked bootloader) |
| `fastboot getvar max-download-size` | 256 MiB |
| `fastboot getvar partition-size:system` | 1,288,491,008 bytes |
| `fastboot getvar partition-size:userdata` | 5,583,458,304 bytes |

`getvar all` prints nothing on this bootloader: ask for each value on its own. fastboot may print the numbers in hex. If a partition size differs, **stop and open an issue** before you flash. More in [the hardware page](hardware.md#what-the-bootloader-reports).

## What works

With the `mirror-android-2` images and the Mirror Kiosk app, on the tested unit:

| | |
|---|---|
| Android 6.0.1 (API 23, 64-bit ARM) | Boots; the first boot takes about 5 minutes |
| Screen | 1080 x 1920 portrait (the panel is landscape-native; the rotation is set once, below) |
| Backlight | Glass Panes' Brightness control works. Android refuses a level below about 4 %, so 0 means "as dark as it goes" |
| Sleep | Fully dark: the panel switches off with no backlight glow (the older `mirror-android-1` images left a faint glow) |
| Wi-Fi | Connects by itself, about 2.5 minutes after a cold power-on (the first try fails once) |
| Glass Panes player | Loads and runs in the app |
| Camera presence | Works (numbers only, never pictures) |
| Video | Played natively by the app above the page |
| Speaker | Plays audio through the app |
| `adb` over USB | Works with the project key (micro-USB, data cable) |

What does **not** work, or is limited:

| | |
|---|---|
| Touch | The mirror's own touch screen is not usable. Set it up with `scrcpy` over USB |
| `adb` over Wi-Fi | Never authorized on this unit with `mirror-android-2` |
| Time zone | Stuck on UTC. Glass Panes shows your Home Assistant's time zone, so you don't need to change it |
| A soft reboot | Can leave stripes in thin text. A full power cut fixes it, and the app turns off the display feature that causes it |
| Root | None (`adb` runs as the `shell` user) |
| The bootloader | Locked. It refuses reads (no backup of the original software is possible) and accepts writes to `system` and `userdata` only. There is no way back to the lululemon software |
| Turning it fully off | Needs a smart plug; the app cannot power the board down |

## Buttons and modes

| Hold at a cold power-on (wall power cut, then back) | What happens |
|---|---|
| **VOL- (SW3)** | Fastboot. The glass stays black; your computer sees a device with USB id `18d1:d00d` |
| VOL+ (SW1) | The lululemon update screen, then a reboot by itself. A dead end |
| Both | Qualcomm EDL mode. **Avoid** |

The two buttons are next to the "FW AD V1.01" sticker. Hold VOL- for about 5 seconds after the power comes on. Never connect anything to the UART pins (1.8 V logic).

## The exact commands

Full explanations are in [part 1: install Android](install-android-lululemon-studio.md) (Windows) and [fastboot on Linux](fastboot-linux.md) (when Windows does not see the mirror). On Linux, put `sudo` in front of `fastboot` if it says "no permissions".

**1. Check the board in fastboot, before anything else:**

```bash
fastboot devices
fastboot getvar product
fastboot getvar secure
fastboot getvar partition-size:system
fastboot getvar partition-size:userdata
```

**2. Check the image files** (`system.img`, `userdata.sparse` and `SHA256SUMS` from the [`mirror-android-3` release](https://github.com/git-nimrod/glass-panes/releases/tag/mirror-android-3)). Both must match `SHA256SUMS`. The [installer](install-android-lululemon-studio.md#4-run-the-installer) checks this for you, puts in your own adb key and does steps 3 to 5 below by itself.

**3. By hand only: use the project ADB key** ([Install by hand](install-android-lululemon-studio.md#install-by-hand)).

**4. Flash** (this permanently erases the lululemon software):

```bash
fastboot flash system system.img
fastboot -S 0 flash userdata userdata.sparse
fastboot reboot
```

`system.img` goes in 4 chunks, about 82 seconds, without `-S`. `userdata` must be sent whole (`-S 0`).

**5. First boot.** With `mirror-android-3` the screen already stays on, the picture is upright and the app is built in: join Wi-Fi and pair the mirror as in [Install by hand](install-android-lululemon-studio.md#install-by-hand), steps 4 and 5. **Images 1 and 2 only** needed these settings (about 3 to 5 minutes after the reboot, when `adb devices -l` lists the mirror as `device`):

```bash
adb shell settings put global stay_on_while_plugged_in 7
adb shell settings put system screen_off_timeout 2147483647
adb shell input keyevent 82
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 3
```

Use `user_rotation 1` instead of `3` if the picture comes out upside down. Join Wi-Fi in Settings with `scrcpy`, then go on to [part 2: install the Glass Panes app](install-app-lululemon-studio.md).

**Updating `system` only** (from image 1 to image 2; it keeps the app, its settings, Wi-Fi and the key). Going to image 3 is a fresh install with the installer, because its userdata changed:

```bash
adb reboot bootloader
fastboot flash system system.img
fastboot reboot
```

**Sleep and wake from a computer:** `adb shell input keyevent 223` (sleep) and `adb shell input keyevent 224` (wake). From Home Assistant, use the display's **Screen** switch instead (Mirror Kiosk app 0.13.0 and later; fully dark on the tested unit).

## Reports

Tried this board with a different stock software version, or a different revision? Use the **Report your mirror** form on [GitHub Issues](https://github.com/git-nimrod/glass-panes/issues/new/choose) so this page and [Which mirrors work](../compatibility.md#which-mirrors-work) can say what worked where. Don't post your mirror's serial number.
