"""Make the reference data for MicroFrontendTest: a fixed 3-second test sound and what the real C front end (pymicro-features,
the same code ESPHome and microWakeWord use) makes of it. Development only; needs `pip install pymicro-features`.

    py make_frontend_vectors.py <out dir>      # writes audio.raw (16 kHz 16-bit mono, little-endian) and features.raw (uint16 x 40 per 10 ms)
"""

import math
import struct
import sys
from pathlib import Path

from pymicro_features import MicroFrontend


def test_sound() -> list[int]:
    rate, out, seed = 16000, [], 12345

    def noise() -> float:
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        return seed / 0x7FFFFFFF * 2 - 1

    for n in range(rate * 3):
        t = n / rate
        if t < 0.4:
            v = 0.0                                                   # silence
        elif t < 1.2:
            f = 200 + 3000 * (t - 0.4)                                # a rising tone with a little hiss
            v = 0.4 * math.sin(2 * math.pi * f * t) + 0.01 * noise()
        elif t < 1.8:
            v = 0.3 * noise()                                         # loud noise
        elif t < 2.2:
            v = 1.6 * math.sin(2 * math.pi * 440 * t)                 # clipped tone: hits -32768 and 32767
        else:
            v = 0.002 * noise() + 0.05 * math.sin(2 * math.pi * 1000 * t) * (t - 2.2)   # quiet, fading in
        out.append(max(-32768, min(32767, int(round(v * 32767)))))
    return out


def main(out_dir: str) -> None:
    out = Path(out_dir)
    samples = test_sound()
    audio = struct.pack(f"<{len(samples)}h", *samples)
    frontend = MicroFrontend()
    features = bytearray()
    pos = 0
    while pos + 320 <= len(audio):
        r = frontend.process_samples(audio[pos:pos + 320])
        pos += r.samples_read * 2
        if r.features:
            features += struct.pack("<40H", *(int(round(f / 0.0390625)) for f in r.features))
    (out / "audio.raw").write_bytes(audio)
    (out / "features.raw").write_bytes(bytes(features))
    print(len(samples), "samples,", len(features) // 80, "feature frames")


if __name__ == "__main__":
    main(sys.argv[1])
