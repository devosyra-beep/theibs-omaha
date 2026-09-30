'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dataRoot = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'THEIBS')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'theibs');
fs.mkdirSync(dataRoot, { recursive: true });
process.env.THEIBS_DATA_PATH ||= path.join(dataRoot, 'training-events.jsonl');
process.env.THEIBS_WORKSPACE_PATH ||= path.join(dataRoot, 'workspace.json');
process.env.THEIBS_LLM_CONFIG_PATH ||= path.join(dataRoot, 'llm-config.json');

const { ensureInitialHistory } = require('./src/data-bootstrap');
ensureInitialHistory(process.env.THEIBS_DATA_PATH, path.join(__dirname, 'data', 'training-events.jsonl'));

const port = Number(process.env.THEIBS_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const { server } = require('./server');

function openBrowser(url) {
  const command = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

server.once('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`${origin}/api/status`);
      if (response.ok) { openBrowser(origin); process.exit(0); }
    } catch {}
  }
  console.error(`THEIBS failed to start: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`THEIBS WebApp available at ${origin}`);
  console.log(`Dados locais em ${dataRoot}`);
  console.log('Mantenha esta janela aberta. Pressione Ctrl+C para encerrar.');
  openBrowser(origin);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
