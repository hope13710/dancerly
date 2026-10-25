"""Renders the sample rehearsal videos: five dancers, four eights at 100 BPM, an original synthesized track.
Take 1 has the mistakes the sample notes talk about; Take 2 fixes most of them (the canon is still off).
Usage: python3 make_sample.py OUT_DIR
"""
import math, os, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
W, H, FPS = 854, 480, 24
BPM = 100
BEAT = 60 / BPM
SR = 44100

def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)

# ---------- choreography ----------
# beat index n (0-based from count 1). eight = n // 8, count = n % 8 + 1
# Arm angles in degrees from straight down (0 = down, 90 = side, 170 = up).
ARMS = {1: (20, 20), 2: (90, 90), 3: (160, 160), 4: (90, 90), 5: (170, 30), 6: (30, 170), 7: (120, 120), 8: (10, 10)}
V_SHAPE = [(-2, 0.0), (-1, 0.5), (0, 1.0), (1, 0.5), (2, 0.0)]   # x slot, depth (0 front .. 1 back)
LINE = [(-2, 0.4), (-1, 0.4), (0, 0.4), (1, 0.4), (2, 0.4)]

def pose(t, count1, dancer, take):
    """Returns (x_slot, depth, left_arm, right_arm, bounce, lean) for a dancer at time t."""
    b = (t - count1) / BEAT
    if b < 0:  # count-in: standing, small groove
        return V_SHAPE[dancer][0], V_SHAPE[dancer][1], 15, 15, 0.5 + 0.5 * math.sin(t * 6), 0
    # Mistakes in take 1 (and the canon one in both takes)
    delay = 0.0
    eight = int(b // 8)
    if take == 1 and dancer == 1 and eight in (0, 2) and 4 <= b % 8 < 6.5:
        delay = 0.5  # Maya: late arms on 5-6
    if dancer == 4 and eight == 2:
        delay += 0.5 if take == 1 else 0.25  # canon: last dancer half a count off (still a bit off in take 2)
    if eight == 2:
        delay += dancer * 0.5  # the canon itself: one half count per dancer
    bb = max(0.0, b - delay)
    n = int(bb)
    frac = bb - n
    c, cn = n % 8 + 1, (n + 1) % 8 + 1
    e = int(n // 8)
    if e >= 3 and (n % 8) >= 6:  # ending pose freeze from 4-7
        la, ra = 170, 40
        if take == 1 and dancer == 3 and bb > 3 * 8 + 7.3:
            la, ra = 120, 40  # drops the ending pose early
        x, d = LINE[dancer]
        return x, d, la, ra, 0, -8 if dancer % 2 else 8
    k = ease(min(1.0, frac * 2.2))  # sharp hits
    la = ARMS[c][0] + (ARMS[cn][0] - ARMS[c][0]) * (k if frac > 0.55 else 0)
    ra = ARMS[c][1] + (ARMS[cn][1] - ARMS[c][1]) * (k if frac > 0.55 else 0)
    # Formation: V for eight 1, travel to a line during eight 2, line after
    pos = min(1.0, max(0.0, (b - 8) / 8))
    p = ease(pos)
    x = V_SHAPE[dancer][0] * (1 - p) + LINE[dancer][0] * p
    d = V_SHAPE[dancer][1] * (1 - p) + LINE[dancer][1] * p
    if take == 1 and dancer == 3 and 8 <= b < 24:
        x -= 0.35 * ease((b - 8) / 6)  # drifts left in the formation change
    bounce = abs(math.sin(math.pi * frac))
    return x, d, la, ra, bounce, 0

# ---------- drawing ----------
BG = Image.new('RGB', (W, H))
bgd = ImageDraw.Draw(BG)
for y in range(H):
    v = y / H
    col = (int(30 + 18 * v), int(28 + 14 * v), int(44 + 10 * v))
    bgd.line([(0, y), (W, y)], fill=col)
bgd.polygon([(0, H * 0.62), (W, H * 0.62), (W, H), (0, H)], fill=(52, 46, 58))
for i in range(-6, 7):  # floor boards
    bgd.line([(W / 2 + i * 40, H * 0.62), (W / 2 + i * 160, H)], fill=(60, 54, 66), width=1)
for x in (0.25, 0.5, 0.75):  # spike tape marks
    cx = W * x
    bgd.line([(cx - 12, H * 0.86), (cx + 12, H * 0.86)], fill=(214, 190, 80), width=3)
bgd.rectangle([W * 0.08, H * 0.12, W * 0.92, H * 0.6], outline=(70, 66, 92), width=2)  # mirror frame on the back wall
glow = Image.new('L', (W, H), 0)
ImageDraw.Draw(glow).ellipse([W * 0.2, -H * 0.4, W * 0.8, H * 0.5], fill=60)
glow = glow.filter(ImageFilter.GaussianBlur(60))
BG = Image.composite(Image.new('RGB', (W, H), (150, 140, 210)), BG, glow)

SHIRTS = [(225, 225, 235), (240, 190, 200), (200, 220, 245), (230, 220, 180), (200, 235, 210)]

def draw_dancer(dr, x_slot, depth, la, ra, bounce, lean, color):
    scale = 1.0 - 0.18 * depth
    cx = W / 2 + x_slot * 120 * (1 - 0.15 * depth)
    feet = H * (0.9 - 0.16 * depth) - bounce * 6 * scale
    hgt = 190 * scale
    hip = (cx + lean * 0.3, feet - hgt * 0.47)
    sh = (cx + lean, feet - hgt * 0.8)
    head = (sh[0], sh[1] - hgt * 0.11)
    lw = max(4, int(11 * scale))
    dark = tuple(int(c * 0.55) for c in color)
    # legs
    dr.line([hip, (cx - 16 * scale, feet)], fill=(40, 40, 52), width=lw + 2)
    dr.line([hip, (cx + 16 * scale, feet)], fill=(40, 40, 52), width=lw + 2)
    # torso
    dr.line([hip, sh], fill=color, width=int(lw * 2.4))
    # arms
    arm = hgt * 0.36
    for side, ang in ((-1, la), (1, ra)):
        a = math.radians(ang)
        sx, sy = sh[0] + side * 12 * scale, sh[1] + 4
        ex = sx + side * math.sin(a) * arm
        ey = sy + math.cos(a) * arm
        dr.line([(sx, sy), (ex, ey)], fill=dark, width=lw)
    r = hgt * 0.075
    dr.ellipse([head[0] - r, head[1] - r, head[0] + r, head[1] + r], fill=(235, 205, 180))

def render(take, count1, total, path):
    frames_dir = os.path.join(OUT, f'frames{take}')
    os.makedirs(frames_dir, exist_ok=True)
    n = int(total * FPS)
    for f in range(n):
        t = f / FPS
        img = BG.copy()
        dr = ImageDraw.Draw(img)
        poses = [(i, pose(t, count1, i, take)) for i in range(5)]
        for i, (x, d, la, ra, bo, le) in sorted(poses, key=lambda p: -p[1][1]):
            draw_dancer(dr, x, d, la, ra, bo, le, SHIRTS[i])
        dr.text((12, H - 22), f'IMG_20{41 + take} · {int(t // 60):02d}:{t % 60:04.1f}', fill=(170, 170, 190))
        img.save(os.path.join(frames_dir, f'{f:05d}.png'))
    wav = os.path.join(OUT, f'audio{take}.wav')
    write_audio(wav, count1, total)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(frames_dir, '%05d.png'), '-i', wav,
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'slow', '-profile:v', 'main', '-movflags', '+faststart',
                    '-c:a', 'aac', '-b:a', '96k', '-shortest', path], check=True)
    thumb = Image.open(os.path.join(frames_dir, f'{int(min(n - 1, (count1 + 2.2) * FPS)):05d}.png')).convert('RGB')
    thumb.thumbnail((480, 270))
    thumb.save(path.replace('.mp4', '.jpg'), quality=80)

# ---------- music: original 100 BPM track ----------
def write_audio(path, count1, total):
    n = int(total * SR)
    out = np.zeros(n)
    rng = np.random.default_rng(7)
    def add(start, sig):
        i = int(start * SR)
        if i >= n:
            return
        j = min(n, i + len(sig))
        out[i:j] += sig[: j - i]
    def kick():
        t = np.arange(int(0.25 * SR)) / SR
        return 0.9 * np.sin(2 * np.pi * (50 + 90 * np.exp(-t * 30)) * t) * np.exp(-t * 12)
    def snare():
        t = np.arange(int(0.2 * SR)) / SR
        return 0.45 * rng.uniform(-1, 1, len(t)) * np.exp(-t * 22) + 0.2 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    def hat(v=0.12):
        t = np.arange(int(0.05 * SR)) / SR
        return v * rng.uniform(-1, 1, len(t)) * np.exp(-t * 80)
    def bass(freq, dur):
        t = np.arange(int(dur * SR)) / SR
        return 0.25 * np.sign(np.sin(2 * np.pi * freq * t)) * np.exp(-t * 3)
    # count-in: "5, 6, 7, 8" sticks
    for k in range(4):
        add(count1 - (4 - k) * BEAT, hat(0.35))
    notes = [55, 55, 65.4, 49]
    beats = int((total - count1) / BEAT)
    for b in range(beats):
        t0 = count1 + b * BEAT
        add(t0, hat())
        add(t0 + BEAT / 2, hat(0.08))
        if b % 2 == 0:
            add(t0, kick())
        else:
            add(t0, snare())
        if b % 8 in (4, 5):  # the accent everyone hits on 5-6
            add(t0, 0.5 * snare())
        if b % 2 == 0:
            add(t0, bass(notes[(b // 8) % 4], BEAT * 2))
    out = np.tanh(out * 1.2) * 0.8
    pcm = (out * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    # Take 1: count 1 at 1.20 s. Take 2 was started earlier: count 1 at 2.05 s (so music sync has work to do).
    render(1, 1.20, 1.20 + 32 * BEAT + 1.0, os.path.join(OUT, 'sample-take-1.mp4'))
    render(2, 2.05, 2.05 + 32 * BEAT + 1.0, os.path.join(OUT, 'sample-take-2.mp4'))
    print('done')
