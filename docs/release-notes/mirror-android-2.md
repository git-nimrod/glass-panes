## Mirror Android image 2 (for the Lululemon Studio RevP21)

Ready-made `system.img` and `userdata.sparse` for the Lululemon Studio mirror (board `MIR63A0-00-P1`, revision RevP21). Follow [part 1 of the install guide](https://github.com/git-nimrod/glass-panes/blob/main/docs/mirror-app/install-android-lululemon-studio.md).

> **This permanently replaces the lululemon software and cannot be undone.** No backup of the original can be taken first. Do not flash a mirror you still want to use as a Lululemon mirror.

### What changed since image 1

- **Fully dark sleep.** When Android puts the screen to sleep, the panel now switches off completely, with no faint backlight glow behind the glass. Waking it gives a clean picture again.
- Only `system.img` changed. `userdata.sparse` is the same file as in image 1.

Already on image 1? You only need the new `system.img`; the guide has update-only steps.

### Check your download first

Both fingerprints must match before you flash anything (PowerShell: `Get-FileHash .\system.img -Algorithm SHA256`):

```
bdb6b8445296666162256affa968d590075f56a8ad2229930f8502b9703e35c1  system.img
74b1f57ac20ce7c56065083a2bc3ddd283493be29d851fd04efc156ec96cf908  userdata.sparse
```

The same two lines are in the `SHA256SUMS` file attached below.

### What is in it

Android 6.0.1 for the Lululemon Studio mirror, with the Wi-Fi and camera support it needs, and the Glass Panes project ADB key.

### Security: one shared ADB key

These images trust a single published key, the Glass Panes project key. Anyone with a USB cable plugged into a mirror running them can control it. The image does not turn on `adb` over Wi-Fi, so this takes physical access.

### Licences and credit

The Android and kernel source keep their own licences. The vendor binaries (Qualcomm, Quectel) belong to their owners. This build stands on the work of the Lululemon-mirror community. Thank you to Onemoremichael, lrinQVQ, TimStewartJ, repairman29, porcuswine, vgab7 and everyone in the mirror-repurposing community. If you own any of this and want it changed or removed, please open an issue.

### Tested on

One unit: a RevP21. Sleep gave a fully dark panel and waking gave a clean picture, over two cycles. Other units and revisions are untested. Please tell us how yours goes with the "Report your mirror" issue form, and do not post your mirror's serial number.
