# Finds raw colors in app/app.css that are nearly the same as a primitive token (CIE76 ΔE below the limit) and,
# with --apply, replaces them with that token. ΔE under ~2 is invisible side by side; up to 5 is a shade
# only noticeable when compared directly.
# Usage: python3 tools/merge-near-colors.py [limit=5] [--apply]
import re, sys, math, pathlib, collections

root = pathlib.Path(__file__).resolve().parent.parent
limit = float(next((a for a in sys.argv[1:] if not a.startswith('--')), 5))
apply = '--apply' in sys.argv
# Tints that read as a different hue (info blues, teal, a violet-tinted white) stay as they are.
SKIP = {'#e5edfd', '#e3edfd', '#dbeafe', '#f4f4ff', '#dcf3ef', '#c7d2fe'}
tokens = (root / 'app/tokens.css').read_text()
css_path = root / 'app/app.css'
css = css_path.read_text()

def full(h):
    h = h.lower()
    return '#' + ''.join(c * 2 for c in h[1:]) if len(h) == 4 else h

def lab(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = lin(r), lin(g), lin(b)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722)
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)

prims = {}
for name, value in re.findall(r'(--color-(?:neutral|slate|violet|green|amber|orange|red|blue)-\d+):\s*(#[0-9a-fA-F]{6})', tokens):
    prims.setdefault(full(value), name)
plab = {h: lab(h) for h in prims}

raw = collections.Counter(full(h) for h in re.findall(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', css))
plan = {}
for h, n in raw.items():
    best = min(plab, key=lambda p: math.dist(lab(h), plab[p]))
    d = math.dist(lab(h), plab[best])
    if d < limit and h not in SKIP:
        plan[h] = (prims[best], best, d, n)
for h, (name, p, d, n) in sorted(plan.items(), key=lambda x: x[1][2]):
    print(f'{h} x{n:<2} -> {name} ({p})  ΔE {d:.1f}')
print(f'{len(plan)} colors, {sum(v[3] for v in plan.values())} uses')
if apply:
    def sub(m):
        h = full(m.group(0))
        return f'var({plan[h][0]})' if h in plan else m.group(0)
    css_path.write_text(re.sub(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', sub, css))
    print('applied')
