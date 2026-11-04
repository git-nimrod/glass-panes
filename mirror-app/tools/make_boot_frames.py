"""Make the launch-screen frames for the Mirror Kiosk app from the brand boot animation.

    python tools/make_boot_frames.py <path to brand/boot-animation.gif>

Needs Pillow (pip install pillow). Writes app/src/main/res/drawable-nodpi/boot_00.png, boot_01.png ...
Each frame is flattened onto BLACK (never white) so the launch screen cannot flash a light background.
The app (MainActivity.buildSplash) reads every boot_NN drawable it finds, in order. It holds the first
frame for 1050 ms and the last for 1650 ms and shows the rest for 60 ms each, which are the delays in the
original GIF; if the GIF changes, update those numbers there.
"""
import os
import sys

from PIL import Image, ImageSequence

if len(sys.argv) != 2:
    sys.exit(__doc__)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "src", "main", "res", "drawable-nodpi")
os.makedirs(out, exist_ok=True)
for old in os.listdir(out):
    if old.startswith("boot_") and old.endswith(".png"):
        os.remove(os.path.join(out, old))

gif = Image.open(sys.argv[1])
delays = []
for i, frame in enumerate(ImageSequence.Iterator(gif)):
    delays.append(frame.info.get("duration", 100))
    page = Image.new("RGBA", frame.size, (0, 0, 0, 255))
    page.alpha_composite(frame.convert("RGBA"))
    page.convert("RGB").save(os.path.join(out, "boot_%02d.png" % i), optimize=True)
print("wrote", len(delays), "frames; delays in ms:", delays)
