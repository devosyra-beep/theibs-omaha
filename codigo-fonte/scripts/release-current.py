"""Build a runtime-only ZIP and verify every entry before distribution."""
import hashlib
import json
import os
import sys
from pathlib import Path
import zipfile

source = Path(__file__).resolve().parents[1]
root = source.parent
manifest_path = source / 'release-manifest.json'
previous = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
version = json.loads((source / 'package.json').read_text(encoding='utf-8-sig'))['version']
desktop = Path(os.environ['USERPROFILE']) / 'Desktop'
destination = desktop / f'THEIBS-{version}-Windows-x64.zip'
verification = root / '.release-check' / f'v{version}'
desktop_folder = desktop / f'THEIBS-{version}-Windows-x64'
assert not destination.exists(), 'Release ZIP already exists; do not overwrite silently'
assert not verification.exists(), 'Verification directory already exists'
assert not desktop_folder.exists(), 'Desktop version already exists'

# Validate evidence before creating a distributable. A UI-only release may
# retain numerical baselines, but a training-engine release must run its suite.
validation = []
presentation_only = '--presentation-only' in sys.argv
training_release = '--training-release' in sys.argv
focus_ui = '--focus-ui' in sys.argv
multiway_release = '--multiway-release' in sys.argv
shortcut_release = '--shortcut-release' in sys.argv
suites = [
    ('clean-assistant-edge', f'clean-assistant-v{version}/edge-functional-report.json'),
    ('clean-assistant-electron', f'clean-assistant-v{version}/electron-functional-report.json'),
]
if shortcut_release:
    assert presentation_only, 'Shortcut change preserves numerical baselines'
    suites = [('shift-edge', f'shift-v{version}/edge-report.json'), ('shift-electron', f'shift-v{version}/electron-report.json')]
elif multiway_release:
    assert not presentation_only, 'Multiway requires current numerical validation'
    suites = [
        ('multiway-edge', f'multiway-v{version}/edge-report.json'),
        ('multiway-electron', f'multiway-v{version}/electron-report.json'),
        ('multiway-races', f'multiway-races-v{version}/edge-report.json'),
        ('nuts-edge', f'nuts-v{version}/edge-report.json'),
        ('nuts-electron', f'nuts-v{version}/electron-report.json'),
        ('focus-ui-edge', f'focus-v{version}/edge-report.json'),
        ('focus-ui-electron', f'focus-v{version}/electron-report.json'),
        ('training-layout-electron', f'training-layout-v{version}/electron-report.json'),
    ]
elif focus_ui:
    assert presentation_only, 'Focus UI release must preserve numerical validation baselines'
    suites = [
        ('focus-ui-edge', f'focus-v{version}/edge-report.json'),
        ('focus-ui-electron', f'focus-v{version}/electron-report.json'),
        ('training-layout-electron', f'training-layout-v{version}/electron-report.json'),
    ]
elif training_release:
    suites += [
        ('training-coach-edge', f'training-coach-v{version}/edge-local-report.json'),
        ('training-coach-electron-live', f'training-coach-v{version}/electron-live-report.json'),
        ('training-layout-electron', f'training-layout-v{version}/electron-report.json'),
    ]
elif not presentation_only:
    suites = [
        ('clean-assistant-edge', f'clean-assistant-v{version}/edge-functional-report.json'),
        ('clean-assistant-electron-live', f'clean-assistant-v{version}/electron-live-report.json'),
        ('appearance', f'appearance-v{version}/electron-report.json'),
        ('intelligence', f'intelligence-v{version}/electron-report.json'),
        ('keyboard', 'teclado-electron.json'),
    ]
for suite, relative in suites:
    report = json.loads((root / 'validacao' / relative).read_text(encoding='utf-8-sig'))
    assert report.get('version', version) == version, 'Stale evidence'
    assert not report.get('failure') and report.get('status', 'PASS') == 'PASS'
    validation.append({'suite': suite, 'status': 'PASS', 'evidence': relative, 'checks': report['checks']})
unit_tests = None
if not presentation_only:
    unit = json.loads((root / 'validacao' / f'unit-v{version}.json').read_text(encoding='utf-8-sig'))
    assert unit['version'] == version and unit['fail'] == 0 and unit['pass'] == unit['tests'] and unit['tests'] > 0
    unit_tests = unit['tests']
    validation.append({'suite': 'unit', 'status': 'PASS', 'evidence': f'unit-v{version}.json', 'checks': [f'{unit_tests} tests passed']})
entries = previous['entries']
hashes = []
for name in entries:
    file = (root / name).resolve()
    assert file.is_relative_to((root / 'THEIBS').resolve())
    data = file.read_bytes()
    hashes.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in entries:
        archive.write(root / name, name)
with zipfile.ZipFile(destination) as archive:
    assert archive.namelist() == entries
    assert archive.testzip() is None
    archive.extractall(verification)
    archive.extractall(desktop_folder)
for target in (verification, desktop_folder):
    for entry in hashes:
        assert hashlib.sha256((target / entry['path']).read_bytes()).hexdigest() == entry['sha256']
manifest = dict(version=version, zip=str(destination), files=len(entries),
    uncompressedBytes=sum(x['bytes'] for x in hashes), zipBytes=destination.stat().st_size,
    sha256=hashlib.sha256(destination.read_bytes()).hexdigest(), entries=entries, entryHashes=hashes,
    verified='CRC and SHA256 for every entry in both extracted copies', validation=validation,
    unitTests=unit_tests, verificationDirectory=str(verification), desktopDirectory=str(desktop_folder),
    llama={'model':'llama3.2:1b','integration':'LIVE_PACKAGED_ELECTRON','purpose':'validated fact selection',
           'modelsIncludedInZip':False,'automaticTraining':False,'acceleratesMonteCarlo':False},
    performanceBaseline=previous.get('performanceBaseline', {'version': previous['version'], 'measurements':previous.get('performance',[]),
                         'note':'Previous showdown numerical-engine benchmark; not remeasured for this release'}))
if training_release:
    benchmarks = [json.loads(file.read_text(encoding='utf-8-sig')) for file in sorted((root / 'validacao').glob('training-http-*.json'))]
    benchmark = next(item for item in reversed(benchmarks) if item.get('version') == version)
    manifest['trainingPerformance'] = {key: benchmark[key] for key in ['at','scope','runtime','cpu','samplesPerOption','cases']}
    manifest['trainingPerformance']['note'] = 'Three states per scenario; full policy rollouts, not showdown simulations/s. Not a latency guarantee.'
    manifest['trainingModel'] = 'Finite sizing grid, 256 rollouts per option, uniform opponent prior, heuristic continuation policies; no GTO or automatic learning.'
if multiway_release:
    manifest['multiway'] = {'mode': 'optional user-observed actions', 'shortcuts': {',':'CALL', '.':'CHECK', ';':'BET/RAISE'},
        'preservesPhysicalSeats': True, 'automaticOpponentResponses': False,
        'limitations': ['EV requires hero turn and explicit response assumptions', 'No EV for all-ins or side pots', 'No result settlement UI at showdown']}
    manifest['llama']['integration'] = 'NOT_RERUN_MULTIWAY_RELEASE'
    manifest['llama']['lastVerifiedVersion'] = '0.8.0'
    manifest['trainingPerformanceBaseline'] = previous.get('trainingPerformanceBaseline', {'version': previous['version'], 'rerun': False, 'measurements': previous.get('trainingPerformance')})
if presentation_only:
    manifest['unitTestBaseline'] = {'version': previous['version'], 'tests': previous.get('unitTests'), 'rerun': False}
    manifest['llama']['integration'] = 'NOT_RERUN_PRESENTATION_ONLY'
    manifest['llama']['lastVerifiedVersion'] = previous.get('llama', {}).get('lastVerifiedVersion', previous['version'])
    manifest['performanceBaseline'] = previous.get('performanceBaseline', manifest['performanceBaseline'])
    if previous.get('trainingPerformance'):
        manifest['trainingPerformanceBaseline'] = {'version': previous['version'], 'rerun': False, 'measurements': previous['trainingPerformance']}
    elif previous.get('trainingPerformanceBaseline'):
        manifest['trainingPerformanceBaseline'] = previous['trainingPerformanceBaseline']
    if previous.get('multiway'):
        manifest['multiway'] = previous['multiway']
if shortcut_release:
    manifest['newHandShortcut'] = 'Shift alone on release in Analyze; clears hand and observed actions, preserving Multiway configuration'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({key: manifest[key] for key in ['version','zip','zipBytes','sha256','desktopDirectory']}, indent=2))
