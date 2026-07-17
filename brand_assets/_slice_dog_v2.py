# Slice "dog-sprite V2.png" (irregular labeled sheet on white) into per-animation
# strips with transparent backgrounds, uniform square frames, bottom-centered.
# Usage:  python _slice_dog_v2.py --analyze   (report components only)
#         python _slice_dog_v2.py             (write dog/<anim>.png + manifest.json)
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).parent
SRC = HERE / "dog-sprite V2.png"
OUT = HERE / "dog"

img = Image.open(SRC).convert("RGBA")
px = np.array(img)  # (H, W, 4)
H, W = px.shape[:2]
print(f"sheet: {W}x{H}")

# --- 1. Key out the white background, but only where it touches the border ---
near_white = (px[:, :, :3] >= 235).all(axis=2)
# Label white regions; any label present on the border is background.
wl, _ = ndimage.label(near_white)
border_labels = np.unique(np.concatenate([wl[0], wl[-1], wl[:, 0], wl[:, -1]]))
background = np.isin(wl, border_labels) & near_white
px[background, 3] = 0

# --- 2. Connected components of what's left ---
opaque = px[:, :, 3] > 0
# Dilate so a dog's detached parts (ears, tails, motion ticks) merge into one blob.
blob = ndimage.binary_dilation(opaque, iterations=3)
labels, n = ndimage.label(blob)
slices = ndimage.find_objects(labels)

comps = []
for i, sl in enumerate(slices, start=1):
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    if h < 70:  # drop text labels, sparkles, Zz, stray ticks
        continue
    comps.append({"x": xs.start, "y": ys.start, "w": w, "h": h, "label": i})

# --- 3. Group into rows by vertical overlap of bboxes ---
comps.sort(key=lambda c: c["y"])
rows = []
for c in comps:
    for row in rows:
        # same row if vertical ranges overlap by half the smaller height
        top = max(c["y"], row["y0"])
        bot = min(c["y"] + c["h"], row["y1"])
        if bot - top > 0.4 * min(c["h"], row["y1"] - row["y0"]):
            row["items"].append(c)
            row["y0"] = min(row["y0"], c["y"])
            row["y1"] = max(row["y1"], c["y"] + c["h"])
            break
    else:
        rows.append({"y0": c["y"], "y1": c["y"] + c["h"], "items": [c]})
for row in rows:
    row["items"].sort(key=lambda c: c["x"])

print(f"{len(rows)} rows:")
for r, row in enumerate(rows):
    sizes = " ".join(f"{c['w']}x{c['h']}@{c['x']},{c['y']}" for c in row["items"])
    print(f"  row {r}: {len(row['items'])} comps  {sizes}")

if "--analyze" in sys.argv:
    sys.exit(0)

# --- 4. Map row/order -> animations (verified against --analyze output) ---
# Sheet layout: IDLE(4) WALK(4) RUN(5) / HAPPY(3) JUMP(4) WAG(4) /
#               BARK(3) SIT(2) LAYDOWN(3) SLEEP(1) / EXCITED(4) SHAKE(2) LOOK(4) [palette dropped]
PLAN = [
    [("idle", 4), ("walk", 4), ("run", 5)],
    [("happy", 3), ("jump", 4), ("wag", 4)],
    [("bark", 3), ("sit", 2), ("laydown", 3), ("sleep", 1)],
    [("excited", 4), ("shake", 2), ("look", 4)],
]

anims = {}
ok = True
for r, plan_row in enumerate(PLAN):
    want = sum(n for _, n in plan_row)
    have = rows[r]["items"]
    if len(have) < want:
        print(f"!! row {r}: want {want} frames, found {len(have)} — aborting")
        ok = False
        continue
    i = 0
    for name, count in plan_row:
        anims[name] = have[i : i + count]
        i += count
if not ok:
    sys.exit(1)

# --- 5. Uniform square frame box across ALL animations (bottom-centred) ---
# Measure tight opaque bboxes (undilated) inside each component region.
def tight_bbox(c):
    region = opaque[c["y"] : c["y"] + c["h"], c["x"] : c["x"] + c["w"]]
    ys, xs = np.where(region)
    return (c["x"] + xs.min(), c["y"] + ys.min(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1, c["label"])

boxes = {name: [tight_bbox(c) for c in cs] for name, cs in anims.items()}
side = max(max(max(w, h) for (_, _, w, h, _) in bs) for bs in boxes.values())
side = int(side) + 2  # 1px breathing room
print(f"frame box: {side}x{side}")

OUT.mkdir(exist_ok=True)
manifest = {"frame": side, "animations": {}}
sheet = Image.fromarray(px)

for name, bs in boxes.items():
    strip = Image.new("RGBA", (side * len(bs), side), (0, 0, 0, 0))
    for f, (x, y, w, h, lab) in enumerate(bs):
        # Mask to this component's own pixels — a raw rect crop drags in
        # clipped fragments of neighbouring sparkles/ticks (they share x-space).
        region = px[y : y + h, x : x + w].copy()
        region[labels[y : y + h, x : x + w] != lab, 3] = 0
        crop = Image.fromarray(region)
        # bottom-centre: feet share a baseline so loops don't bob
        strip.paste(crop, (f * side + (side - w) // 2, side - h - 1), crop)
    strip.save(OUT / f"{name}.png")
    manifest["animations"][name] = {"frames": len(bs)}
    print(f"  {name}: {len(bs)} frames -> dog/{name}.png")

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
print("manifest written")
