# One-time, mechanical: replace raw values in app/app.css with the tokens in app/tokens.css that have exactly the
# same value (colors, font sizes, radii), so nothing on screen changes. Values with no exact token are left as
# they are; merging near-duplicates is a separate, visible step.
# Usage: python3 tools/tokenize-css.py   (prints what it replaced)
import re, pathlib, collections

root = pathlib.Path(__file__).resolve().parent.parent
tokens = (root / 'app/tokens.css').read_text()
css_path = root / 'app/app.css'
css = css_path.read_text()

def full(h):
    h = h.lower()
    return '#' + ''.join(c * 2 for c in h[1:]) if len(h) == 4 else h

# Primitive color tokens: value -> name (the first name wins if two share a value).
colors = {}
for name, value in re.findall(r'(--color-[a-z]+-?\d*):\s*(#[0-9a-fA-F]{3,6})\s*;', tokens):
    colors.setdefault(full(value), name)

counts = collections.Counter()

def color_sub(m):
    h = full(m.group(0))
    if h in colors:
        counts['color ' + h] += 1
        return f'var({colors[h]})'
    return m.group(0)

css = re.sub(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', color_sub, css)

SIZES = {11, 12, 13, 14, 16, 20, 24, 32}
def size_sub(m):
    n = int(m.group(1))
    if n in SIZES:
        counts['font-size'] += 1
        return f'font-size: var(--font-size-{n})'
    return m.group(0)
css = re.sub(r'font-size:\s*(\d+)px(?=\s*(?:!important)?\s*[;}])', size_sub, css)

RADII = {4: 'xs', 6: 'sm', 8: 'md', 12: 'lg', 999: 'full'}
def radius_sub(m):
    n = int(m.group(1))
    if n in RADII:
        counts['radius'] += 1
        return f'border-radius: var(--radius-{RADII[n]})'
    return m.group(0)
css = re.sub(r'border-radius:\s*(\d+)px(?=\s*(?:!important)?\s*[;}])', radius_sub, css)

css_path.write_text(css)
for k, v in sorted(counts.items(), key=lambda x: -x[1]):
    print(f'{v:4d}  {k}')
print('total', sum(counts.values()))
