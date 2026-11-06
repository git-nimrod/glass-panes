# Lululemon Mirror RevP20 — next steps

For `MIR63A0-00-P1 / PCA#500240 RevP20` (Qualcomm APQ8016/MSM8916 family). Background: [lulu-mirror-source-of-truth.md](lulu-mirror-source-of-truth.md).

**What actually happened:** your stock-only userdata-injection attempt got no RSA prompt at all, even with a correct key. The likely cause: the stock system forces an encryption handoff on fresh userdata, and an unmodified stock system can't complete it — so your injected `adb_keys`/`persist.sys.usb.config` probably got wiped by a reformat before `adbd` ever read them. That's a firmware-behavior problem, not a wrong key or wrong geometry.

**The fix that's actually proven to work** on this exact hardware (same `ASSY_003101_REVP1` compute module, same `secure`/`unlocked`/partition-size gate-reads as your unit) is the full build-and-flash path that already worked on a RevP21 unit — it rebuilds `system` from source and flashes it alongside fresh `userdata`, which sidesteps the encryption-handoff problem entirely because the replacement system doesn't force that handoff.

**The one real risk, stated plainly:** `flash` fully erases and overwrites `system` (and `userdata`). This board's bootloader is locked (`secure: yes`, `unlocked: no`) and doesn't support reading a partition back out, and nobody — including the project maintainers — has a factory backup of this board. So a failed or unexpectedly-different write has no known way back. Everything below up through step 3 is read-only and safe to just run. Step 4 (the actual flash) is the one place worth getting a second set of eyes first, because it's the one irreversible step.

## 0. Get the actual scripts (one-time)

`mirror.py` and the `tools/*.py` scripts below aren't standalone files — they import from `recovery/` and `profiles/` in the same repo, so clone the whole thing rather than downloading loose files:

```powershell
git clone https://github.com/Onemoremichael/lulu-mirror-software-only.git
cd lulu-mirror-software-only
python3 --version   # needs 3.10+
adb --version
fastboot --version
```

No `pip install` needed — the project's README confirms no Python packages are required, just `adb`/`fastboot` on PATH. Real scripts you'll actually run, confirmed present in this repo: `mirror.py` (root), `tools/build-userdata.py`, `tools/sparse-userdata.py`, `tools/build-system.py`, `tools/check-manifest.py`, `build/source_inventory.py`.

## 1. Run these now — read-only, safe, no risk

```powershell
python3 mirror.py doctor
python3 mirror.py devices
python3 mirror.py inspect --serial YOUR_SERIAL --board mir63a0-revp21 --output reports\revp20-inspect.json
```

`inspect` only reads the device — it does not reboot, unlock, erase, flash, or change ADB authorization, per the project's own docs. Using the `mir63a0-revp21` profile here is fine; it's just the closest known profile to compare against. What matters is reporting the result honestly as "RevP20 board, inspected with the RevP21 profile," not as proof RevP20 is supported.

Also grab the raw fastboot output, for a second, independent comparison:

```powershell
$out = "$env:USERPROFILE\Desktop\revp20-evidence.txt"
"=== fastboot devices -l ===" | Out-File $out
fastboot devices -l 2>&1 | Out-File $out -Append
"=== fastboot getvar all ===" | Out-File $out -Append
fastboot getvar all 2>&1 | Out-File $out -Append
"=== fastboot oem device-info ===" | Out-File $out -Append
fastboot oem device-info 2>&1 | Out-File $out -Append
notepad $out
```

## 2. Rule out the host-side explanation (no device risk)

```powershell
adb kill-server
adb start-server
adb devices -l
Get-ChildItem "$env:USERPROFILE\.android\adbkey.pub"
Get-Content "$env:USERPROFILE\.android\adbkey.pub"
echo $env:ADB_VENDOR_KEYS
```

Rules out a stale cached key or a stray second `adbkey.pub` causing the symptom independent of the device.

## 3. Compare `reports\revp20-inspect.json` and `revp20-evidence.txt` against a RevP21 report

Open [issue #11](https://github.com/Onemoremichael/lulu-mirror-software-only/issues/11) and check line-for-line: `product`, `secure`, `unlocked`, `partition-size:system`, `partition-size:userdata`, `max-download-size`. If every field matches, you have real evidence this board is gate-identical to RevP21 — not a guess.

Post that comparison as a dated update on [issue #15](https://github.com/Onemoremichael/lulu-mirror-software-only/issues/15), with the encryption-handoff idea above labeled as a hypothesis. This isn't bureaucracy for its own sake — it's the fastest way to get someone who's already done this exact flash to tell you, before you commit to step 4, whether they see anything in your output that differs from theirs.

## 4. The actual flash — once you're confident in step 3

This is the verified path (vgab7, repairman29 on RevP21). **Not a secure-boot bypass** — boot, recovery, bootloader, trust, modem, and board firmware all stay the original signed images; only `system` and `userdata` get written.

**Build the system image** (run in WSL/Ubuntu — this part is Docker + AOSP, not PowerShell):

```sh
mkdir android-m && cd android-m
repo init -u https://github.com/Onemoremichael/lulu-mirror-software-only.git -b main -m build/manifest.xml
repo sync -c -j4
python3 build/source_inventory.py --tree /absolute/path/to/android-m --manifest build/manifest.xml --output reports/source-check.json --require-pins
python3 tools/build-system.py --tree /absolute/path/to/android-m --public-key "$HOME/.android/adbkey.pub" --output-dir artifacts/my-system --camera-artifacts artifacts/my-camera
```

**Build fresh userdata** (same shell):

```sh
python3 tools/build-userdata.py --size SIZE_FROM_INSPECT --public-key "$HOME/.android/adbkey.pub" --output-dir artifacts/my-userdata
python3 tools/sparse-userdata.py artifacts/my-userdata/userdata-adb.img artifacts/my-userdata/userdata.sparse
```

**Bundle, plan, flash, verify** — this can run from PowerShell or WSL, same commands either way:

```powershell
python3 mirror.py bundle --board mir63a0-revp21 --system artifacts/system.img --userdata artifacts/my-userdata/userdata.sparse --directory bundles/my-recovery --provenance 'My documented source build'
python3 mirror.py plan --serial YOUR_SERIAL --board mir63a0-revp21 --bundle bundles/my-recovery/bundle.json --output reports/recovery-plan.json
python3 mirror.py flash --plan reports/recovery-plan.json --confirm 'RECOVER YOUR_SERIAL' --journal reports/flash-journal.json
fastboot -s YOUR_SERIAL reboot
python3 mirror.py verify --serial YOUR_SERIAL --board mir63a0-revp21 --output reports/android-verification.json
```

Read the plan file before running `flash`. If the flash fails partway: stop, keep the journal file, stay in fastboot, and ask on issue #15 before trying anything else — don't try unrelated partitions to fix it.
