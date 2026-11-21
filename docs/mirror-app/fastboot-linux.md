# Fastboot from a Linux live USB (when Windows does not see the mirror)

[Part 1](install-android-lululemon-studio.md) flashes the mirror from Windows, which needs Google's USB driver for fastboot. If Windows never shows the mirror, or the driver will not install, use Linux instead: **Linux needs no driver for fastboot or adb.** You don't have to install Linux. A "live USB" runs it from a USB stick, and your computer's own disk is not touched.

The flashing commands are the same as on Windows. Only the setup around them differs.

> **Honest status:** the project's tested flash was done from Windows. These Linux steps use the same fastboot commands and standard Ubuntu tools, but have not yet been run end to end on a mirror by the project. If you do it, please [tell us how it went](https://github.com/git-nimrod/glass-panes/issues/new/choose).

> **Check your board first.** Everything in [part 1, step 0](install-android-lululemon-studio.md#step-0-make-sure-your-mirror-has-the-right-board) still applies, and so does the warning: flashing **permanently erases the lululemon software**.

## What you need

| | |
|---|---|
| A USB stick | 8 GB or bigger. It is **erased** when you write Ubuntu to it |
| Ubuntu | The **Ubuntu Desktop** download from [ubuntu.com/download/desktop](https://ubuntu.com/download/desktop) (an `.iso` file) |
| A way to write it | Ubuntu's own guide: [Create a bootable USB stick on Windows](https://ubuntu.com/tutorials/create-a-usb-stick-on-windows) (it uses Rufus) |
| A data micro-USB cable | Many cables only charge. This is the most common reason nothing shows up |
| The images | `system.img`, `userdata.sparse` and `SHA256SUMS` from the [`mirror-android-2` release](https://github.com/git-nimrod/glass-panes/releases/tag/mirror-android-2) |
| The project ADB key | `adbkey` and `adbkey.pub` from [`mirror-app/android/project-key/`](../../mirror-app/android/project-key/) |

## 1. Start Ubuntu from the USB stick

1. Write the Ubuntu `.iso` to the stick (the guide above).
2. Restart the computer and choose the USB stick in its boot menu. The key for that menu differs by maker: often **F12**, **F11**, **Esc** or **F9** right after power-on.
3. When Ubuntu asks, choose **Try Ubuntu** (not Install).
4. Connect to the internet (top-right corner of the screen).

Everything you do in a live session is gone after a restart, so do the whole job in one sitting.

## 2. Get fastboot, adb and scrcpy

Open a **Terminal** (press the Windows key, type `terminal`). Then:

```bash
sudo add-apt-repository -y universe
sudo apt update
sudo apt install -y adb fastboot scrcpy
```

`universe` is Ubuntu's community section, where these tools live; a live session can have it switched off. Check: `fastboot --version` prints a version number.

## 3. Download and check the images

Download the three files from the [`mirror-android-2` release](https://github.com/git-nimrod/glass-panes/releases/tag/mirror-android-2) with the web browser (they land in `Downloads`). Then:

```bash
cd ~/Downloads
sha256sum -c --ignore-missing SHA256SUMS
```

**Expected:** `system.img: OK` and `userdata.sparse: OK`. The fingerprints are also in [part 1, step 3](install-android-lululemon-studio.md#3-download-and-check-the-images). Anything other than `OK`: download again. Never flash a file that does not match.

## 4. Put the mirror in fastboot and find it

1. Connect the micro-USB cable, then put the mirror in fastboot: hold **VOL- (SW3)** at a cold power-on and keep holding for about 5 seconds ([part 1, step 1](install-android-lululemon-studio.md#1-open-the-mirror-and-find-the-buttons)). The glass stays black.
2. Run:

   ```bash
   lsusb
   ```

   **Expected:** a line with `18d1:d00d`. That is the mirror in fastboot. If there is no such line, the computer does not see the mirror at all: try another **data** cable and another USB port (preferably one directly on the computer, not a hub), then hold VOL- at a fresh cold power-on.
3. Run:

   ```bash
   sudo fastboot devices
   ```

   **Expected:** one line with a serial number and `fastboot`. (`sudo` gives fastboot permission to use the USB device; without it a live session may answer "no permissions".)
4. Check the board, one value at a time, and compare with [the RevP21 board page](board-revp21.md#recognise-it):

   ```bash
   sudo fastboot getvar product
   sudo fastboot getvar partition-size:system
   sudo fastboot getvar partition-size:userdata
   ```

   If they do not match, **stop**.

## 5. Flash

**Point of no return.** From the `Downloads` folder:

```bash
sudo fastboot flash system system.img
sudo fastboot -S 0 flash userdata userdata.sparse
sudo fastboot reboot
```

- `system.img` goes in 4 chunks, about 82 seconds, all `OKAY`. Do **not** use `-S` on it.
- `userdata` must be sent whole (`-S 0`).

## 6. Use the project ADB key, then set the mirror up

Download `adbkey` and `adbkey.pub` (above) into `Downloads`, then:

```bash
mkdir -p ~/.android
cp ~/Downloads/adbkey ~/Downloads/adbkey.pub ~/.android/
chmod 600 ~/.android/adbkey
adb kill-server
sudo HOME="$HOME" adb start-server
```

The last line starts adb with permission to use USB while it still reads **your** key folder; after that, plain `adb` commands work. This is a live session, so the key is gone after a restart: nothing to put back.

About 3 to 5 minutes after the reboot:

```bash
adb devices -l
```

**Expected:** the mirror listed as `device`. `unauthorized` means adb is not using the project key: repeat the lines above. Then carry on exactly as in [part 1, step 6](install-android-lululemon-studio.md#6-first-boot-then-set-up-with-scrcpy): run `scrcpy` to click through Settings and join Wi-Fi, and run the same `adb shell settings ...` commands (they are also on [the board page](board-revp21.md#the-exact-commands)).

## If something goes wrong

- **No `18d1:d00d` in `lsusb`:** the cable (most often), the USB port, or the mirror is not in fastboot (hold VOL- at a **cold** power-on).
- **`fastboot devices` prints nothing but `lsusb` shows the mirror:** run it with `sudo`.
- **`adb devices` says "no permissions":** run `adb kill-server`, then `sudo HOME="$HOME" adb start-server`.
- **Stuck before Android boots:** back to fastboot and flash again. You can rewrite `system` and `userdata` as often as you like.

## Next

[Part 2: install the Glass Panes app](install-app-lululemon-studio.md). Its `adb` commands work the same here; where it shows a Windows PowerShell line (copying or checking a file), use the Linux equivalent (`cp`, `sha256sum`), or finish part 2 from Windows once the mirror runs Android.
