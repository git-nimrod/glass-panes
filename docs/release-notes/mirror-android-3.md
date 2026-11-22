## Mirror Android image 3 (for the Lululemon Studio RevP21)

This is the third ready-made Android image for the Lululemon Studio mirror (board `MIR63A0-00-P1`, revision RevP21). The big change is that **the Glass Panes Mirror app 0.13.0 is built in**. A freshly flashed mirror starts straight into Glass Panes, joins your Wi-Fi and shows its pairing code, with no taps, no `scrcpy` and no extra `adb` steps. It's also the first image that **trusts your own computer's adb key** instead of one shared key.

> [!CAUTION]
> **This permanently replaces the lululemon software and can't be undone.** There's no way to back up the original first. Don't flash a mirror you still want to use as a Lululemon mirror.

### What changed since image 2

**The app is built in**
- Mirror app **0.13.0** is part of the system and signed with the project's release key, so later app releases install over it, including **from Home Assistant's update entity**, with no cable.
- It's the only home screen. The stock launcher is gone, so you won't get a "which home screen" prompt.
- **Camera, microphone and location are granted on first boot.** They're needed for presence, voice and Bluetooth scanning, and you can still take them away in Android's settings.
- Android keeps the app running and restarts it if it ever stops.
- The app turns on its own screen-off permission, so Home Assistant's **Screen** switch and **quiet hours** work right away.

**Your own adb key, set up by the installer**
- The new **installer** (`install-mirror.ps1`, Windows PowerShell) writes **your** computer's adb public key into your copy of `userdata.sparse` before flashing. The mirror only trusts that key, so a different computer's key gets refused. You don't need the shared project key from images 1 and 2 anymore.
- **Wi-Fi from the installer:** `-WifiSsid "Your network"` asks for the password on screen and gives it to the mirror after the first boot. The password isn't saved anywhere.
- **First boot with no taps:** Android's first-run screens are skipped, the screen stays on, the picture is portrait, and the Glass Panes boot animation plays.
- **adb over the network, if you want it:** `-NetworkAdb` turns on adb over Wi-Fi (port 5555) and keeps it on across restarts. It stays **off** unless you ask for it.

**Lighter**
- About 30 apps nobody uses on a mirror (wallpapers, demos, calculator, email, test tools and so on) and some idle background services are left out. That saves storage, but memory use is about the same.

### Check your download first

> [!WARNING]
> Both fingerprints have to match before you flash anything. In PowerShell: `Get-FileHash .\system.img -Algorithm SHA256`

```
bd7f2e33599a2ceaac5e442fabcadf9a0aa5b31f3be4db2d2e1303711f4bec19  system.img
81eb5648ec0b5ed13d520e90c597c9ff50f3ea57524e9d9554c2a71dc94c521d  userdata.sparse
```

The same lines are in the `SHA256SUMS` file attached below, next to `install-mirror.ps1`. The installer checks both for you before it flashes.

### Install

Follow [part 1 of the install guide](https://github.com/git-nimrod/glass-panes/blob/main/docs/mirror-app/install-android-lululemon-studio.md). The short version: with the mirror in fastboot and the USB cable in, run

```
.\install-mirror.ps1 -ImageDir C:\mirror-android-3 -WifiSsid "Your network"
```

Type **FLASH** when it asks. The mirror gets erased, flashed and set up. Then pair it in Home Assistant: Glass Panes > Mirrors > Add mirror > Pair with a code.

> [!NOTE]
> **Coming from image 1 or 2?** This is a fresh install. It erases the mirror's data, so you'll need to pair it again afterwards.

### Security

- Only **your** adb key is trusted over USB, so anyone on a different computer gets refused.
- adb over the network is off unless you choose `-NetworkAdb`. If you turn it on, anyone on your home network who has your key's computer can reach it.
- Until it's paired, the app only answers pairing and status requests from the network.

### Tested on

<details>
<summary>One unit, a RevP21</summary>

<br>

- a fresh flash to the pairing code with no taps;
- Wi-Fi from the installer;
- the built-in app with its permissions granted;
- the screen fully off and on from Home Assistant;
- pairing;
- voice, wake word and Bluetooth proxy;
- 270 MB of memory free with everything on.

</details>

Other units and revisions haven't been tested. Please tell us how yours goes with the "Report your mirror" issue form, and don't post your mirror's serial number.

### Known limits

- **Graphics process:** turning off the browser engine's separate graphics process saves memory, but it causes weird visual artifacts on this panel, so it stays on.
- **Recovery:** image updates still go through fastboot. The mirror's recovery is lululemon's and it's signed, and the bootloader is locked, so Home Assistant can update the **app** but not the **image**.

### Licenses and credit

The Android and kernel source keep their own licenses, and the vendor binaries (Qualcomm, Quectel) belong to their owners. This build stands on the work of the Lululemon-mirror community, so a big thank you to Onemoremichael, lrinQVQ, TimStewartJ, repairman29, porcuswine, vgab7 and everyone else in the mirror-repurposing community. If you own any of this and want it changed or removed, please open an issue.
