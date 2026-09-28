'use strict';
const fs = require('node:fs');
const path = require('node:path');
const checks = new Map();
const inferences = new Map();
let inferenceBusy = false;

function configPath(env = process.env) {
  const base = env.THEIBS_WORKSPACE_PATH || env.THEIBS_DATA_PATH || path.join(__dirname, '..', 'data', 'workspace.json');
  return env.THEIBS_LLM_CONFIG_PATH || path.join(path.dirname(base), 'llm-config.json');
}
function validateConfig(raw = {}) {
  const provider = String(raw.provider || 'none').toLowerCase();
  if (!['none', 'ollama'].includes(provider)) throw Error('Provedor local inválido.');
  const model = String(raw.model || '').trim();
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) throw Error('Nome do modelo inválido.');
  let url;
  try { url = new URL(String(raw.baseUrl || 'http://127.0.0.1:11434')); } catch { throw Error('Endpoint local inválido.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Use somente a origem HTTP local do Ollama, sem senha, caminho ou parâmetros.');
  const timeoutMs = Number(raw.timeoutMs ?? 45000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 3000 || timeoutMs > 60000) throw Error('Timeout deve ficar entre 3000 e 60000 ms.');
  return { provider, model, baseUrl: url.origin, timeoutMs };
}
function readConfig(env = process.env, file = configPath(env)) {
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.length > 16000) throw Error('Configuração local excessiva; arquivo preservado.');
    const raw = JSON.parse(text);
    if (raw.schemaVersion !== 1) throw Error('Versão de configuração local inválida; arquivo preservado.');
    return { config: validateConfig(raw), source: 'FILE' };
  }
  return { config: validateConfig({ provider: env.THEIBS_LLM_PROVIDER || 'none', model: env.THEIBS_LLM_MODEL || '',
    baseUrl: env.THEIBS_LLM_URL, timeoutMs: env.THEIBS_LLM_TIMEOUT_MS }), source: env.THEIBS_LLM_PROVIDER ? 'ENV' : 'DEFAULT' };
}
function saveConfig(raw, env = process.env, file = configPath(env)) {
  const config = validateConfig(raw);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: 1, ...config }, null, 2), { encoding: 'utf8', mode: 0o600 });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  return { config, source: 'FILE' };
}
function configKey(config) { return `${config.provider}|${config.baseUrl}|${config.model}`; }
function publicState(selected = readConfig()) {
  const { config, source } = selected, key = configKey(config);
  return { config, source, availability: checks.get(key) || {
    state: config.provider === 'none' ? 'DISABLED' : 'NOT_CHECKED', checkedAt: null, probe: null, models: [],
    reason: config.provider === 'none' ? 'Treinador local selecionado.' : 'Configuração salva; disponibilidade ainda não verificada.'
  }, lastInference: inferences.get(key) || null };
}
async function checkAvailability(selected = readConfig(), fetchImpl = fetch, timeoutMs = 4000) {
  const { config } = selected, checkedAt = new Date().toISOString();
  let result;
  // The check can discover installed models even while local explanations are selected.
  try {
    const response = await fetchImpl(new URL('/api/tags', config.baseUrl), { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.models)) throw Error('Resposta de modelos inválida.');
    const models = data.models.map(item => String(item.name || item.model || '')).filter(name => /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(name));
    const installed = models.includes(config.model) || (!config.model.includes(':') && models.includes(`${config.model}:latest`));
    result = { state: config.provider === 'none' ? 'DISABLED' : installed ? 'AVAILABLE' : 'MODEL_MISSING', models,
      reason: config.provider === 'none' ? 'Ollama respondeu; selecione e salve um modelo para utilizá-lo.' : installed
        ? 'Ollama respondeu e o modelo está instalado. A geração de texto será verificada ao perguntar.' : 'Ollama respondeu, mas o modelo selecionado não está instalado.',
      serviceReachable: true };
  } catch (error) {
    result = { state: 'UNAVAILABLE', models: [], serviceReachable: false,
      reason: error.name === 'TimeoutError' ? 'Ollama não respondeu à verificação em 4 segundos.' : 'Não foi possível acessar o Ollama local.' };
  }
  checks.set(configKey(config), { ...result, checkedAt, probe: 'MODEL_LIST' });
  return publicState(selected);
}
async function startLocalServer(selected = readConfig()) {
  const config = validateConfig(selected.config);
  if (!['http://127.0.0.1:11434', 'http://localhost:11434'].includes(config.baseUrl)) throw Error('Início automático disponível somente para o Ollama local na porta 11434.');
  const current = await checkAvailability(selected, fetch, 500);
  if (current.availability.serviceReachable) return { ...current, start: 'ALREADY_RUNNING' };
  const executable = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA || !fs.existsSync(executable)) throw Error('Ollama não encontrado na instalação local esperada.');
  const { spawn } = require('node:child_process');
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['serve'], { windowsHide: true, detached: true, stdio: 'ignore',
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_CONTEXT_LENGTH: '2048' } });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  let state = current;
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 400));
    state = await checkAvailability(selected, fetch, 650);
    if (state.availability.serviceReachable) return { ...state, start: 'STARTED' };
  }
  return { ...state, start: 'STARTING', reason: 'Processo iniciado, mas o serviço ainda não respondeu; verifique novamente em instantes.' };
}
function runtimeConfig(env = process.env) {
  // Existing callers/tests may explicitly provide a legacy environment object.
  if (env !== process.env) return validateConfig({ provider: env.THEIBS_LLM_PROVIDER || env.provider, model: env.THEIBS_LLM_MODEL || env.model,
    baseUrl: env.THEIBS_LLM_URL || env.baseUrl, timeoutMs: env.THEIBS_LLM_TIMEOUT_MS || env.timeoutMs });
  return readConfig(env).config;
}
async function chat(config, messages, { format, fetchImpl = fetch, maxTokens = 192, signal } = {}) {
  config = validateConfig(config);
  signal?.throwIfAborted();
  if (config.provider !== 'ollama' || !config.model) throw Error('Escolha e salve um modelo local.');
  if (inferenceBusy) { const error = Error('O modelo local já está respondendo outra pergunta.'); error.code = 'LLM_BUSY'; throw error; }
  inferenceBusy = true;
  const started = performance.now(), key = configKey(config);
  const combinedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs);
  try {
    const response = await fetchImpl(new URL('/api/chat', config.baseUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ model: config.model, stream: false, keep_alive: '2m',
        ...(format ? { format } : {}), options: { temperature: .2, num_predict: Math.max(32, Math.min(192, Math.trunc(maxTokens))), num_ctx: 2048, num_thread: 2 }, messages }),
      signal: combinedSignal
    });
    if (!response.ok) throw Error(`Ollama HTTP ${response.status}`);
    const data = await response.json(), answer = String(data?.message?.content || '').trim();
    combinedSignal.throwIfAborted();
    if (!answer) throw Error('O modelo retornou uma resposta vazia.');
    const inference = { state: 'SUCCEEDED', checkedAt: new Date().toISOString(), elapsedMs: performance.now() - started };
    inferences.set(key, inference);
    return { text: answer.slice(0, 6000), inference };
  } catch (error) {
    inferences.set(key, { state: signal?.aborted ? 'CANCELLED' : 'FAILED', checkedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
      reason: error.name === 'TimeoutError' ? `O modelo não concluiu em ${config.timeoutMs / 1000}s; pode estar carregando.` : 'A geração local falhou.' });
    throw error;
  } finally { inferenceBusy = false; }
}
module.exports = { configPath, validateConfig, readConfig, saveConfig, publicState, checkAvailability, startLocalServer, runtimeConfig, chat };
