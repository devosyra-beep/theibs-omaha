"""One-time source transport. No application execution or network access.
The compressed JSON preserves original UTF-8 and mixed line endings. Each old
and new source hash is checked; only this fixed webapp path list may change.
"""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = '126565b860aafea348906b15da21580c8fddece80aa719178159edb35c9eee11'
ALLOWED = set('''package.json
public/app.js
public/card-voice.js
public/continuation-view.js
public/cost-input.js
public/index.html
public/service-worker.js
public/statistics-ui.css
public/statistics-ui.js
public/voice-focus-ui.js
scripts/benchmark-keyboard-ui.cjs
scripts/qa-statistics-voice-focus.cjs
scripts/qa-voice-quality.cjs
server.js
src/action-ev-engine.js
src/action-validator.js
src/analysis-contract.js
src/coach.js
src/continuation-assessment.js
src/decision-engine.js
src/equity-engine.js
src/game-state.js
src/hand-insights.js
src/input-number.js
src/pot-math.js
src/statistical-summary.js
src/voice-stream-contract.js
test/analyze-online-http.test.cjs
test/analyze-safety-regression.test.cjs
test/cost-input.test.cjs
test/independent-omaha-reference.test.cjs
test/voice-ambiguity.test.cjs
test/voice-stream-contract.test.cjs'''.splitlines())
ALLOWED = {'codigo-fonte/' + path for path in ALLOWED}
encoded = ''.join((ROOT / '.review' / f'rc1-source-part{i}.b64').read_text().strip() for i in (1, 2))
if len(encoded) != 25220:
    raise SystemExit('Invalid source payload length')
raw = gzip.decompress(base64.b64decode(encoded, validate=True))
if hashlib.sha256(raw).hexdigest() != EXPECTED:
    raise SystemExit('Source transport hash mismatch; no file has been changed')
plan = json.loads(raw)
if plan['schema'] != 1 or plan['baseCommit'] != '7b4953b0ddb6d78fbd4b60d836159d6e1cf3969e' or plan['targetBranch'] != 'analyze-statistics-0.14.6':
    raise SystemExit('Unexpected source base or branch')
changes = plan['changes']
if len(changes) != len(ALLOWED) or {item['path'] for item in changes} != ALLOWED:
    raise SystemExit('Source path set does not match the reviewed scope')
verify_only = '--verify-only' in sys.argv
pending = []
for item in changes:
    path = ROOT / item['path']
    if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
        raise SystemExit('Unsafe source path')
    current = path.read_bytes() if path.exists() else None
    current_hash = hashlib.sha256(current).hexdigest() if current is not None else None
    if verify_only:
        if current_hash != item['after']:
            raise SystemExit('Candidate source changed during validation: ' + item['path'])
        continue
    if current_hash != item['before']:
        raise SystemExit('Source base changed; reconcile instead of overwriting: ' + item['path'])
    source = current or b''
    ceiling = len(source)
    for start, length, replacement in sorted(item['edits'], key=lambda edit: edit[0], reverse=True):
        if type(start) is not int or type(length) is not int or not isinstance(replacement, str) or start < 0 or length < 0 or start + length > ceiling:
            raise SystemExit('Invalid or overlapping source edit')
        source = source[:start] + replacement.encode('utf-8') + source[start + length:]
        ceiling = start
    if hashlib.sha256(source).hexdigest() != item['after']:
        raise SystemExit('Candidate hash mismatch: ' + item['path'])
    pending.append((path, source))
# All files must pass validation before the first write.
for path, source in pending:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(source)
evidence = ROOT / 'validation-output'
evidence.mkdir(exist_ok=True)
(evidence / 'source-manifest.json').write_text(json.dumps({'baseCommit': plan['baseCommit'], 'version': plan['version'], 'sourceDeltaSha256': EXPECTED, 'files': {item['path']: item['after'] for item in changes}}, indent=2))
(evidence / 'source-paths.txt').write_text('\n'.join(sorted(ALLOWED)) + '\n')
print(('Verified' if verify_only else 'Applied') + ' exactly ' + str(len(changes)) + ' reviewed webapp files; main and hosting are untouched.')
