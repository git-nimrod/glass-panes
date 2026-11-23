# Lululemon Studio mirror, part 1: install Android

This guide puts Glass Panes on a **Lululemon Studio mirror** ("Model One", formerly Mirror.co). It replaces the mirror's own software with Android 6.0.1 and the Glass Panes Mirror app, using the `mirror-android-3` image.

The whole job in one line: **put the mirror in fastboot, run the installer, then pair the mirror in Home Assistant.** The installer checks the download, makes the mirror trust your computer's own adb key, flashes it, joins your Wi-Fi and shows the pairing code. There's nothing to build and nothing to tap on the mirror. Fastboot is a special mode of the mirror's bootloader in which it waits for your computer to send it files.

With `mirror-android-3` the app is built in, so you **don't need part 2**. [Part 2: install the app](install-app-lululemon-studio.md) is only for mirrors still on images 1 or 2.

> [!CAUTION]
> **There is no way back.** This **permanently erases the lululemon software**. You can't take a backup first, because the bootloader refuses reads. Don't do this to a mirror you still want to use as a Lululemon mirror.

> [!NOTE]
> **Tested on:** one unit. Board `MIR63A0-00-P1` (sticker reads `PCA#500240 RevP21`), stock software 1.25.0, flashed from Windows 11. Other boards and firmware versions are listed in [Which mirrors work](../compatibility.md#which-mirrors-work), and we'd love your report for yours.

> **Credit.** This path exists because of the Lululemon-mirror community, who worked out how to run Android on this hardware. Thank you to Onemoremichael, lrinQVQ, TimStewartJ, repairman29, porcuswine, vgab7 and everyone else in those threads.

## Step 0: make sure your mirror has the right board

**Do this before you buy, open or flash anything.** These images are built for the Qualcomm **MSM8916** board (`MIR63A0-00-P1`, tested on RevP21). Other owners report that some newer mirrors use a different NXP-based board (i.MX8M Mini). That needs different Android software with different partitions and drivers, **and these images will not work on it**. We have not tested one, and flashing the wrong image can leave a mirror that will not start.

- **Sticker on the main board** (near the micro-USB and Ethernet end): `MIR63A0-00-P1`, ideally `RevP21`. Anything else, stop here and [tell us what yours says](https://github.com/git-nimrod/glass-panes/issues/new/choose).
- **The FCC ID on the back sticker** (near where the power cable goes in): `2AOSD-RLSYM1R0` is the board these images are for. If the sticker says **"Contains: FCC ID `VPYLBEE5HY1MW`"** it is the newer NXP board, and these images will not work. Community projects exist for that board: see [Other boards and write-ups](../compatibility.md#other-boards-and-write-ups).
- **In fastboot** (step 1 below), `fastboot getvar product` must print `MSM8916`, and the partition sizes must match [the hardware page](hardware.md#what-the-bootloader-reports). `getvar all` prints nothing on this bootloader, so ask for each value one at a time. If they don't match, **don't flash**.
- **Optional, helps your report:** note which stock software version the mirror started on. On a mirror that is still set up for someone else's Wi-Fi, join the Wi-Fi hotspot it makes, then open that network's gateway address (the one ending in `.1`, which your computer shows for the connection) on port `8080` in a browser. That showed the version on one unit, and it may not work on yours.

Rough guide, not a promise: older units seem more likely to be the tested Qualcomm board, and later-production units are the ones to be careful with. The sticker is the real answer.

## What you need

| | |
|---|---|
| A mirror | Model One with the **MIR63A0-00-P1 RevP21** board. The sticker is on the main board near the micro-USB and Ethernet end. (The "FW AD V1.01" sticker is **not** the board id.) RevP18, RevP19 and RevP20 units on newer stock software have also worked (see [which mirrors work](../compatibility.md#which-mirrors-work)) |
| Cable and computer | A **data** micro-USB cable (many cables only charge) and a Windows computer with Google's `platform-tools` (`adb` and `fastboot`) on its PATH. [scrcpy](https://github.com/Genymobile/scrcpy) is optional: it's handy for seeing the screen, but the installer doesn't need it |
| The files | `system.img`, `userdata.sparse`, `SHA256SUMS` and `install-mirror.ps1` from the [`mirror-android-3` release](https://github.com/git-nimrod/glass-panes/releases/tag/mirror-android-3) |
| Home Assistant | Glass Panes v0.13.0 or newer, for pairing at the end |
| Time | About an hour, most of it opening the mirror. The first boot after flashing takes about 5 minutes |

## 1. Open the mirror and find the buttons

You only need this step for the first flash from lululemon's software. Nothing here changes the mirror yet.

1. Open the case. On some units a rear service hatch gives access to the board.
2. Find the two small buttons next to the "FW AD V1.01" sticker: **SW3 = VOL-** and **SW1 = VOL+**. The power button is a separate lone button near the camera connector.
3. Power comes from the wall through a power-supply board into the main board's 24 V connector. The micro-USB port is **data only**. It does not power the mirror.

| Hold at cold power-on | What happens |
|---|---|
| **VOL- (SW3)** | **Fastboot.** This is the one you want. The glass stays black in fastboot, and that is normal |
| VOL+ (SW1) | The lululemon update screen ("Update Complete!" with a checkmark, no menu), then it reboots by itself. A dead end |
| **Both** | Qualcomm EDL mode. **Avoid.** Generic programmers are rejected by the maker's secure boot |

A **cold boot** means cutting wall power. A trick that works: plug the mirror into a **switched power strip**, hold VOL- with a toothpick, switch the strip on, and keep holding for about 5 seconds.

**How to tell you are in fastboot.** The screen stays completely black, so you can't see it. Use the computer instead: hold VOL- while the power comes on and **keep holding for about 5 seconds**. You don't need to restart afterwards. On Windows, Device Manager then shows an unknown **"Android"** device (step 2). On a Mac (the tested path is Windows, so this is unverified), run `system_profiler SPUSBDataType` while you are still holding: an **"Android"** entry with vendor `0x18d1` and product `0xd00d` means fastboot, and `fastboot devices` should list it. If nothing shows up at all, the **cable** is the most likely cause (see step 2).

**Never connect anything to the UART pins** (header P1 and the pads near the audio header). They are **1.8 V logic, and the adapter's VCC must never be connected**. You don't need UART for this guide.

## 2. Get Windows to see fastboot

1. Connect the micro-USB cable and boot the mirror into fastboot (step 1).
2. In **Device Manager**, fastboot first appears as an unknown **"Android"** device with an error (`USB\VID_18D1&PID_D00D`).
3. Install the driver. In Android Studio, open **SDK Manager > SDK Tools**, tick **Google USB Driver** and install it. Then in **Device Manager**, right-click the device and choose **Update driver > Browse my computer > Let me pick > Have Disk**. Type the **full literal path** to `...\Android\Sdk\extras\google\usb_driver` (the variable `%LOCALAPPDATA%` does **not** expand there). Choose **Android Bootloader Interface**.
4. Reports differ about **Zadig with the WinUSB driver**: one owner of the same board said it works, another said it didn't and the Google driver did. Use the Google driver first.
5. Use a **normal (non-admin)** terminal and run `fastboot devices`. **Expected:** it lists the mirror.
6. **If nothing is listed at all**, and Device Manager shows no new device (on a Mac, `system_profiler` shows nothing), the usual cause is the **cable**. It has to be a micro-USB **data** cable, and many are charge-only. One owner went through four before one worked. Try a different cable and a different USB port before anything else.
7. **Windows still won't see it, or the driver won't install?** Use a Linux live USB instead: Linux needs no driver for fastboot. See [Fastboot from a Linux live USB](fastboot-linux.md). The installer is Windows-only, so on Linux you install [by hand](#install-by-hand).

## 3. Download the files

Download `system.img`, `userdata.sparse`, `SHA256SUMS` and `install-mirror.ps1` from the [`mirror-android-3` release](https://github.com/git-nimrod/glass-panes/releases/tag/mirror-android-3) into one folder, for example `C:\mirror-android-3`.

You don't have to check the fingerprints yourself: the installer compares both images with `SHA256SUMS` and stops if either one doesn't match. The same fingerprints are on the release page if you want to look.

## 4. Run the installer

1. Open **Windows PowerShell** in that folder (in File Explorer, click the address bar, type `powershell` and press Enter).
2. Windows blocks scripts downloaded from the internet. Let this one run:

   ```powershell
   Unblock-File .\install-mirror.ps1
   ```

   If PowerShell still says running scripts is disabled, start it this way instead, for this one run only:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-mirror.ps1 -ImageDir C:\mirror-android-3 -WifiSsid "Your network"
   ```

3. Put the mirror in fastboot (step 1) with the USB cable connected, and run:

   ```powershell
   .\install-mirror.ps1 -ImageDir C:\mirror-android-3 -WifiSsid "Your network"
   ```

4. It asks for your Wi-Fi password (leave it empty for an open network). The password goes to the mirror over the cable and into Android's own Wi-Fi settings. The installer doesn't save it anywhere.
5. When it asks, type **FLASH**. That is the **point of no return**: the lululemon software is erased.

What it does, in order:

1. Checks that `adb` and `fastboot` are on your PATH.
2. Checks both images against `SHA256SUMS`.
3. Reads **your** adb public key (`%USERPROFILE%\.android\adbkey.pub`; it makes one if you've never used `adb`) and writes it into a **copy** of the userdata image, `userdata-yours.sparse`. Your download isn't changed, and your private key never leaves your computer.
4. Flashes `system.img` and your userdata, then restarts the mirror.
5. Waits for the first boot (up to about 5 minutes), then finishes the setup over the cable: it confirms the app is built in, allows the camera, microphone and location, gets the screen-off switch ready and joins your Wi-Fi.
6. Prints the mirror's address. The mirror shows its six-digit pairing code.

Want to see it work before anything touches the mirror? Run it with `-NoFlash` first: it checks the files and writes `userdata-yours.sparse`, then stops.

| Option | What it does |
|---|---|
| `-ImageDir <folder>` | The folder with the downloaded files |
| `-WifiSsid "<name>"` | The Wi-Fi network the mirror should join. You're asked for the password |
| `-WifiHidden` | The network doesn't show its name |
| `-NetworkAdb` | Turns on adb over the network (port 5555), kept on across restarts. Off unless you ask. It's set before flashing, so changing it later means running the installer again, which erases the mirror |
| `-NoFlash` | Only checks the files and makes `userdata-yours.sparse`. Nothing is sent to the mirror |
| `-SetupOnly` | Doesn't flash. Only runs the after-boot setup on a mirror that's already running and plugged in, for example to change the Wi-Fi |
| `-KeyPub <file>` | Use a different adb public key than `%USERPROFILE%\.android\adbkey.pub` |

> [!IMPORTANT]
> The mirror trusts **only the computer that ran the installer**. A different computer's adb key is refused. To control the mirror from another computer later, run the installer again from that computer (which erases the mirror), or copy your `.android\adbkey` and `adbkey.pub` to it. Keep `adbkey` private.

## 5. Pair it in Home Assistant

In Home Assistant, open **Glass Panes** in the sidebar, then **Mirrors > Add mirror > Pair with a code**. Type the six-digit code from the mirror's screen and the address the installer printed. Home Assistant sets the mirror up, including its login.

That's it. App updates now come from Home Assistant: the mirror's **Mirror app** update entity installs them, with no cable.

## What to expect

- **The first boot is slow:** about 5 minutes before the pairing code shows.
- **The picture is already upright** and the screen stays on. There's no lock screen and no "which home screen" prompt.
- **Wi-Fi after a cold power-on** can take a couple of minutes. The first attempt can fail once, then Android tries again by itself.
- **A soft reboot can leave stripes in the text.** A full power cut fixes it. The Glass Panes app also turns off the display feature that causes it.
- **The timezone is stuck on UTC.** Glass Panes shows your Home Assistant's timezone, so you don't need to change it.
- **The screen goes fully dark** with Home Assistant's **Screen** switch or quiet hours, with no backlight glow. A smart plug is still the way to cut power entirely.
- **adb over the network** only works if you chose `-NetworkAdb`. Unplug the USB cable first: while USB is connected, Android gives the approval to USB and the network shows `unauthorized`. "failed to authenticate" before `device` is normal.
- There is **no root** (`adb` runs as the `shell` user).

## Install by hand

Use this on Linux, or if you'd rather not run the installer. Flashed by hand, the image trusts the shared **Glass Panes project key** instead of yours, so your computer has to use that key.

**1. Check the files.** In PowerShell, run `Get-FileHash .\system.img -Algorithm SHA256` and the same for `userdata.sparse`, and compare both with `SHA256SUMS`. On Linux: `sha256sum -c --ignore-missing SHA256SUMS`. If either one is different, stop and download it again.

**2. Use the project ADB key.** `adb` finds its key in `%USERPROFILE%\.android\`. Putting the project key there **replaces your own key for every Android device you have authorized**, so save yours first and put it back when you are done.

1. Download `adbkey` and `adbkey.pub` from [`mirror-app/android/project-key/`](../../mirror-app/android/project-key/) into a folder, for example `C:\gp-key`.
2. In PowerShell, **save your own key**, then copy the project key over it:

   ```powershell
   Copy-Item "$env:USERPROFILE\.android\adbkey" "$env:USERPROFILE\.android\adbkey.mine"
   Copy-Item "$env:USERPROFILE\.android\adbkey.pub" "$env:USERPROFILE\.android\adbkey.pub.mine"
   Copy-Item "C:\gp-key\adbkey" "$env:USERPROFILE\.android\adbkey" -Force
   Copy-Item "C:\gp-key\adbkey.pub" "$env:USERPROFILE\.android\adbkey.pub" -Force
   adb kill-server
   ```

   If you have never used `adb` before, there is no key of yours to save, and the first two lines will say the file is missing. That is fine.

**What this means:** the project key is public. Anyone who plugs a USB cable into a mirror flashed this way can control it. adb over the network is off, so it takes physical access. The installer avoids this by putting your own key in instead.

**To put your own key back later:** copy the two `.mine` files back over `adbkey` and `adbkey.pub`, then run `adb kill-server`.

**3. Flash.** With the mirror in fastboot, from the folder that holds the files:

```bash
fastboot flash system system.img
fastboot -S 0 flash userdata userdata.sparse
fastboot reboot
```

- `system.img` is sparse, and fastboot splits it itself. Do **not** use `-S` on it.
- `userdata` **must be sent whole** (`-S 0`).
- The locked bootloader accepts writes to `system` and `userdata` only. That is normal.

**4. Join Wi-Fi.** About 5 minutes after the reboot, `adb devices -l` should list the mirror as `device` (`unauthorized` means your computer isn't using the project key: check step 2 and that you ran `adb kill-server`). Then give the app your network (it adds it to Android's Wi-Fi settings):

```bash
adb shell "am start -n com.nimrod.mirrorkiosk/.MainActivity --es wifi_ssid 'Your network' --es wifi_pass 'Your password'"
```

This puts the password in your terminal's history, so clear that afterwards if you share the computer. Or join the network with scrcpy in Android's Settings instead.

**5. Pair it** as in [step 5](#5-pair-it-in-home-assistant).

## Coming from `mirror-android-1` or `mirror-android-2`

Image 3 is a **fresh install**: its userdata carries your own adb key and the network adb setting, so it has to be flashed too, and that **erases the mirror's data** (the app's settings and your Wi-Fi).

1. With the mirror running and plugged in by USB, put it in fastboot without opening it: `adb reboot bootloader`. After about 10 seconds, `fastboot devices` should list it. (This worked on the tested unit. If nothing is listed and the mirror boots normally, use VOL- at a cold power-on as in step 1.)
2. If your computer is still using the project key from the old guide, put your own key back first (copy the `.mine` files back, then `adb kill-server`). The installer refuses to use the project key as "yours".
3. Run the installer (step 4), then pair the mirror again (step 5). Your panes and displays in Home Assistant are kept.

## If something goes wrong

- **Stuck before Android boots:** put the mirror back in fastboot (VOL- at cold power-on) and run the installer again. You can rewrite `system` and `userdata` as often as you like.
- **Fastboot isn't found:** repeat step 2 (the driver), and try another **cable** and USB port.
- **"does not match its published SHA-256":** download that file again. Never flash a file that doesn't match.
- **"IS the shared project key":** your computer is still using the project key from images 1 and 2. Put your own key back (the `.mine` files) and run it again.
- **"more than one device is plugged in by USB":** unplug the other Android devices, then run `.\install-mirror.ps1 -SetupOnly`.
- **Android didn't finish starting, or no mirror in `adb devices`:** wait the full 5 minutes, check the cable and USB port, then run `.\install-mirror.ps1 -SetupOnly`.
- **The mirror didn't join Wi-Fi:** check the name and password, then run `.\install-mirror.ps1 -SetupOnly -WifiSsid "Your network"`.
- **Still stuck:** open an issue and say which board revision and software version you have.

Please report results for other board revisions or firmware in a Glass Panes issue, so this page can say what worked where. Don't post your mirror's serial number.

## Next

Pair the mirror (step 5) and start building panes: see [Getting started](../getting-started.md). [Part 2](install-app-lululemon-studio.md) is only for mirrors on images 1 or 2.
