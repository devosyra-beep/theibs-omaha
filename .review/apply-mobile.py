from pathlib import Path
import base64,gzip,hashlib,json,subprocess,runpy
out=Path('validation-output');out.mkdir(exist_ok=True)
(out/'tested-head.txt').write_text(subprocess.check_output(['git','rev-parse','HEAD'],text=True))
encoded=''.join(Path('.review/mobile-'+p+'.b64').read_text().strip() for p in 'abcd')
assert len(encoded)==14296
raw=gzip.decompress(base64.b64decode(encoded,validate=True))
assert hashlib.sha256(raw).hexdigest()=='874730e6901b23e449190e00482f3325e0f6a257ad824ace17d97abfaceff3fd'
plan=json.loads(raw)
assert plan['schema']==1 and plan['base']=='ec0fff201a01adbfb42a1787f0d3fa6c8fc3af76'
allowed={'codigo-fonte/public/mobile-ui.js','codigo-fonte/public/mobile-ui.css','codigo-fonte/scripts/qa-mobile-layout.cjs','codigo-fonte/public/index.html','codigo-fonte/public/service-worker.js'}
assert len(plan['changes'])==5 and {c['path'] for c in plan['changes']}==allowed
pending=[]
for c in plan['changes']:
 p=Path(c['path']);before=p.read_bytes() if p.exists() else None
 assert not p.is_symlink()
 assert (hashlib.sha256(before).hexdigest() if before is not None else None)==c['before'], 'Base changed: '+str(p)
 text=(before or b'').decode('utf-8');ceiling=len(text)
 for start,end,replacement in sorted(c['edits'],reverse=True):
  assert type(start)==int and type(end)==int and 0<=start<=end<=ceiling
  text=text[:start]+replacement+text[end:];ceiling=start
 after=text.encode('utf-8')
 assert hashlib.sha256(after).hexdigest()==c['after'], 'Candidate mismatch: '+str(p)
 pending.append((p,after))
for p,data in pending:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
runpy.run_path('.review/mobile-fix1.py')
manifest={path:hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in sorted(allowed)}
(out/'mobile-final-source-hashes.json').write_text(json.dumps(manifest,indent=2))
(out/'mobile-source-paths.txt').write_text('\n'.join(sorted(allowed))+'\n')
print('Applied exact five presentation/QA files. No engine, auth or persistence changes.')
