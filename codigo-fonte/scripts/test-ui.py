"""End-to-end UI checks against the real local Theibs HTTP server.
Requires Python + playwright and a Chromium binary (--chromium PATH optional).
Normal mode navigates to the real HTTP origin including its CSP. --bridge is
only for this isolated validation container: enterprise policy forbids URL
navigation. It injects the original DOM/assets into about:blank and forwards
requests to the real isolated server (no simulated analysis or responses).
It does NOT validate production CSP, clipboard permissions or native downloads.
All data are in a temporary directory; the delivered history is never written.
"""
from pathlib import Path
import argparse, json, os, re, shutil, socket, subprocess, tempfile, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
args=argparse.ArgumentParser()
args.add_argument('--bridge',action='store_true')
args.add_argument('--chromium',default=None)
args.add_argument('--out',default=str(ROOT/'validation/browser'))
opt=args.parse_args(); OUT=Path(opt.out);OUT.mkdir(parents=True,exist_ok=True)
report={'mode':'about:blank bridge to REAL HTTP' if opt.bridge else 'HTTP navigation','checks':[], 'errors':[], 'screenshots':[]}

def check(name,condition):
    if not condition: raise AssertionError(name)
    report['checks'].append({'name':name,'status':'PASS'})
    print('PASS',name,flush=True)

def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='theibs-ui-') as temp:
    process=None
    def start():
        global process,base
        p=port();base=f'http://127.0.0.1:{p}'
        env={**os.environ,'THEIBS_PORT':str(p),'THEIBS_DATA_PATH':str(Path(temp)/'events.jsonl'),'THEIBS_WORKSPACE_PATH':str(Path(temp)/'workspace.json')}
        process=subprocess.Popen(['node','server.js'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(80):
            try:urllib.request.urlopen(base+'/api/status',timeout=1).read();return
            except (OSError,urllib.error.URLError):time.sleep(.1)
        raise RuntimeError('Isolated test server failed to start')
    start()
    try:
      with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=opt.chromium,args=['--no-sandbox'] if os.name!='nt' else [])
        context=browser.new_context(viewport={'width':1600,'height':1000},device_scale_factor=1)
        payloads=[]
        def load():
            page=context.new_page();page.set_default_timeout(12000)
            page.on('pageerror',lambda e:report['errors'].append(str(e)))
            page.on('dialog',lambda d:d.accept())
            def bridge(route):
                req=route.request
                data=req.post_data.encode() if req.post_data else None
                if '/api/analyze' in req.url:payloads.append(json.loads(req.post_data))
                u=urllib.request.Request(req.url,data=data,headers={'Content-Type':'application/json'},method=req.method)
                try:
                    with urllib.request.urlopen(u,timeout=30) as r:status=r.status;body=r.read();headers=dict(r.headers)
                except urllib.error.HTTPError as e:status=e.code;body=e.read();headers=dict(e.headers)
                headers['Access-Control-Allow-Origin']='*'
                route.fulfill(status=status,body=body,headers=headers)
            if opt.bridge:
                page.route(base+'/**',bridge)
                html=(ROOT/'public/index.html').read_text(encoding='utf-8')
                html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>','',html)
                page.set_content(html.replace('<head>',f'<head><base href="{base}/">'),wait_until='networkidle')
            else:
                page.on('request',lambda req:payloads.append(json.loads(req.post_data)) if '/api/analyze' in req.url else None)
                page.goto(base,wait_until='networkidle')
            page.evaluate('window.theibsApp.ready');return page
        page=load()
        state=lambda:page.evaluate('window.theibsCardKeyboard.state.snapshot()')
        app=lambda:page.evaluate('window.theibsApp.getState()')
        def clean_save():
            page.evaluate('window.theibsApp.flushSave()')
            page.wait_for_function('!theibsApp.getState().saveBusy && !theibsApp.getState().saveDirty')
        def shot(name):
            page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(70)
            page.screenshot(path=str(OUT/name),full_page=True);report['screenshots'].append(name)
        def analyze():
            page.locator('#quick-analyze').click();page.wait_for_function('!theibsApp.getState().analysisBusy')
        check('initial UI has 5 private slots and 52 click keys',page.locator('#hero-slots [data-slot]').count()==5 and page.locator('[data-card]').count()==52)
        check('no fabricated initial equity',page.locator('#hero-equity').inner_text()=='—')
        page.locator('[data-slot="0"]').click();page.keyboard.type('aekcqojp10e')
        check('physical Portuguese keys + 10 auto-advance',state()['slots'][:5]==['AE','KC','QO','JP','TE'] and state()['selected']==5)
        page.keyboard.type('ae')
        check('duplicate card rejected across groups',state()['slots'][5] is None and 'já está' in page.locator('#keyboard-status').inner_text())
        page.keyboard.press('Backspace')
        check('Backspace cancels a pending rank without deleting a completed card',state()['slots'][4]=='TE')
        page.keyboard.type('9e8c2o')
        check('flop auto-advances to turn',state()['selected']==8)
        page.keyboard.press('Backspace')
        check('Backspace undoes last complete card',state()['slots'][7] is None)
        page.locator('[data-card="2O"]').click()
        check('click entry and physical keyboard share one state',state()['slots'][7]=='2O')
        old=state()['slots'][:];page.locator('#opponentHand').fill('2P 3P 4P 5P 6P');page.locator('#players').fill('2')
        check('typing into context fields does not trigger card shortcuts',state()['slots']==old)
        analyze()
        check('real PLO5 analysis returns exact equity',app()['lastAnalysis']['data']['status']=='OK' and app()['lastAnalysis']['data']['equity']['method']=='EXACT')
        check('C/P converted correctly at real API boundary',payloads[-1]['heroCards']==['As','Kh','Qd','Jc','Ts'] and payloads[-1]['opponentHand']=='2c 3c 4c 5c 6c')
        page.locator('button[data-felt="verde"]').click();page.locator('button[data-deck="cores"]').click()
        shot('01-analise-desktop.png')
        page.locator('button[data-deck="classico"]').click();shot('01b-analise-classico.png');page.locator('button[data-deck="cores"]').click()
        page.locator('[data-slot="6"]').click();page.keyboard.press('Delete')
        check('Delete leaves an explicit board gap',state()['slots'][6] is None and state()['slots'][7]=='2O')
        count=len(payloads);analyze()
        check('a board gap cannot reach analysis API',len(payloads)==count and page.locator('#quick-action').inner_text()=='NO_DECISION')
        page.locator('[data-slot="6"]').click();page.keyboard.press('Control+z')
        check('undo restores deleted position',state()['slots'][6]=='8C')
        page.keyboard.press('Control+4');check('Ctrl+4 selects river without changing data',state()['selected']==9)
        page.locator('.raw-entry summary').click();old=state()['slots'][:]
        page.locator('#paste-cards').fill('KC 3E');page.locator('#paste-apply').click()
        check('invalid paste is atomic',state()['slots']==old)
        page.locator('#heroCards').fill('AE AE');analyze()
        check('invalid manual text blocks API and click grid',page.locator('#quick-action').inner_text()=='NO_DECISION' and page.locator('[data-card]:enabled').count()==0)
        clean_save();page.close();page=load();page.locator('.raw-entry summary').click()
        check('invalid text draft survives reload without silently committing',page.locator('#heroCards').input_value()=='AE AE' and page.evaluate('theibsCardKeyboard.isManualInvalid()'))
        page.locator('#heroCards').fill('AE KC QO JP 10E');analyze()
        check('manual editing recovers original state and real engine result',app()['lastAnalysis']['data']['status']=='OK')
        page.evaluate("window._realFetch=window.fetch; window.fetch=async(...a)=>{const r=await _realFetch(...a); if(String(a[0]).includes('/api/analyze'))await new Promise(resolve=>setTimeout(resolve,500)); return r;}")
        page.locator('#quick-analyze').click();page.locator('#potBeforeAction').fill('13');page.wait_for_function('!theibsApp.getState().analysisBusy')
        check('late analysis cannot overwrite edited input with stale result',app()['lastAnalysis'] is None and page.locator('#quick-action').inner_text()=='—')
        page.evaluate('window.fetch=window._realFetch');page.locator('#potBeforeAction').fill('12');analyze()
        clean_save();saved=state();saved_equity=app()['lastAnalysis']['data']['equity']['equity']
        page.close();page=load()
        check('reload restores cards, settings, analysis and visual preferences',state()==saved and page.evaluate('document.body.dataset.felt')=='verde' and page.evaluate('document.body.dataset.deck')=='cores' and app()['lastAnalysis']['data']['equity']['equity']==saved_equity)
        clean_save();page.close();old_base=base;process.terminate();process.wait(timeout=5);start();page=load()
        check('server restart with different port preserves workspace',base!=old_base and state()==saved and app()['lastAnalysis'] is not None)
        for n in [4,6]:
            page.locator('#new-hand').click();page.locator('#variant-select').select_option(str(n));page.locator('[data-slot="0"]').click()
            hero=['AE','KC','QO','JP','TE','9P'][:n];board=['8E','7C','6O','5E','4C']
            page.keyboard.type(''.join(hero+board))
            page.locator('#opponentHand').fill(' '.join(['2P','3P','4P','5P','6P','7P'][:n]));analyze()
            check(f'PLO{n}: full keyboard and native evaluator API',app()['lastAnalysis']['data']['status']=='OK' and payloads[-1]['variant']==f'PLO{n}_HIGH' and len(payloads[-1]['heroCards'])==n)
            check(f'PLO{n}: strategy limitation is visible',page.locator('#variant-warning').is_visible())
        page.locator('.nav-tab[data-view="train"]').click();page.locator('#training-style').select_option('PASSIVE');page.locator('#training-mode').select_option('GUIDED');page.locator('#training-start').click()
        page.wait_for_function('!theibsApp.getState().trainingBusy && !!theibsApp.getState().trainingSession')
        session=app()['trainingSession'];check('training uses PLO6 and hides opponent cards',session['variant']=='PLO6_HIGH' and len(session['heroCards'])==6 and 'opponentCards' not in session)
        page.locator('#training-question').fill('Qual é a premissa desta decisão?');page.locator('#training-ask').click();page.wait_for_function('!theibsApp.getState().trainingBusy')
        check('guided coach returns real local explanation',len(page.locator('#training-coach').inner_text())>30)
        page.locator('[data-action="CALL"]').click();page.wait_for_function('!theibsApp.getState().trainingBusy')
        check('training action advances real session to flop and records feedback',app()['trainingSession']['street']=='FLOP' and page.locator('#training-feedback').is_visible())
        shot('02-treino-desktop.png')
        for _ in range(8):
            s=app()['trainingSession']
            if s['finished']:break
            action='CALL' if s['amountToCall'] else 'CHECK'
            page.locator(f'[data-action="{action}"]').click();page.wait_for_function('!theibsApp.getState().trainingBusy')
        s=app()['trainingSession'];check('showdown reveals opponent only after completion',s['finished'] and len(s['opponentCards'])==6)
        check('training conserves total chips',s['heroStack']+s['opponentStack']+s['pot']==200)
        page.locator('#training-mode').select_option('CHALLENGE');page.locator('#training-start').click();page.wait_for_function('!theibsApp.getState().trainingBusy')
        page.locator('#training-ask').click();page.wait_for_function('!theibsApp.getState().trainingBusy')
        check('challenge does not leak pre-action advice','desafio' in page.locator('#training-coach').inner_text().lower())
        page.locator('[data-action="FOLD"]').click();page.wait_for_function('!theibsApp.getState().trainingBusy')
        check('fold never reveals private opponent cards','opponentCards' not in app()['trainingSession'])
        page.locator('.nav-tab[data-view="history"]').click();page.wait_for_function("document.querySelectorAll('#history-recent .history-hand').length === 5")
        check('history shows real recorded decisions',len(page.locator('#history-recent').inner_text())>30)
        shot('03-historico-desktop.png')
        page.locator('.nav-tab[data-view="analyze"]').click()
        for width,height in [(1366,900),(950,900),(390,844)]:
            page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(100)
            check(f'layout {width}px: no horizontal document overflow',page.evaluate('document.documentElement.scrollWidth')<=width)
            shot(f'04-layout-{width}.png')
        page.set_viewport_size({'width':1600,'height':1000});page.keyboard.press('F1');check('F1 opens accessible help dialog',page.locator('#help-dialog').is_visible());page.locator('#close-help').click()
        check('no JavaScript runtime errors',len(report['errors'])==0)
        clean_save();browser.close()
    except Exception as error:
        report['failure']=str(error)
        try:page.screenshot(path=str(OUT/'FAILED.png'),full_page=True)
        except Exception:pass
        raise
    finally:
        if process and process.poll() is None:process.terminate();process.wait(timeout=5)
        report['passed']=len(report['checks']);(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
