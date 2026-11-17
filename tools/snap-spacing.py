# Spacing, step B (visible, 1–4px): off-scale px in padding, margin and gap snap to the nearest step.
# 10 and 14 depend on what they space: a gap gets the tighter step (8, 12), padding and margin the roomier
# one (12, 16), so controls don't get cramped. Negatives and 1px hairlines stay.
# Usage: python3 tools/snap-spacing.py [file=app/app.css]
import re, sys, pathlib, collections

root = pathlib.Path(__file__).resolve().parent.parent
path = root / (sys.argv[1] if len(sys.argv) > 1 else 'app/app.css')
css = path.read_text()
NEAREST = {3: 4, 5: 4, 7: 8, 9: 8, 11: 12, 18: 16, 22: 24, 26: 24, 28: 32, 30: 32, 36: 32}
counts = collections.Counter()

def decl(m):
    prop, value = m.group(1), m.group(2)
    is_gap = 'gap' in prop
    def px(mm):
        if mm.group(1):
            return mm.group(0)
        n = int(mm.group(2))
        to = NEAREST.get(n) or ({10: 8, 14: 12} if is_gap else {10: 12, 14: 16}).get(n)
        if not to:
            return mm.group(0)
        counts[f'{n}->{to}'] += 1
        return f'var(--space-{to})'
    return prop + re.sub(r'(?<![\w.-])(-)?(\d+)px\b', px, value)

css = re.sub(r'((?<![-\w])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-start|-end)?)?\s*:)([^;}]+)', decl, css)
path.write_text(css)
print(dict(sorted(counts.items())), 'total', sum(counts.values()))
