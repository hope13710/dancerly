# One-time cleanup: CSS rules for classes no code uses, imports nobody reads, and one unused function.
# Each was checked: the class name appears in no JS or HTML (and no class is built from pieces with its
# prefix); each import name appears only on its import line.
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent

DEAD = ('account-who avatar-btn brand-mark checklist-sample count-tag doc-editor focus-sum grip member-list nf-cats '
        'nf-cats-clear note-foot pc-speed person-actions plan-card plan-cards plan-price plan-try r-owner '
        'recap-busy-legacy recap-lang recap-note recap-page recap-usage sample-banner sec-practice share-form share-link '
        'sheet-summary side-group side-link sketch-tag spark steps-count team-note team-tag time-dash welcome-share '
        'who-cell who-stack').split()
pat = re.compile(r'\.(' + '|'.join(map(re.escape, DEAD)) + r')(?![\w-])')

p = root / 'app/app.css'
css = p.read_text()
removed = 0
def rule(m):
    global removed
    head, body = m.group(1), m.group(2)
    # Keep comments and whitespace before the selector.
    lead = re.match(r'^(\s*(?:/\*.*?\*/\s*)*)', head, re.S).group(1)
    sel = head[len(lead):]
    parts = [x for x in sel.split(',')]
    keep = [x for x in parts if not pat.search(x)]
    if len(keep) == len(parts):
        return m.group(0)
    removed += len(parts) - len(keep)
    if not keep:
        return lead.rstrip(' \t') if lead.strip() else ''
    return lead + ','.join(keep).strip() + ' {' + body + '}'
# Only plain rules (no nested braces), at any depth inside @media too.
css = re.sub(r'([^{}]*?)\{([^{}]*)\}', rule, css)
css = re.sub(r'@media[^{]*\{\s*\}', '', css)
css = re.sub(r'\n{3,}', '\n\n', css)
p.write_text(css)
print('selectors removed', removed)

UNUSED = {
    'app/review.js': ['initials', 'checkTakeFile'],
    'app/main.js': ['timeAgo', 'withUploadBar', 'loadMembers', 'uploadTake', 'checkTakeFile', 'signupSource'],
    'app/views/queue.js': ['initials', 'timeAgo'],
    'app/views/share.js': ['canShareLinks'],
    'app/views/settings.js': ['initials', 'cols', 'schema'],
    'app/views/groups.js': ['initials'],
    'app/views/recaps.js': ['actionSheet', 'tabs'],
    'app/views/requests.js': ['initials'],
    'app/views/shared.js': ['initials'],
    'app/views/inbox.js': ['$$', 'initials'],
    'app/views/project.js': ['initials'],
    'app/views/people.js': ['initials'],
}
for f, names in UNUSED.items():
    path = root / f
    s = path.read_text()
    def imp(m):
        items = [x.strip() for x in m.group(1).split(',') if x.strip()]
        keep = [x for x in items if x.split(' as ')[-1].strip() not in names]
        if keep == items:
            return m.group(0)
        if not keep:
            return ''
        return 'import { ' + ', '.join(keep) + ' } from ' + m.group(2)
    s2 = re.sub(r'^import\s*\{([^}]*)\}\s*from\s*([\'"][^\'"]+[\'"];?)[ \t]*$', imp, s, flags=re.M)
    s2 = re.sub(r'^\n', '', s2) if s2.startswith('\n') else s2
    if f == 'app/review.js':
        line = "  const roleOf = (id) => (members.find((m) => m.user_id === id)?.role === 'owner' ? 'Owner' : 'Member');\n"
        assert line in s2
        s2 = s2.replace(line, '')
    path.write_text(s2)
    print(f, 'ok')
