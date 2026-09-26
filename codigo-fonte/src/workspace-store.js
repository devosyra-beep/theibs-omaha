'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CardKeyboardState } = require('../public/card-model');
const { DEFAULT_PATH } = require('./training-store');
const WORKSPACE_PATH = process.env.THEIBS_WORKSPACE_PATH || path.join(path.dirname(DEFAULT_PATH), 'workspace.json');

function validateSimpleBackup(backup) {
  if (backup == null) return;
  if (typeof backup !== 'object' || Array.isArray(backup)) throw new Error('Backup do modo Simples inválido. O arquivo foi preservado.');
  const cards = new CardKeyboardState();
  if (!cards.restore(backup.keyboard)) throw new Error('Cartas do backup do modo Simples inválidas: ' + cards.error);
  if (!backup.fields || typeof backup.fields !== 'object' || Array.isArray(backup.fields)) throw new Error('Configurações do backup do modo Simples inválidas.');
}

function readWorkspace(file = WORKSPACE_PATH) {
  if (!fs.existsSync(file)) return { revision: 0, workspace: null };
  const text = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > 512000) throw new Error('Arquivo de rascunho excede o limite. O arquivo foi preservado.');
  const stored = JSON.parse(text);
  if (!Number.isInteger(stored.revision) || stored.revision < 0) throw new Error('Revisão do rascunho inválida. O arquivo foi preservado.');
  if (stored.workspace?.multiway != null) require('./multiway-session').validateRecord(stored.workspace.multiway);
  validateSimpleBackup(stored.workspace?.multiwaySimple);
  return stored;
}
function validateWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace) || workspace.schemaVersion !== 1) throw new Error('Formato de rascunho não suportado.');
  const cards = new CardKeyboardState();
  if (!cards.restore(workspace.keyboard)) throw new Error(cards.error);
  if (!workspace.fields || typeof workspace.fields !== 'object' || Array.isArray(workspace.fields)) throw new Error('Configurações inválidas.');
  if (!workspace.ui || !['roxo', 'verde', 'azul', 'preto'].includes(workspace.ui.felt) || !['classico', 'cores'].includes(workspace.ui.deck)) throw new Error('Preferências visuais inválidas.');
  if (!Array.isArray(workspace.snapshots) || workspace.snapshots.length > 4) throw new Error('Snapshot de análises inválido.');
  if (workspace.handFlow) require('./hand-flow').replay(workspace.handFlow.config,workspace.handFlow.events);
  if (workspace.multiway != null) require('./multiway-session').validateRecord(workspace.multiway);
  validateSimpleBackup(workspace.multiwaySimple);
  if (Buffer.byteLength(JSON.stringify(workspace)) > 480000) throw new Error('Rascunho muito grande.');
  return workspace;
}
function saveWorkspace(workspace, expectedRevision, file = WORKSPACE_PATH) {
  validateWorkspace(workspace);
  const previous = readWorkspace(file);
  if (!Number.isInteger(expectedRevision) || previous.revision !== expectedRevision) {
    const error = new Error('O rascunho mudou em outra janela. Recarregue antes de salvar; nenhum dado foi sobrescrito.');
    error.statusCode = 409; throw error;
  }
  const stored = { revision: previous.revision + 1, updatedAt: new Date().toISOString(), workspace };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  return { revision: stored.revision, updatedAt: stored.updatedAt };
}
module.exports = { WORKSPACE_PATH, readWorkspace, saveWorkspace, validateWorkspace };
