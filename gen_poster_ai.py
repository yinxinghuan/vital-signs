#!/usr/bin/env ~/miniconda3/bin/python3
"""
Vital Signs poster — img2img off the live splash screenshot.

Pipeline:
  1. Ref = current live poster on GH Pages (the splash composite we already shipped)
  2. wdabuliu API img2img with editorial poster prompt — keeps the
     bedside-monitor structure but re-renders as cinematic still
  3. Download (webp → png if needed)
  4. Optional PIL title composite if the model fights typography
"""

import json, os, ssl, subprocess, time, urllib.request

USER_ID = 618336286
API_URL = "http://aiservice.wdabuliu.com:8019/genl_image"
REF_URL = "https://yinxinghuan.github.io/games/posters/vital-signs.png"
OUT = "/Users/yin/code/games/games/posters/vital-signs.png"
RAW_DIR = "/Users/yin/code/games/_poster_raw"
os.makedirs(RAW_DIR, exist_ok=True)

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

# Use the reference's monitor frame composition but re-render as an
# editorial cinematic photo. We DO NOT want the model to invent UI / read
# the existing labels — describe only the scene we want.
PROMPT = (
    "editorial cinematic poster photograph, perfect 1:1 square composition, "
    "moody dark hospital intensive care room at night seen through a vintage "
    "CCTV bedside monitor screen — the monitor itself is the dominant central "
    "subject, a chunky beige medical instrument with a heavy plastic bezel, "
    "a curved CRT display in the middle showing a teal-green glowing scene of "
    "a patient lying peacefully on an ER table covered to the chest with a "
    "white sheet, oxygen mask on, IV line taped to one arm, faint EKG "
    "electrode wires, calm dignified expression, eyes closed, illuminated by a "
    "single overhead lamp casting cold teal light, "
    "the monitor's frame has a small red REC indicator dot in the top corner, "
    "faint horizontal scanlines and a soft phosphor bloom on the CRT, "
    "a glowing single-trace heart rhythm line (sharp green ECG R-wave) curves "
    "across the lower third of the entire poster outside the monitor like a "
    "graphic element, "
    "above the monitor in the upper one-quarter of the canvas is a "
    "completely empty deep matte-black sky reserved for typography, "
    "below the monitor a thin clean band of empty negative space, "
    "subtle film grain, deep blacks, dim cool teal and warm amber accents, "
    "editorial still-life mood, AlterU After Dark cinematic palette, "
    "single dominant subject, generous negative space, "
    "absolutely no text, no letters, no captions, no logos, no watermarks, "
    "no UI labels, no readout numbers, no signage of any kind"
)


def call_api(prompt, ref_url):
    params = {"prompt": prompt, "user_id": USER_ID, "url": ref_url}
    body = json.dumps({"query": "", "params": params}).encode()
    req = urllib.request.Request(API_URL, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=360, context=SSL_CTX) as r:
        resp = json.loads(r.read())
    if resp.get("code") != 200:
        raise RuntimeError(f"API code={resp.get('code')} resp={resp}")
    return resp["url"]


def download(url, out_path):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as r:
        data = r.read()
    with open(out_path, "wb") as f:
        f.write(data)
    if out_path.endswith(".webp"):
        png = out_path[:-5] + ".png"
        subprocess.run(["sips", "-s", "format", "png", out_path, "--out", png],
                       check=True, capture_output=True)
        return png
    return out_path


def composite(raw_path, out_path):
    """Title composite. ER-mono lookalike — IBM Plex Mono Bold,
    glowing trace-green over the dark upper void."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.open(raw_path).convert("RGB").resize((1024, 1024), Image.LANCZOS)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Pick a mono font that's available locally.
    mono = next((p for p in [
        "/Users/yin/Library/Fonts/IBMPlexMono-Bold.ttf",
        "/Users/yin/Library/Fonts/IBMPlexMono-SemiBold.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Courier.dfont",
    ] if os.path.exists(p)), None)

    title = "VITAL  SIGNS"
    fpx = 132
    f_title = ImageFont.truetype(mono, fpx) if mono else ImageFont.load_default()

    widths = [draw.textbbox((0, 0), ch, font=f_title)[2] for ch in title]
    total = sum(widths) + (len(title) - 1) * 4
    x = (1024 - total) / 2
    y = 92

    # Subtle outer glow — multiple soft draws then the crisp top
    glow = (127, 255, 175, 64)
    for off in range(6, 0, -1):
        for dx in (-off, 0, off):
            for dy in (-off, 0, off):
                if dx == 0 and dy == 0:
                    continue
                xi = x
                for i, ch in enumerate(title):
                    draw.text((xi + dx, y + dy), ch, fill=glow, font=f_title)
                    xi += widths[i] + 4
    # crisp top layer
    xi = x
    for i, ch in enumerate(title):
        draw.text((xi, y), ch, fill=(232, 255, 230, 254), font=f_title)
        xi += widths[i] + 4

    # tagline (Cormorant italic, dim, just below)
    serif = next((p for p in [
        "/Users/yin/Library/Fonts/CormorantGaramond-MediumItalic.ttf",
        "/System/Library/Fonts/Supplemental/Times Italic.ttf",
    ] if os.path.exists(p)), None)
    if serif:
        f_tag = ImageFont.truetype(serif, 36)
        tag = "night shift · their pulse is in your finger"
        tw = draw.textbbox((0, 0), tag, font=f_tag)[2]
        draw.text(((1024 - tw) / 2, y + fpx + 16), tag,
                  fill=(216, 230, 220, 220), font=f_tag)

    final = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    final.save(out_path, "PNG", quality=95)
    print(f"composited → {out_path}")


if __name__ == "__main__":
    t0 = time.time()
    print(f"ref: {REF_URL}")
    print("requesting img2img…")
    url = call_api(PROMPT, REF_URL)
    print(f"result {url}  ({time.time()-t0:.1f}s)")

    ext = ".webp" if url.endswith(".webp") else ".png"
    raw = download(url, os.path.join(RAW_DIR, f"vital-signs_raw{ext}"))
    print(f"raw → {raw}")

    composite(raw, OUT)
    print("done")
