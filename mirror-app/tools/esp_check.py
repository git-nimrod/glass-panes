"""SPIKE check (v0.13 Bluetooth + voice test build): talk to the mirror's ESPHome-style server from a PC, before adding it to HA.

    py -m pip install aioesphomeapi
    py esp_check.py <mirror-ip>            # prints the device info, then counts Bluetooth advertisements for 30 s

The mirror only accepts port 6053 from the paired Home Assistant host by default. For this check from a PC, first run
    curl.exe "http://<mirror-ip>:8099/esphome/lock/off"
and afterwards
    curl.exe "http://<mirror-ip>:8099/esphome/lock/on"
Disconnect HA's ESPHome entry for the mirror first if it is already added (the mirror serves one client at a time).
Counts only: no Bluetooth address is printed.
"""

import asyncio
import sys

from aioesphomeapi import APIClient


async def main(host: str, seconds: int = 30, port: int = 6053) -> None:
    cli = APIClient(host, port, None, client_info="glass-panes-esp-check")
    await cli.connect(login=False)
    info = await cli.device_info()
    print("name:", info.name)
    print("friendly name:", info.friendly_name)
    print("esphome_version:", info.esphome_version)
    print("bluetooth_proxy_feature_flags:", info.bluetooth_proxy_feature_flags)
    print("voice_assistant_feature_flags:", info.voice_assistant_feature_flags)
    print("api version:", cli.api_version)

    if info.bluetooth_proxy_feature_flags:
        seen: set[int] = set()
        count = 0

        def on_ads(msg) -> None:
            nonlocal count
            for adv in msg.advertisements:
                count += 1
                seen.add(adv.address)

        unsub = cli.subscribe_bluetooth_le_raw_advertisements(on_ads)
        print(f"listening for {seconds} s ...")
        await asyncio.sleep(seconds)
        unsub()
        print("advertisements:", count, " distinct devices:", len(seen))
    else:
        print("Bluetooth switch is off on the mirror (curl .../esphome/bt/on to test it)")
    await cli.disconnect()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    asyncio.run(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 30, int(sys.argv[3]) if len(sys.argv) > 3 else 6053))
