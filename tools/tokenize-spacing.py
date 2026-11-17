# Spacing, step A (mechanical, nothing on screen changes): px values in padding, margin and gap declarations
# that are on the spacing scale become var(--space-N). 0, 1px (hairlines), negatives and off-scale values
# stay as they are; those are the next, visible step.
# Usage: python3 tools/tokenize-spacing.py [file=app/app.css]
import re, sys, pathlib, collections

root = pathlib.Path(__file__).resolve().parent.parent
path = root / (sys.argv[1] if len(sys.argv) > 1 else 'app/app.css')
css = path.read_text()
SCALE = {2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80}
counts = collections.Counter()

def value_sub(v):
    def px(m):
        if m.group(1):  # negative: leave it
            return m.group(0)
        n = int(m.group(2))
        if n in SCALE:
            counts[n] += 1
            return f'var(--space-{n})'
        return m.group(0)
    return re.sub(r'(?<![\w.-])(-)?(\d+)px\b', px, v)

def decl(m):
    return m.group(1) + value_sub(m.group(2))

# Only real declarations (not custom properties): padding, margin, gap and their longhands.
css = re.sub(r'((?<![-\w])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-start|-end)?)?\s*:)([^;}]+)', decl, css)
path.write_text(css)
print(dict(sorted(counts.items())), 'total', sum(counts.values()))
