'use strict';
const { execFile } = require('node:child_process');
const { server } = require('../server');
const port = Number(process.env.THEIBS_PORT || 4173);
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Porta ocupada. Feche a outra instancia ou defina THEIBS_PORT.' : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`THEIBS: ${url}\nMantenha esta janela aberta. Ctrl+C encerra o motor.`);
  const command = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(...command, error => { if (error) console.log(`Abra manualmente: ${url}`); });
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
