<#
.SYNOPSIS
  Install a Glass Panes mirror image that trusts YOUR adb key (not the old shared one).

.DESCRIPTION
  The release's userdata.sparse ships with one adb public key in /data/misc/adb/adb_keys: the
  shared Glass Panes project key. Every Android adb key is exactly 700 base64 characters, so this
  script swaps that key for yours, byte for byte, in a COPY of the file. The download is never
  changed. Then it flashes system.img (as released) and your userdata.

  Steps:
    1. checks that `adb` and `fastboot` are on your PATH,
    2. checks the SHA-256 of the release files against SHA256SUMS,
    3. reads YOUR adb public key (%USERPROFILE%\.android\adbkey.pub; created if missing),
    4. writes userdata-yours.sparse with your key in place of the project key, and checks it,
    5. with your OK (type FLASH), flashes system + your userdata and reboots,
    6. waits for Android to finish starting, then finishes the setup over the USB cable (no scrcpy, no taps):
       - the Mirror Kiosk app: built into mirror-android-3 and later; on an older image it is installed (from -AppApk, or the
         newest app release on GitHub, checked against GitHub's SHA-256),
       - camera, microphone and location permissions, the screen-off switch, and the stock launcher hidden (all already done by
         mirror-android-3's built-in app; repeated here so older images get them too),
       - Wi-Fi: with -WifiSsid the app adds your network (you type the password here; it is never written to a file),
       - the pairing code on the mirror's screen, and the mirror's address to type into Home Assistant.

  Your private key never leaves your computer; only the public half goes into the image.
  Flashing userdata ERASES the mirror's data (a fresh install). It asks before that step.

  Tested on a real mirror (Nov 2026): the swapped key reads back exactly, with its ownership, mode
  and SELinux label intact, and the filesystem checks clean. Try it with -NoFlash first.

.PARAMETER ImageDir
  Folder holding system.img, userdata.sparse and SHA256SUMS (the release download).

.PARAMETER KeyPub
  Your adb public key. Default: %USERPROFILE%\.android\adbkey.pub.

.PARAMETER NoFlash
  Only prepare userdata-yours.sparse and stop. Nothing touches the mirror.

.PARAMETER WifiSsid
  The name of the Wi-Fi network the mirror should join. You are asked for the password (leave it empty for an open network).
  The password goes to the mirror over the USB cable and into Android's own Wi-Fi settings; this script keeps no copy.

.PARAMETER WifiHidden
  The network does not show its name (a hidden network).

.PARAMETER AppApk
  A Mirror Kiosk APK to install when the image does not have the app built in (images 1 and 2). Default: the newest app release
  from GitHub, checked against the SHA-256 GitHub publishes for it.

.PARAMETER SetupOnly
  Do not flash anything: only run the after-boot setup (app, permissions, Wi-Fi, pairing) on a mirror that is already running and
  connected with the USB cable. Handy after a flash done by hand, or to change the Wi-Fi.

.PARAMETER NetworkAdb
  Turn on adb over the network (port 5555), kept on across restarts (mirror-android-3 and later).
  It is set in your copy of userdata before flashing: Android does not let adb change it later, so
  turning it on or off afterwards means running the installer again (which erases the mirror).
  Only keys on the mirror's list can connect, but the mirror checks the public key only, so keep
  your adbkey.pub to yourself.

.EXAMPLE
  .\install-mirror.ps1 -ImageDir C:\mirror-android-3 -NoFlash
  .\install-mirror.ps1 -ImageDir C:\mirror-android-3 -WifiSsid "My Home Wi-Fi"
  .\install-mirror.ps1 -SetupOnly -WifiSsid "My Home Wi-Fi"
#>
[CmdletBinding()]
param(
  [string]$ImageDir,
  [string]$KeyPub = (Join-Path $env:USERPROFILE ".android\adbkey.pub"),
  [switch]$NoFlash,
  [switch]$NetworkAdb,
  [string]$WifiSsid,
  [switch]$WifiHidden,
  [string]$AppApk,
  [switch]$SetupOnly
)

$ErrorActionPreference = "Stop"

# The key baked into the released userdata.sparse: the shared Glass Panes project key
# (mirror-app/android/project-key/adbkey.pub). It is public. We look for it and replace it.
$SHIPPED_KEY = "QAAAAMGY8dO/CDkPk+Dk9GVzVzjw0JoAZ1gDRyFkwt973iK9T02t1kIv+roncxy7+xgMct7jmTojr1/almR0OMvLJgeeVoO5vbgIvBkIMwgkGqQmYG2FBpNT9K0pgEA7eZZVutIloL/521OHWAQWT1TrvExGV6pQUvcjM7ncvvwzqcUC3KBQL6LaWXyeR6mVko3pT6G/nh4pHmRTtv7gCx3+tW5XRP/5+jJ8Ho1hQSMn6LHXsdeuoIeg5AIq9Nyy4yv3kcmLjVEY4myH6RzLZnKU7QvWOQ9VWNM/Ss2cegTWDOC/Dhr6V+BPFJJpKG9uAqbKcVxApQNl0vzIL3X5l2zBvQt3ybO+IQTWWbscpdnpORVrygTeYr0W4qv0j6aI5vv/3Pqfl7ARVqrVtZ/prRvsLmtsBx59igEZIoV2V2BSduHuKTdLw5LcXbfgMHqM09+BOUO7RCfRKL5MfxfvN3aSnib9XMoa7VGnzAE6B13mBXqQWt4JW1HxnNRtaag5j+Hmja7cIjGxwvR722rOXNdjofVo7c/c/Hu2EMVda9SfqAaR8vcNGDJGpHrAiUH8Q28RXcUmb3z23mmJ8BvT7wKVtVxWxf7UlFTBM6qbs7IsMk+CE8trL+deDp4kujbMXAuhX/ItffnXkcNezhv9DMn5rJP4dLfMZbUf8UGlGAWXuq0xJJEohQEAAQA="
$KEY_CHARS = 700          # every Android adb RSA public key is 700 base64 characters (524 bytes)
# userdata.sparse stores persist.adb.tcp.port as this text; adb reads only the leading number (0 = off)
$NET_ADB_OFF = "0000 glass-panes-network-adb"
$NET_ADB_ON  = "5555 glass-panes-network-adb"

function Need($exe) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
    throw "$exe is not on your PATH. Install Google's platform-tools (adb + fastboot) and try again."
  }
}

function Verify-Sha($dir, [string[]]$required) {
  $sums = Join-Path $dir "SHA256SUMS"
  if (-not (Test-Path $sums)) { throw "SHA256SUMS not found in $dir. Download it from the release." }
  $seen = @{}
  foreach ($line in Get-Content $sums) {
    if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$') {
      $want = $Matches[1].ToLower(); $name = $Matches[2]
      $path = Join-Path $dir $name
      if (-not (Test-Path $path)) { continue }
      $got = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
      if ($got -ne $want) { throw "$name does not match its published SHA-256. Do not flash it. Download it again." }
      Write-Host "  ok  $name" -ForegroundColor Green
      $seen[$name] = $true
    }
  }
  foreach ($r in $required) { if (-not $seen[$r]) { throw "$r is missing, or not listed in SHA256SUMS." } }
}

# Find `old` exactly once in `buf` and overwrite it with `new` (same length). Returns the offset.
function Swap-Once([byte[]]$buf, [byte[]]$old, [byte[]]$new) {
  if ($old.Length -ne $new.Length) { throw "internal: the two keys differ in length." }
  $first = -1; $count = 0
  $last = $buf.Length - $old.Length
  $b0 = $old[0]
  for ($i = 0; $i -le $last; $i++) {
    if ($buf[$i] -ne $b0) { continue }
    $match = $true
    for ($j = 1; $j -lt $old.Length; $j++) { if ($buf[$i + $j] -ne $old[$j]) { $match = $false; break } }
    if ($match) { if ($first -lt 0) { $first = $i }; $count++ }
  }
  if ($count -eq 0) { throw "the project key was not found in userdata.sparse. Is this a Glass Panes mirror-android release?" }
  if ($count -gt 1) { throw "the project key appears $count times in userdata.sparse; the file is not as expected." }
  [System.Array]::Copy($new, 0, $buf, $first, $new.Length)
  return $first
}

function Count-Of([byte[]]$buf, [byte[]]$pat) {
  $n = 0; $last = $buf.Length - $pat.Length; $b0 = $pat[0]
  for ($i = 0; $i -le $last; $i++) {
    if ($buf[$i] -ne $b0) { continue }
    $m = $true
    for ($j = 1; $j -lt $pat.Length; $j++) { if ($buf[$i + $j] -ne $pat[$j]) { $m = $false; break } }
    if ($m) { $n++ }
  }
  return $n
}

$KIOSK = "com.nimrod.mirrorkiosk"
$RELEASES_API = "https://api.github.com/repos/git-nimrod/glass-panes/releases?per_page=30"

# Text for one argument of an `adb shell` command line: in single quotes for the mirror's shell (a ' inside becomes '\'').
function Shell-Quote([string]$s) { return "'" + ($s -replace "'", "'\''") + "'" }

# adb refuses to guess when it sees more than one device, and a mirror with network adb shows up twice (USB and
# <address>:5555). Pick the USB one (or the only one) and point every later adb command at it with ANDROID_SERIAL.
function Use-OneMirror {
  for ($i = 0; $i -lt 120; $i++) {
    $ready = @(adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
    $usb = @($ready | Where-Object { $_ -notmatch ':' })
    if ($usb.Count -gt 1) { throw "more than one device is plugged in by USB ($($usb -join ', ')). Unplug the others and run: .\install-mirror.ps1 -SetupOnly" }
    if ($usb.Count -eq 1) { $env:ANDROID_SERIAL = $usb[0]; return }
    if ($ready.Count -eq 1) { $env:ANDROID_SERIAL = $ready[0]; return }
    Start-Sleep -Seconds 5
  }
  throw "no mirror showed up in 'adb devices' within 10 minutes. Check the USB cable, then run: .\install-mirror.ps1 -SetupOnly"
}

function Wait-Booted {
  Write-Host "Waiting for Android to finish starting (the first boot can take about 5 minutes)..."
  Use-OneMirror
  for ($i = 0; $i -lt 120; $i++) {
    $done = (adb shell getprop sys.boot_completed 2>$null | Out-String).Trim()
    if ($done -eq "1") { Start-Sleep -Seconds 10; return }
    Start-Sleep -Seconds 5
  }
  throw "Android did not finish starting within 10 minutes. Unplug the mirror's power, plug it back in, then run: .\install-mirror.ps1 -SetupOnly"
}

# The newest Mirror Kiosk release on GitHub, downloaded and checked against GitHub's published SHA-256. Returns the file path.
function Get-AppRelease {
  Write-Host "Looking for the newest Mirror Kiosk app on GitHub..."
  $rels = Invoke-RestMethod -Uri $RELEASES_API -Headers @{ "User-Agent" = "glass-panes-installer" }
  $best = $null; $bestV = $null
  foreach ($r in $rels) {
    if ($r.draft -or $r.tag_name -notmatch '^app-v(\d+)\.(\d+)\.(\d+)$') { continue }
    $v = [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $Matches[3])
    $name = "mirror-kiosk-v{0}.apk" -f $v
    $asset = $r.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if (-not $asset -or "$($asset.digest)" -notmatch '^sha256:([0-9a-f]{64})$') { continue }
    $sha = $Matches[1]
    if (-not $bestV -or $v -gt $bestV) { $bestV = $v; $best = @{ url = $asset.browser_download_url; name = $name; sha = $sha } }
  }
  if (-not $best) { throw "No Mirror Kiosk release with a published SHA-256 was found on GitHub. Download the APK yourself and run again with -AppApk <file>." }
  $file = Join-Path $env:TEMP $best.name
  Write-Host "  downloading $($best.name) (about 90 MB)..."
  Invoke-WebRequest -Uri $best.url -OutFile $file -UseBasicParsing
  if ((Get-FileHash $file -Algorithm SHA256).Hash.ToLower() -ne $best.sha) { Remove-Item $file; throw "The downloaded app does not match the SHA-256 GitHub publishes. Try again." }
  Write-Host "  ok  $($best.name) matches its published SHA-256" -ForegroundColor Green
  return $file
}

# Everything after the first boot, over USB: the app, its permissions, the launcher, Wi-Fi, and the pairing screen.
function Finish-Setup {
  Wait-Booted
  Write-Host "`nFinishing the setup on the mirror..." -ForegroundColor Cyan
  $where = (adb shell pm path $KIOSK 2>$null | Out-String).Trim()
  if (-not $where) {
    $apk = if ($AppApk) { $AppApk } else { Get-AppRelease }
    if (-not (Test-Path $apk)) { throw "App file not found: $apk" }
    Write-Host "  installing the Mirror Kiosk app (this image does not have it built in)..."
    adb install -r $apk
    $where = (adb shell pm path $KIOSK 2>$null | Out-String).Trim()
    if (-not $where) { throw "The app did not install. Check the messages above." }
  } elseif ($where -match '/system/priv-app/') {
    Write-Host "  ok  the Mirror Kiosk app is built into this image" -ForegroundColor Green
  } else {
    Write-Host "  ok  the Mirror Kiosk app is installed" -ForegroundColor Green
  }
  # Repeated on purpose: mirror-android-3's built-in app already has all of these, older images need them. Errors are harmless here.
  foreach ($perm in @("android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.ACCESS_COARSE_LOCATION")) {
    adb shell pm grant $KIOSK $perm 2>$null | Out-Null
  }
  adb shell dpm set-active-admin "$KIOSK/.ScreenAdmin" 2>$null | Out-Null
  if ((adb shell pm path com.android.launcher3 2>$null | Out-String).Trim()) { adb shell pm hide com.android.launcher3 2>$null | Out-Null }
  Write-Host "  ok  camera, microphone and location allowed; screen switch ready; stock launcher out of the way" -ForegroundColor Green

  if ($WifiSsid) {
    if ($WifiSsid.Contains('"')) { throw "The network name contains a double quote, which this script cannot pass on. Join it with scrcpy instead." }
    $secure = Read-Host "Wi-Fi password for '$WifiSsid' (leave empty for an open network)" -AsSecureString
    $pass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if ($pass.Contains('"')) { throw "The password contains a double quote, which this script cannot pass on. Join the network with scrcpy instead." }
    $cmd = "am start -n $KIOSK/.MainActivity --es wifi_ssid " + (Shell-Quote $WifiSsid)
    if ($pass) { $cmd += " --es wifi_pass " + (Shell-Quote $pass) }
    if ($WifiHidden) { $cmd += " --es wifi_hidden 1" }
    adb shell $cmd | Out-Null
    $pass = $null; $cmd = $null
    Write-Host "  sent the Wi-Fi network to the mirror; waiting for it to join..."
  } else {
    adb shell am start -n "$KIOSK/.MainActivity" | Out-Null
  }

  $ip = ""
  for ($i = 0; $i -lt 30; $i++) {
    $line = (adb shell ip -f inet addr show wlan0 2>$null | Out-String)
    if ($line -match 'inet (\d+\.\d+\.\d+\.\d+)') { $ip = $Matches[1]; break }
    Start-Sleep -Seconds 3
  }
  if ($ip) {
    Write-Host "  ok  the mirror is on Wi-Fi at $ip" -ForegroundColor Green
  } elseif ($WifiSsid) {
    Write-Host "  The mirror has not joined '$WifiSsid' yet. Check the name and password and run: .\install-mirror.ps1 -SetupOnly -WifiSsid `"$WifiSsid`"" -ForegroundColor Yellow
  } else {
    Write-Host "  The mirror is not on Wi-Fi. Run again with -SetupOnly -WifiSsid `"<your network>`" (or join with scrcpy)." -ForegroundColor Yellow
  }
  Write-Host "`nNow pair it: the mirror shows a six-digit code." -ForegroundColor Cyan
  Write-Host ("In Home Assistant: Glass Panes (sidebar) > Mirrors > Add mirror > Pair with a code. Type the code" + $(if ($ip) { " and the address $ip" } else { " and the mirror's address" }) + ".")
}

Write-Host "`nGlass Panes mirror installer" -ForegroundColor Cyan
if ($SetupOnly) {
  Need adb
  Finish-Setup
  exit 0
}
if (-not $ImageDir) { throw "Give -ImageDir (the folder with the release download), or -SetupOnly to only finish the setup." }
if (-not $NoFlash) { Need adb; Need fastboot }

$system = Join-Path $ImageDir "system.img"
$udata  = Join-Path $ImageDir "userdata.sparse"
$out    = Join-Path $ImageDir "userdata-yours.sparse"
if (-not (Test-Path $udata)) { throw "userdata.sparse not found in $ImageDir." }
if (-not $NoFlash -and -not (Test-Path $system)) { throw "system.img not found in $ImageDir." }

Write-Host "`nChecking the downloads..."
$required = @("userdata.sparse"); if (-not $NoFlash) { $required += "system.img" }
Verify-Sha $ImageDir $required

# your key: make sure it exists, then read and check it
if (-not (Test-Path $KeyPub)) {
  Write-Host "`nNo adb key yet; creating one with 'adb start-server'..."
  Need adb
  adb start-server | Out-Null
}
if (-not (Test-Path $KeyPub)) { throw "could not find or create your adb public key at $KeyPub." }
$lines = @(Get-Content $KeyPub | Where-Object { $_ -match '\S' })
if ($lines.Count -ne 1) { throw "expected exactly one key in $KeyPub." }
$yourKey = ($lines[0].Trim() -split '\s+')[0]
try { $decoded = [System.Convert]::FromBase64String($yourKey) } catch { throw "$KeyPub is not an adb public key." }
if ($yourKey.Length -ne $KEY_CHARS -or $decoded.Length -ne 524) { throw "$KeyPub is not an Android adb RSA public key (wrong size)." }
if ($yourKey -eq $SHIPPED_KEY) { throw "$KeyPub IS the shared project key. Use your own key (if you followed the guide for images 1 or 2, copy your adbkey.mine and adbkey.pub.mine files back first)." }
Write-Host "Using your adb key: $KeyPub" -ForegroundColor Green

# swap the project key for yours in a copy of userdata.sparse
Write-Host "`nWriting your key into a copy of userdata ($([System.IO.Path]::GetFileName($out)))..."
$enc = [System.Text.Encoding]::ASCII
$buf = [System.IO.File]::ReadAllBytes($udata)
$at = Swap-Once $buf ($enc.GetBytes($SHIPPED_KEY)) ($enc.GetBytes($yourKey))
$offCount = Count-Of $buf ($enc.GetBytes($NET_ADB_OFF))
if ($NetworkAdb) {
  if ($offCount -ne 1) { throw "this userdata.sparse has no network adb setting (found $offCount); it needs mirror-android-3 or later. Run again without -NetworkAdb." }
  $off = $enc.GetBytes($NET_ADB_OFF); $on = $enc.GetBytes($NET_ADB_ON)
  $last = $buf.Length - $off.Length
  for ($i = 0; $i -le $last; $i++) {
    if ($buf[$i] -ne $off[0]) { continue }
    $m = $true
    for ($j = 1; $j -lt $off.Length; $j++) { if ($buf[$i + $j] -ne $off[$j]) { $m = $false; break } }
    if ($m) { [System.Array]::Copy($on, 0, $buf, $i, $on.Length); break }
  }
  Write-Host "  ok  network adb will be on (port 5555), kept across restarts" -ForegroundColor Green
}
[System.IO.File]::WriteAllBytes($out, $buf)
$check = [System.IO.File]::ReadAllBytes($out)
if ((Count-Of $check ($enc.GetBytes($SHIPPED_KEY))) -ne 0) { throw "the project key is still in the copy." }
if ((Count-Of $check ($enc.GetBytes($yourKey))) -ne 1) { throw "your key is not in the copy exactly once." }
if ($check.Length -ne (Get-Item $udata).Length) { throw "the copy changed size." }
if ($NetworkAdb -and (Count-Of $check ($enc.GetBytes($NET_ADB_ON))) -ne 1) { throw "the network adb setting is not in the copy exactly once." }
Write-Host "  ok  your key is in userdata-yours.sparse (at byte $at); the download is untouched." -ForegroundColor Green

if ($NoFlash) {
  Write-Host "`n-NoFlash: stopping here. Nothing was sent to the mirror." -ForegroundColor Cyan
  exit 0
}

# confirm, then flash
Write-Host "`n*** This ERASES the mirror and installs Glass Panes. It cannot be undone. ***" -ForegroundColor Red
Write-Host "Put the mirror in fastboot (adb reboot bootloader) with the USB cable connected, then:"
$go = Read-Host "Type FLASH to continue, anything else to stop"
if ($go -ne "FLASH") { Write-Host "Stopped. Nothing was flashed. userdata-yours.sparse is ready whenever you are."; exit 0 }

fastboot getvar product
fastboot flash system $system
fastboot -S 0 flash userdata $out     # -S 0 as in the install guide: send userdata exactly as built
fastboot reboot

Write-Host "`nRebooting. The first boot is slow (up to about 5 minutes)."
Finish-Setup
if ($NetworkAdb) {
  Write-Host "adb over the network is on and stays on after restarts: adb connect <mirror address>:5555" -ForegroundColor Yellow
  Write-Host "Unplug the USB cable first: while USB is connected, Android 6 gives the approval to USB and the network shows 'unauthorized'." -ForegroundColor Yellow
  Write-Host "('failed to authenticate' before 'device' is normal.)" -ForegroundColor Yellow
}
Write-Host "`nDone. After pairing, app updates come from Home Assistant (Settings > Updates) on mirror-android-3 and later." -ForegroundColor Cyan
