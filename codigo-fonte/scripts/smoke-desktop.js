const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-desktop-smoke-'));
process.env.THEIBS_DATA_PATH = path.join(temp, 'events.jsonl');
process.env.THEIBS_WORKSPACE_PATH = path.join(temp, 'workspace.json');

async function run() {
  const { server } = require('../server');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const window = new BrowserWindow({ width:1360, height:900, show:false, webPreferences:{ contextIsolation:true, nodeIntegration:false, sandbox:true } });
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
    const outcome = await window.webContents.executeJavaScript(`(async () => {
      await window.theibsApp.ready;
      const click = (selector) => {
        const button = document.querySelector(selector);
        if (!button) throw new Error('Elemento ausente: ' + selector);
        button.click();
      };
      for (const card of ['AE','KP','QC','JO','TE','9E','8P','2O']) click('[data-card="' + card + '"]');
      const flop = { hero:document.querySelector('#heroCards').value, board:document.querySelector('#board').value,
        street:document.querySelector('.street-tab.active').dataset.street,
        slots:document.querySelectorAll('[data-slot]').length, keys:document.querySelectorAll('.card-key').length,
        duplicateDisabled:document.querySelector('[data-card="AE"]').disabled };
      click('[data-card="4C"]');
      const turnStreet = document.querySelector('.street-tab.active').dataset.street;
      click('#undo-card');
      const afterUndo = document.querySelector('#board').value;
      document.querySelector('#opponentHand').value = '2E 3E 4P 5P 6O';
      document.querySelector('#players').value = '2';
      document.querySelector('#assumeNoRake').checked = true;
      click('#analyze-button');
      await new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
          const action = document.querySelector('#result .result-action')?.textContent;
          if (action) { clearInterval(timer); resolve(); }
          else if (Date.now() - start > 15000) { clearInterval(timer); reject(new Error('Análise não terminou')); }
        }, 50);
      });
      await window.theibsApp.flushSave();
      return { ...flop, turnStreet, afterUndo, action:document.querySelector('#result .result-action').textContent.trim() };
    })()`, true);
    assert.deepEqual(outcome, {
      hero:'AE KP QC JO TE', board:'9E 8P 2O', street:'FLOP', slots:10, keys:52,
      duplicateDisabled:true, turnStreet:'TURN', afterUndo:'9E 8P 2O', action:outcome.action
    });
    assert.match(outcome.action, /^(FOLD|CHECK|CALL|BET|RAISE)$/);
    if (process.env.THEIBS_SMOKE_SCREENSHOT) {
      const screenshot = await window.webContents.capturePage();
      require('node:fs').writeFileSync(process.env.THEIBS_SMOKE_SCREENSHOT, screenshot.toPNG());
    }
    process.stdout.write(`SMOKE_OK ${JSON.stringify(outcome)}\n`);
  } finally {
    window.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.exit(0)).catch((error) => {
  process.stderr.write(`SMOKE_FAIL ${error.stack}\n`);
  app.exit(1);
});
