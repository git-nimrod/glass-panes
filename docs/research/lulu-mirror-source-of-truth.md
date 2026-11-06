# Lululemon Mirror — Hardware Hacking Source of Truth

*2026-11-06 · compiled by Noah*

A consolidated, independent reference for repurposing/rooting the Lululemon Mirror, pulled together from GitHub, XDA, and Reddit reports. At least three distinct hardware generations exist — identify yours before following any guide.

## Overview

This doc exists so effort stops being re-derived from scratch across GitHub, XDA, and Reddit threads that don't reference each other. The single most important fact: **at least three distinct hardware generations** ship under the "Lululemon Mirror" name, with incompatible unlock paths. A guide written for one will fail, sometimes misleadingly, on another.

Sources consolidated here: [Onemoremichael/lulu-mirror-software-only](https://github.com/Onemoremichael/lulu-mirror-software-only) and [porcuswine's fork](https://github.com/porcuswine/lulu-mirror-software-only), the XDA thread ["Lululemon Mirror"](https://xdaforums.com/t/lululemon-mirror.4752046/), and two Reddit threads in r/hardwarehacking ("Lulu Lemon Mirror Rooting Megathread" and "Lululemon Studio Mirror"), plus published vulnerability research cited in context.

**Before following any report here**: confirm the reporter's hardware family and firmware version match yours (Step 0, below). Treat "it worked for me" as tied to that specific family and firmware build, never as universal.

## Step 0: identify your hardware family

Run this first, every time, for yourself and for anyone asking for help:

```
fastboot devices -l
fastboot getvar product
fastboot getvar all
```

Also record the board silkscreen/label, a UART boot log if you have a serial adapter, and the display panel model if visible.

| Tell | Family A — Qualcomm | Family B — NXP | Family C — unresolved |
| --- | --- | --- | --- |
| `fastboot getvar product` | `MSM8916` | `NXP i.MX` | unknown |
| Board label | `MIR63A0-00-P1 / PCA#500240 RevP18/20/21...` | unlabeled in reports so far | pre-Lululemon unit, Samsung `LTI400HN01` panel |
| UART boot strings | `welcome to lk`, `CDT version`, `androidboot.hardware=qcom` | `U-Boot SPL`, `DDRINFO:`, `initializing trusty` | not yet documented |
| Android version | 6.0.1 | 10 | unknown |
| Boot chain | PBL→SBL1→LK→Kernel, Qualcomm secure boot | ROM→SPL→ATF→Trusty→AVB, NXP HAB (High-Assurance Boot) | unknown |
| `secure`/`unlocked` (fastboot) | `secure: yes`, `unlocked: no` | `secure:yes`, `unlocked:no` | unknown |

## Family A — Qualcomm APQ8016/MSM8916 ("Inforce 6309" / "MIR63A0" board)

Compute module assembly `ASSY_003101_REVP1` has been independently reported on both a bare Inforce 6309 board (Reddit) and a RevP21 carrier board (GitHub) — the carrier-board revision number (RevP18/20/21...) and the underlying SOM may be the same part across multiple cosmetic revisions, which is why partition geometry and `secure`/`unlocked` values match across all of them; only stock firmware version differs per unit, not by revision number.

**Known community resources:**
- [Onemoremichael/lulu-mirror-software-only](https://github.com/Onemoremichael/lulu-mirror-software-only) — `mirror.py` build/recovery tooling; currently hard-codes its board allowlist to `mir63a0-revp21` only (`recovery/cli.py`, `recovery/device.py`) — RevP18/RevP20 units need this extended once gate-reads are confirmed identical
- [porcuswine's RevP18 fork](https://github.com/porcuswine/lulu-mirror-software-only) — stock-ADB-via-userdata-injection procedure; worked on older firmware (`1.14.2`), does **not** reliably reproduce on newer firmware (`1.2x`) — don't keep re-trying it as-is there
- GitHub issues [#15](https://github.com/Onemoremichael/lulu-mirror-software-only/issues/15) (RevP20) and [#11](https://github.com/Onemoremichael/lulu-mirror-software-only/issues/11) (RevP21) — board reports, and a full-custom-AOSP-build success path, gated behind the board allowlist above
- [bkerler/edl](https://github.com/bkerler/edl) — open-source Sahara/Firehose EDL tool; blocked here, as everywhere else on this family, by the lack of a signed Inforce firehose loader
- FCC filing `2ADCSIFC6309X`: [fccid.io user manual](https://fccid.io/2ADCSIFC6309X/User-Manual/User-Manual-4083638) (also mirrored at [fcc.report](https://fcc.report/FCC-ID/2ADCSIFC6309X/4083638.pdf)), and [ManualsLib's Inforce 6309 manual](https://www.manualslib.com/manual/1589237/Inforce-6309.html) — public docs for headers/pinout/boot-mode DIP switches

**Current blocker:** EDL is reachable, but Qualcomm's image verification rejects any firehose loader not signed with Inforce's key ("not even a Firehose loader" / no public Firehose with that PK hash, confirmed on the XDA thread). See Known published research below for a published attack targeting exactly this checkpoint.

## Family B — NXP iMX8MM ("mirror_v1_1")

Same individual (`gouda-percha` on XDA, `PutTotal4457` on Reddit) has run this the furthest. Confirmed via `fastboot getvar all`: A/B slots, partitions `boot_a/b`, `dtbo_a/b`, `vbmeta_a/b`, `super`, `userdata`; `secure:yes`, `unlocked:no`.

**Progress timeline (XDA thread):**
1. Dumped RAM via JTAG to locate the boot-state string, then got basic ADB shell access by "patching the process in memory" while booted normally (slow, done per boot)
2. Escalated to root; SELinux still enforcing at that point
3. Confirmed **High-Assurance Boot (HAB) is closed** via `imx-sdp` — ROM eFuses are burned, signed images required for anything loaded via SDP
4. Found NXP's own bulletin on an [i.MX SDP Authentication Vulnerability](https://community.nxp.com/t5/i-MX-Solutions-Knowledge-Base/i-MX-SDP-Authentication-Vulnerability-CVE/ta-p/1736196) as a possible lead
5. Fully dumped the eMMC (boot + Android partitions) with root
6. Reported **"ability to bypass hardware verification for booting custom bootloaders"** and getting a custom kernel/boot.img to boot — but landing in recovery, not a full boot
7. Per the neocities write-up and a later Reddit comment, the actual technique: get into SDP mode (short the PROG pads), load the original signed SPL, then load a shim because SPL fails to verify one of SDP's load methods — anything can be loaded after the shim, but partition/hardware access from there remains unresolved

**Current status:** gave up on booting Android this way; got **Linux** booting instead via a custom U-Boot chain, with WiFi working (`bcm4345/4329 brcm,fmac`); display, camera, mic, speakers not yet working. Offered to share extracted eMMC/APK images directly (ask, not a public download).

**Write-up:** https://failedattempts.neocities.org/ (part1 JTAG, part2a/b ADB + higher access, part3a bypass SDP programming mode)

**Other reference found on this thread:** [Synacktiv — "I hack, U-Boot"](https://www.synacktiv.com/publications/i-hack-u-boot.html) (UART/unprotected-shell research, cited by another XDA poster going down the UART route); Digi's [ConnectCore 8M Nano UART docs](https://docs.digi.com/resources/documentation/digidocs/embedded/dey/4.0/cc8mnano/bsp-uart_r_8m.html) for the "A53 UART" header label.

**Firmware diversity noted even within this family:** one later reporter (`trwbox`) found a different, older U-Boot build (`2020.04-00004-gfbe316d`, Apr 2021) that boots further — reaches `verify OK, boot 'boot_b'` and loads the kernel/ramdisk/fdt — but fails at display-panel probe (`adv7535@3d`, an ADV7535 MIPI-DSI-to-HDMI bridge chip) and never reaches Android UI. Worth comparing U-Boot build dates across units.

## Family C — unresolved pre-Lululemon generation

An older unit, bought before the Lululemon acquisition, with a Samsung-branded `LTI400HN01` display panel visible on teardown (reported by `themiggymigs` and `pyromaniac042` on Reddit). No one has reported the SoC identity, boot-chain details, or any successful rooting path for this generation. Genuinely open — don't assume either Family A or B's procedures apply.

## Hardware-swap alternative (not a software unlock)

[olm3ca/mirror](https://github.com/olm3ca/mirror) replaces the mainboard entirely with an LVDS→HDMI/VGA bridge board, driving the original panel and speakers from an external compute source (Raspberry Pi, PC, etc.). Keeps the physical mirror/display/speakers, abandons the stock board and any rooting effort. This is the standing fallback whenever a family's software path is a dead end — referenced repeatedly across both Reddit threads as the default answer when someone just wants the hardware usable again.

## Known published research

Background and citations only — not a how-to, and transferability to the Mirror's specific board/power-rail layout is unconfirmed.

**Vlind Glitch (BlackHat Europe 2022)** — Hector Marco & Vicent Arnau, Cyber Intelligence S.L., under the EU-funded EXFILES forensic-recovery project. A VCC voltage-glitching attack that bypasses the EDL/PBL programmer-image signature check on **Qualcomm MSM8916/APQ8016** (tested on a DragonBoard 410c — the same SoC family as Family A above). Key points:
- Fully "blind": doesn't require reversing the PBL, knowing the secure-boot implementation, or the code being glitched
- Timing window found by comparing power traces of a valid-key vs. invalid-key programmer load, not by code analysis
- Requires physical hardware: a glitcher on the VCC rail, a logic/power analyzer (they used a Beagle USB analyzer)
- Results: 125 successful bypasses in 15 hours, median 4.72 / mean 7.25 minutes per bypass; board stability unaffected afterward; dumped BootROM/PBL matched the original
- Explicitly described as a generic methodology applicable to numerous devices sharing this verification pattern — directly relevant to Family A's "no public Firehose with that PK hash" wall, though the Mirror board's own power-rail layout and glitch timing would need separate characterization

**NXP i.MX SDP Authentication Vulnerability** — NXP's own community bulletin: https://community.nxp.com/t5/i-MX-Solutions-Knowledge-Base/i-MX-SDP-Authentication-Vulnerability-CVE/ta-p/1736196 — relevant to Family B's HAB-closed wall; cited by `gouda-percha` as an unexplored lead.

**Synacktiv — "I hack, U-Boot"**: https://www.synacktiv.com/publications/i-hack-u-boot.html — published research on U-Boot/UART attack surfaces, cited in the Family B thread.

**Qualcomm MSM8916 CVEs**: CVE-2021-1909 (TA buffer overflow, unchecked parameter length, CVSS 7.8); CVE-2022-22063 (secure-boot/hypervisor weakness, tracked by the `msm8916-mainline` project). Neither has a public PoC specific to this board.

## Confirmed dead ends

Don't re-spend time on these — all independently confirmed negative:

- **Factory-reset button / power-button hold combos** on Family B/C enclosures: no bootloader/debug state reached (`turtlepsp`, `gouda-percha`)
- **USB OTG keyboard/mouse** on a stock, un-rooted unit: gets a cursor and the emoji keyboard overlay, no shell escape (`turtlepsp`)
- **`dnsmasq 2.51` / CVE-2017-14493** (DHCPv6 stack overflow) on Family A's web-server attack surface: reliably crashes the service, no code-execution path demonstrated (`SingularityDreaming`)
- **Reusing a Family B tool/loader (NXP `uuu`/SDP) against a Family A board (Qualcomm/Firehose), or vice versa**: produces a "not a Firehose loader" or equivalent hard failure — this is a diagnostic signal of family mismatch, not a bad download (`zarifurzarif`/`Renate`)
- **Pushing `adbkey.pub` to `/data/misc/adb/adb_keys` via `adb push`** (the standard broken-touchscreen-Android trick): requires the device already rooted/writable at that path — doesn't bypass the authorization wall on a stock, unrooted Mirror; it's the *next* step after root, not a way to get root

## Open questions

- Family C: SoC identity and boot-chain details entirely unknown
- Family B: getting a full custom **Android** boot (not just Linux) past the SPL-shim stage, and solving the `adv7535@3d` display-bridge panel-probe failure
- Family A: whether Vlind Glitch's methodology transfers to the Mirror's specific board/power-rail layout — unattempted as of this writing
- Whether the `ASSY_003101_REVP1` compute-module identity (same SOM across different carrier-board RevP## numbers) holds for every reported unit, or just the two sampled so far

**To contribute a new report**, include: board silkscreen label, `fastboot getvar all` (full output, not select fields), UART boot log if available, display panel model if visible, and which family (A/B/C) it matches. Open an issue on whichever repo/thread is active, or extend this doc.

## Flashing instructions — Family A (Qualcomm, verified)

Built from the upstream project's own [recovery guide](https://github.com/Onemoremichael/lulu-mirror-software-only/blob/main/docs/RECOVERY.md) and [build-inputs doc](https://github.com/Onemoremichael/lulu-mirror-software-only/blob/main/docs/BUILD.md). **Not a secure-boot bypass**: boot, recovery, bootloader, trust, modem, partition tables and board firmware all stay the original signed images untouched. Only `system` and `userdata` are ever written — that's why it works without an OEM unlock or an unsigned Firehose loader. Confirmed on RevP21 by the maintainers and replicated by multiple owners (vgab7, repairman29).

### Verify your board first (read-only, changes nothing)

```
python3 mirror.py doctor
python3 mirror.py devices
python3 mirror.py inspect --serial YOUR_SERIAL --board mir63a0-revp21
```

On RevP18/RevP20: the board allowlist currently only accepts `mir63a0-revp21`. Confirm your gate-reads (`getvar all`, partition sizes, `secure`/`unlocked`) match a RevP21 report before asking for the allowlist to be extended — don't just try it.

### 1. Build a system image (one-time, per build host; ~100+ GiB disk, Docker, your own lawfully obtained Qualcomm HY22 vendor tree)

```sh
mkdir android-m && cd android-m
repo init -u https://github.com/Onemoremichael/lulu-mirror-software-only.git -b main -m build/manifest.xml
repo sync -c -j4
python3 build/source_inventory.py --tree /absolute/path/to/android-m --manifest build/manifest.xml --output reports/source-check.json --require-pins
python3 tools/build-system.py --tree /absolute/path/to/android-m --public-key "$HOME/.android/adbkey.pub" --output-dir artifacts/my-system --camera-artifacts artifacts/my-camera
```

Community-confirmed fixes on a clean Linux checkout: `container-build.sh` needs `install -D -m 0644` (not `-m 0644`) for `pronto_wlan.ko`'s parent directory, which isn't pre-created; run the builders with `sudo` since Docker writes output as root.

### 2. Build fresh userdata with your own ADB key

```sh
adb start-server   # creates ~/.android/adbkey(.pub) if you've never used ADB
python3 tools/build-userdata.py --size SIZE_FROM_INSPECT --public-key "$HOME/.android/adbkey.pub" --output-dir artifacts/my-userdata
python3 tools/sparse-userdata.py artifacts/my-userdata/userdata-adb.img artifacts/my-userdata/userdata.sparse
```

Use the exact `userdata` size your own `inspect` reported — never borrow another owner's geometry.

### 3. Bundle, plan, flash, verify

```sh
python3 mirror.py bundle --board mir63a0-revp21 --system artifacts/system.img --userdata artifacts/my-userdata/userdata.sparse --directory bundles/my-recovery --provenance 'My documented source build'
python3 mirror.py plan --serial YOUR_SERIAL --board mir63a0-revp21 --bundle bundles/my-recovery/bundle.json --output reports/recovery-plan.json
python3 mirror.py flash --plan reports/recovery-plan.json --confirm 'RECOVER YOUR_SERIAL' --journal reports/flash-journal.json
fastboot -s YOUR_SERIAL reboot
python3 mirror.py verify --serial YOUR_SERIAL --board mir63a0-revp21 --output reports/android-verification.json
```

A failed flash: stop, keep the output, stay in fastboot, re-inspect, fix that one step — don't try unrelated partitions. Reinstalling erases app-level config (URL/token/webhook); re-enter it after first boot.

### Alternate: stock-only, no custom build (older firmware only)

[porcuswine's RevP18 report](https://github.com/porcuswine/lulu-mirror-software-only/blob/464fd7e3e48e1fa72b88daff89edfd1859c5c572/docs/owner-reports/revp18-stock-adb/README.md) keeps the entire stock system image and only injects fresh userdata with your ADB key — no AOSP build required. Confirmed on stock `1.14.2`; does **not** reliably reproduce on `1.2x` firmware (why is still open — see Family A's note above on firmware-version differences). Geometry: partition 5,583,458,304 bytes / filesystem 5,583,441,920 bytes, final 16 KiB explicitly zeroed. Follow that report's exact script-level steps rather than improvising the geometry.

**Working hypothesis for why the stock-only trick fails on newer firmware:** RECOVERY.md notes the stock boot image forces an encryption handoff that an unmodified stock system can't complete on fresh userdata — the project's own `system.img` carries a vold patch specifically to mount fresh userdata unencrypted instead. That plausibly explains RevP20's symptom (no RSA prompt ever appears, not even a rejected one): the injected `adb_keys`/`persist.sys.usb.config` may be getting wiped by a forced encryption/reformat pass before `adbd` ever reads them. If so, the fix is not more userdata-only attempts on `1.2x` firmware — it's skipping straight to the full build-and-flash sequence above.

### Next step for RevP20

Standalone, copy-pasteable version with PowerShell commands and the real script paths to clone: [revp20-next-steps.md](revp20-next-steps.md).

1. Capture full evidence, read-only: `python3 mirror.py doctor`, `python3 mirror.py devices`, `fastboot getvar all`, `fastboot oem device-info`. Do **not** run `mirror.py inspect --board mir63a0-revp21` on an unconfirmed board — [CONTRIBUTING.md](https://github.com/Onemoremichael/lulu-mirror-software-only/blob/main/CONTRIBUTING.md) explicitly asks people not to run the existing profile's inspector on an unknown board just to make it look supported.
2. Rule out the cheap host-side explanation first, no device risk: `adb kill-server && adb start-server && adb devices -l` — confirms no stale cached key independent of anything on the device.
3. File the evidence as a dated update on the existing [issue #15](https://github.com/Onemoremichael/lulu-mirror-software-only/issues/15), not a new thread: full `getvar all`, `oem device-info`, firmware `os_version`, what was tried, and the encryption-handoff idea above labeled as a hypothesis.
4. Open a "Recovery investigation or shared finding" issue per [docs/PORTING.md](https://github.com/Onemoremichael/lulu-mirror-software-only/blob/main/docs/PORTING.md) linking RevP20 to RevP21's report — classify it as a possible SoC-family-level finding, not an assertion, and let a maintainer decide whether to extend the profile.
5. **Do not** flash RevP20 with the RevP21 profile unilaterally in the meantime. CONTRIBUTING.md is explicit: new executable profiles require maintainer review of image provenance, write boundaries, and an acceptance/rollback plan; editing `recovery/device.py` or copying another board's profile locally is not how this project onboards a new chipset.

## Flashing instructions — Family B / Family C

No confirmed end-to-end flashing procedure exists yet for either family. Family B's furthest progress — a custom **Linux** boot, not Android — is documented in the Family B section above with its own write-up link; nothing there is a drop-in flashing sequence yet. Family C has no rooting attempt on record at all. This section is meant to fill in over time as owners report verified, repeatable results — extend it here rather than starting a separate document.
