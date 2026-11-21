"""End-to-end check of the mirror's ESPHome-style server with ESPHome's own Python client (aioesphomeapi, what Home Assistant uses),
walking the same steps Home Assistant's ESPHome integration takes. Development only:

    py -m pip install aioesphomeapi
    (in mirror-app)  ESP_E2E=1 ./gradlew :app:testDebugUnitTest --tests '*EspWireTest*'     # serves the app's real connection code on 127.0.0.1:16053
    py tools/esp_e2e.py 127.0.0.1 16053                                                      # in a second window while it waits

Steps: plaintext connect (no key yet, the mirror offers a key handover), the zero-key handover of a fresh key, the mirror asking the
plaintext connection to reconnect, plaintext then refused, a wrong key refused, and the right key: Bluetooth advertisements and
the wake-word list. Prints PASS or the step that failed. Never prints the key.
"""

import asyncio
import base64
import secrets
import sys

from aioesphomeapi import APIClient
from aioesphomeapi.core import InvalidEncryptionKeyAPIError, RequiresEncryptionAPIError, ZERO_NOISE_PSK


def check(ok: bool, what: str) -> None:
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        sys.exit(1)


async def ads_for(cli: APIClient, seconds: float) -> int:
    count = 0

    def on_ads(msg) -> None:
        nonlocal count
        count += len(msg.advertisements)

    unsub = cli.subscribe_bluetooth_le_raw_advertisements(on_ads)
    await asyncio.sleep(seconds)
    unsub()
    return count


async def main(host: str, port: int) -> None:
    # 1. plaintext, as when the mirror is first added
    plain = APIClient(host, port, None, client_info="e2e-plain")
    stopped = asyncio.Event()

    async def on_stop(expected: bool) -> None:
        stopped.set()

    await plain.connect(on_stop=on_stop, login=False)
    info = await plain.device_info()
    check(info.api_encryption_supported and info.api_encryption_provisionable, "no key yet: encryption supported and a key may be handed over")
    check(info.bluetooth_proxy_feature_flags == 33, "Bluetooth proxy offered in plaintext")
    check(info.voice_assistant_feature_flags == 0, "voice NOT offered in plaintext")
    check(await ads_for(plain, 1.0) > 0, "advertisements arrive in plaintext")

    # 2. the handover, as HA core esphome/manager.py _async_provision_key_over_noise does it
    new_key = base64.b64encode(secrets.token_bytes(32))
    zero = APIClient(host, port, None, client_info="e2e-handover", noise_psk=ZERO_NOISE_PSK)
    await zero.connect(login=False)
    check(await zero.noise_encryption_set_key(new_key), "the mirror took the key on the zero-key connection")
    await zero.disconnect(force=True)

    # 3. the mirror asks the plaintext connection to reconnect
    try:
        await asyncio.wait_for(stopped.wait(), 5)
        check(True, "the plaintext connection was asked to reconnect")
    except asyncio.TimeoutError:
        check(False, "the plaintext connection was asked to reconnect")

    # 4. plaintext refused, wrong key refused
    try:
        again = APIClient(host, port, None, client_info="e2e-plain-again")
        await again.connect(login=False)
        check(False, "plaintext refused after the handover")
    except RequiresEncryptionAPIError:
        check(True, "plaintext refused after the handover (HA asks for the key)")
    try:
        wrong = APIClient(host, port, None, client_info="e2e-wrong", noise_psk=base64.b64encode(secrets.token_bytes(32)).decode())
        await wrong.connect(login=False)
        check(False, "a wrong key is refused")
    except InvalidEncryptionKeyAPIError:
        check(True, "a wrong key is refused as an invalid key")

    # 5. the right key
    cli = APIClient(host, port, None, client_info="e2e-encrypted", noise_psk=new_key.decode())
    await cli.connect(login=False)
    info = await cli.device_info()
    check(not info.api_encryption_provisionable, "with a key: no more handover offered")
    check(info.voice_assistant_feature_flags == 53, "voice offered on the encrypted connection (flags 53)")
    check(info.bluetooth_proxy_feature_flags == 33, "Bluetooth proxy still offered")
    check(await ads_for(cli, 1.0) > 0, "advertisements arrive encrypted")
    config = await cli.get_voice_assistant_configuration(5)
    ids = [w.id for w in config.available_wake_words]
    check(ids == ["okay_nabu", "hey_jarvis", "hey_mycroft"] and config.active_wake_words == ["okay_nabu"] and config.max_active_wake_words == 1,
          "the wake-word list Home Assistant shows as a select")
    await cli.disconnect()
    print("PASS")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    asyncio.run(main(sys.argv[1], int(sys.argv[2])))
