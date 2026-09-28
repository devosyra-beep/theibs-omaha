from pathlib import Path
import hashlib,json
root=Path.cwd()
checks={'mobile-ui.js':('a632c2fafa8d8580d496848604a7fda20b19114df285fa0b71da1bcefaac47f3','96b61030d75f71b034e5c3993017dcceccb4102f21a540e8c1d5b2a91856678f'),'mobile-ui.css':('d6e409bdecfcb862656da08dfb18e0802a047748d62fa0271529d427f9e1f319','9d636eabb15945a663c3d740e9947bc12cb9e8932e0d3dff259cd31ab5973082')}
for name,(before,after) in checks.items():
 p=root/'codigo-fonte/public'/name
 assert hashlib.sha256(p.read_bytes()).hexdigest()==before
p=root/'codigo-fonte/public/mobile-ui.js'
s=p.read_text();s=s.replace("const menu = sheet('mobile-menu', 'THEIBS');", "const menu = sheet('mobile-menu', 'THEIBS');\n  // Navigation must remain available when Analyze itself is hidden.\n  document.body.append(menu.el);")
p.write_text(s)
p=root/'codigo-fonte/public/mobile-ui.css';s=p.read_text()
s=s.replace('grid-template-columns:80px minmax(90px,1fr) 100px','grid-template-columns:86px minmax(90px,1fr) 100px')
s=s.replace('font:16px var(--font-sans); border-radius:10px;','font:16px var(--font-sans); border-radius:10px; appearance:none; background-image:none; box-sizing:border-box;')
s=s.replace(" body.mobile-workspace .analysis-context-bar label[for=opponent-count]::before", " body.mobile-workspace .analysis-context-bar label::after { content:'⌄'; position:absolute; right:9px; top:12px; font:16px/20px var(--font-sans); color:var(--muted); pointer-events:none; }\n body.mobile-workspace .analysis-context-bar label[for=opponent-count]::before")
s=s.replace("#selected-card-label { margin:2px 0; min-height:0; font:10px/14px var(--font-sans); }", "#selected-card-label { display:none; }")
s=s.replace('.table-felt { display:grid; grid-template-columns:minmax(0,1fr); gap:7px;', '.table-felt { display:grid; grid-template-columns:minmax(0,1fr); gap:5px;')
s=s.replace(' body.mobile-workspace[data-view=analyze] #mobile-model-tag', ' body.mobile-workspace[data-view=analyze] #mobile-metrics .ev-topline { display:block; }\n body.mobile-workspace[data-view=analyze] #mobile-metrics #ev-state { display:block; margin-top:3px; }\n body.mobile-workspace[data-view=analyze][data-deck=cores] .table-surface .playing-card .pip { display:block; position:absolute; inset:3px 4px auto auto; padding:0; font-size:12px; line-height:1; width:auto; height:auto; }\n body.mobile-workspace[data-view=analyze] #mobile-model-tag')
p.write_text(s)
for name,(before,after) in checks.items():
 assert hashlib.sha256((root/'codigo-fonte/public'/name).read_bytes()).hexdigest()==after
(root/'validation-output/mobile-fix1-hashes.json').write_text(json.dumps(checks,indent=2))
print('Verified two presentation-only fixes against source hashes.')
