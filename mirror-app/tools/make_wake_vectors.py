"""Make the wake-word self-test data the app carries (assets/wakeword/selftest.raw + selftest_<model>.txt): our own 3-second
test sound (make_frontend_vectors.py) and the raw uint8 answers the real TensorFlow Lite runtime gives for it with each bundled
model, one per 30 ms. GET /wake/selftest on the mirror runs the same sound through the app's front end and model and compares.
Development only; needs `pip install pymicro-wakeword` (it carries the runtime and the same models).

    py make_wake_vectors.py <frontend dir with audio.raw> <assets/wakeword dir>
"""

import ctypes
import shutil
import sys
from pathlib import Path

import numpy as np
from pymicro_wakeword import MicroWakeWord, MicroWakeWordFeatures, Model


def raw_outputs(model: Model, audio: bytes) -> list[int]:
    ww = MicroWakeWord.from_builtin(model)
    fe = MicroWakeWordFeatures()
    out, frames = [], []
    for f in fe.process_streaming(audio):
        frames.append(f)
        if len(frames) < ww.stride:
            continue
        q = np.clip(np.round(np.concatenate(frames, axis=1) / ww.input_scale + ww.input_zero_point), -128, 127).astype(np.int8)
        frames.clear()
        ww.lib.TfLiteTensorCopyFromBuffer(ww.input_tensor, q.ctypes.data_as(ctypes.c_void_p), q.nbytes)
        ww.lib.TfLiteInterpreterInvoke(ww.interpreter)
        o = np.empty(1, dtype=np.uint8)
        ww.lib.TfLiteTensorCopyToBuffer(ww.output_tensor, o.ctypes.data_as(ctypes.c_void_p), 1)
        out.append(int(o[0]))
    return out


def main(frontend_dir: str, assets_dir: str) -> None:
    audio = (Path(frontend_dir) / "audio.raw").read_bytes()
    shutil.copyfile(Path(frontend_dir) / "audio.raw", Path(assets_dir) / "selftest.raw")
    for m in (Model.OKAY_NABU, Model.HEY_JARVIS, Model.HEY_MYCROFT):
        values = raw_outputs(m, audio)
        (Path(assets_dir) / f"selftest_{m.value}.txt").write_text(",".join(map(str, values)) + "\n", encoding="ascii")
        print(m.value, len(values), "answers, max", max(values))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
