#!/usr/bin/env python3
"""
Generate the token art for the MEDIUM form of Dancing Lights (2024: "you combine the four
lights into one glowing Medium form that is vaguely humanlike").

JB2A ships the torch-size orbs but no humanlike light, so the form is drawn here: a soft
luminous figure — head, shoulders, arms, a torso that thins into a wisp — with a slow pulse,
a gentle sway and a few rising motes. One looping VP9 webm with alpha per colour, matching
the seven JB2A orb colours, plus a still thumbnail for the actor image.

Original artwork, generated procedurally: no third-party asset is used.

    python3 tools/generate-dancing-lights-medium.py        # writes img/dancing-lights/

Needs numpy, scipy, Pillow and an ffmpeg with libvpx-vp9.
"""
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

SIZE = 400
FRAMES = 48          # 2 s at 24 fps, loops seamlessly (every motion is periodic over it)
FPS = 24

# Same colours as the importer's orb actors (companions/types/DancingLights.ts).
COLOURS = {
    "Yellow": "#ffed7a",
    "Green": "#a7ff7a",
    "BlueTeal": "#80ffff",
    "BlueYellow": "#c1e6e6",
    "Pink": "#f080ff",
    "PurpleGreen": "#a66bff",
    "Red": "#ff817a",
}

yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)


def ellipse(cx, cy, rx, ry, angle=0.0):
    """A filled ellipse as a 0..1 field with a soft edge."""
    ca, sa = math.cos(angle), math.sin(angle)
    dx, dy = xx - cx, yy - cy
    u = (dx * ca + dy * sa) / rx
    v = (-dx * sa + dy * ca) / ry
    return np.clip(1.25 - np.sqrt(u * u + v * v), 0, 1).clip(0, 1) ** 0.8 * (np.sqrt(u * u + v * v) < 1.25)


def figure(phase):
    """The humanlike shape for one animation phase (0..1), before blurring."""
    sway = math.sin(2 * math.pi * phase)
    # The lower body sways more than the head: shift x by an amount growing with y.
    lean = (np.clip((yy - 150) / 230, 0, 1) ** 1.6) * 9 * sway
    global xx
    base_x = xx
    xx = base_x - lean
    try:
        body = np.zeros((SIZE, SIZE), np.float32)
        bob = 3 * math.sin(2 * math.pi * phase + 1.0)
        body = np.maximum(body, ellipse(200, 96 + bob, 33, 37))                 # head
        body = np.maximum(body, ellipse(200, 150 + bob, 16, 20))                # neck
        body = np.maximum(body, ellipse(200, 172 + bob, 66, 26))                # shoulders
        body = np.maximum(body, ellipse(200, 222 + bob, 44, 72))                # torso
        arm = 0.20 + 0.05 * math.sin(2 * math.pi * phase + 0.6)
        body = np.maximum(body, ellipse(141, 226 + bob, 15, 62, angle=arm))     # left arm
        body = np.maximum(body, ellipse(259, 226 + bob, 15, 62, angle=-arm))    # right arm
        # No legs: the torso thins into a wisp, as a light would.
        taper = np.clip((yy - 250) / 125, 0, 1)
        width = 40 * (1 - taper) ** 1.5 + 3
        wisp = np.clip(1.2 - np.abs(xx - 200) / width, 0, 1) * (yy > 250) * (yy < 378) * (1 - taper * 0.55)
        body = np.maximum(body, wisp.astype(np.float32))
    finally:
        xx = base_x
    return body


def motes(phase):
    """A few bright specks drifting up around the figure, looping over the cycle."""
    field = np.zeros((SIZE, SIZE), np.float32)
    rng = np.random.default_rng(7)
    for _ in range(11):
        x0 = rng.uniform(95, 305)
        offset = rng.uniform(0, 1)
        speed = rng.integers(1, 3)                       # whole cycles, so the loop closes
        t = (phase * speed + offset) % 1.0
        y = 350 - t * 290
        x = x0 + 12 * math.sin(2 * math.pi * (t * 1.5 + offset))
        radius = rng.uniform(2.0, 4.2)
        strength = math.sin(math.pi * t) ** 1.5          # fade in, fade out
        field += strength * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * radius ** 2))
    return field


def frame(phase, rgb):
    shape = figure(phase)
    core = gaussian_filter(shape, 5)
    glow = gaussian_filter(shape, 20)
    halo = gaussian_filter(shape, 44)
    pulse = 0.88 + 0.12 * math.sin(2 * math.pi * phase)
    specks = motes(phase)

    alpha = np.clip(core * 0.95 + glow * 0.75 * pulse + halo * 0.55 * pulse + specks * 0.9, 0, 1)
    # White-hot at the heart, the chosen colour in the glow around it.
    whiteness = np.clip(core * 1.15 - 0.25, 0, 1) ** 1.3
    whiteness = np.maximum(whiteness, np.clip(specks, 0, 1) * 0.7)
    colour = np.array(rgb, np.float32)[None, None, :]
    pixels = colour * (1 - whiteness[..., None]) + 255.0 * whiteness[..., None]

    out = np.dstack([pixels, alpha[..., None] * 255.0]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def main():
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(repo, "img", "dancing-lights")
    os.makedirs(out_dir, exist_ok=True)
    only = sys.argv[1:] or list(COLOURS)

    for name in only:
        rgb = tuple(int(COLOURS[name][i:i + 2], 16) for i in (1, 3, 5))
        with tempfile.TemporaryDirectory() as tmp:
            for index in range(FRAMES):
                frame(index / FRAMES, rgb).save(os.path.join(tmp, f"f_{index:03d}.png"))
            webm = os.path.join(out_dir, f"DancingLightsMedium_{name}_400x400.webm")
            subprocess.run([
                "ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
                "-i", os.path.join(tmp, "f_%03d.png"),
                "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34",
                "-auto-alt-ref", "0", "-an", webm,
            ], check=True)
        thumb = frame(0.25, rgb).resize((200, 200), Image.LANCZOS)
        thumb.save(os.path.join(out_dir, f"DancingLightsMedium_{name}_Thumb.webp"), quality=90)
        print(f"{name}: {os.path.getsize(webm) // 1024} KB")


if __name__ == "__main__":
    main()
