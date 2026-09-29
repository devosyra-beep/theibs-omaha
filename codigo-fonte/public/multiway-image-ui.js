(function () {
  'use strict';
  const model = window.TheibsImageModel;
  const cards = window.TheibsCards;
  const $ = selector => document.querySelector(selector);
  const ocrUrl = '/vendor/ocr/tesseract.min.js';
  let dialog, preview, fileInput, cameraInput, imageUrl = '', image = null, busy = false, sequence = 0;
  let worker = null, profile = 'GGPOKER', zoneName = 'hero', handToken = '', findings = { hero: null, board: null };
  const zones = Object.fromEntries(Object.entries(model.PROFILES).map(([key, value]) => [key, { hero: [...value.hero], board: [...value.board] }]));
  try {
    const saved = JSON.parse(localStorage.getItem('theibs-image-zones-v1') || '{}');
    for (const name of Object.keys(zones)) for (const area of ['hero', 'board']) {
      const accepted = model.normalizeZone(saved[name]?.[area]);
      if (accepted) zones[name][area] = accepted;
    }
  } catch { /* Private browsing can disable local storage. */ }
  function saveZones() { try { localStorage.setItem('theibs-image-zones-v1', JSON.stringify(zones)); } catch { /* Optional calibration memory. */ } }
  const appState = () => window.theibsApp?.getState?.() || {};
  function token(state) { return JSON.stringify([state.multiway?.config, state.multiway?.events]); }
  function status(message, error = false) {
    const node = $('#mw-image-status'); node.textContent = message; node.classList.toggle('is-error', error);
  }
  function currentZone() { return zones[profile][zoneName]; }
  function layoutPreview() {
    if (!image) return;
    const stage = $('#mw-image-stage');
    const maxWidth = Math.max(140, dialog.clientWidth - 44), maxHeight = Math.max(160, Math.floor(window.innerHeight * .42));
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
    const width = Math.max(1, Math.floor(image.naturalWidth * scale)), height = Math.max(1, Math.floor(image.naturalHeight * scale));
    stage.style.width = `${width}px`; preview.style.width = `${width}px`; preview.style.height = `${height}px`;
  }
  function zoneFields() {
    const zone = currentZone();
    ['x1', 'y1', 'x2', 'y2'].forEach((key, i) => { $(`#mw-image-${key}`).value = String(Math.round(zone[i] * 100)); });
    const box = $('#mw-image-box');
    box.style.left = `${zone[0] * 100}%`; box.style.top = `${zone[1] * 100}%`;
    box.style.width = `${(zone[2] - zone[0]) * 100}%`; box.style.height = `${(zone[3] - zone[1]) * 100}%`;
    box.textContent = zoneName === 'hero' ? 'Suas cartas' : 'Board';
  }
  function readCardField(id) {
    const value = $(`#mw-image-${id}`).value.trim();
    if (!value) return [];
    const tokens = value.split(/[\s,;|/]+/).filter(Boolean);
    const result = tokens.map(model.parseCard);
    if (result.includes(null)) throw Error(`Corrija ${id === 'hero' ? 'suas cartas' : 'o board'}: use Ah Ks Qd Jc, por exemplo.`);
    return result;
  }
  function displayFindings() {
    for (const name of ['hero', 'board']) {
      const finding = findings[name];
      $(`#mw-image-${name}-confidence`).textContent = !finding ? 'Não lido' : finding.status === 'NOT_READ'
        ? 'Não reconhecido' : finding.confidence == null ? 'OCR sem confiança calibrada · confira cada carta'
          : `Pontuação OCR ${Math.round(finding.confidence * 100)}% (não calibrada) · confira cada carta`;
      if (finding?.cards?.length) $(`#mw-image-${name}`).value = finding.cards.join(' ');
    }
  }
  function invalidateZone() {
    findings[zoneName] = null;
    $(`#mw-image-${zoneName}`).value = '';
    $(`#mw-image-${zoneName}-confidence`).textContent = 'Área alterada · ler novamente';
  }
  function setBusy(value) {
    busy = value;
    for (const node of dialog.querySelectorAll('button,input,select')) if (node.dataset.mwImageClose !== 'true') node.disabled = value;
    dialog.setAttribute('aria-busy', String(value));
  }
  function releaseImage() {
    sequence++;
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    imageUrl = ''; image = null; preview.removeAttribute('src');
    $('#mw-image-stage').hidden = true;
  }
  async function loadImage(file) {
    releaseImage(); findings = { hero: null, board: null }; displayFindings();
    $('#mw-image-hero').value = ''; $('#mw-image-board').value = '';
    $('#mw-image-file-name').textContent = 'Nenhuma imagem selecionada';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) { status('Escolha uma imagem de até 12 MB.', true); return; }
    const current = ++sequence;
    const next = new Image();
    try {
      imageUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
      });
      next.src = imageUrl; await next.decode();
      if (current !== sequence) return;
      if (next.naturalWidth * next.naturalHeight > 24_000_000) throw Error('resolução acima de 24 megapixels');
      image = next; preview.src = imageUrl; $('#mw-image-stage').hidden = false; layoutPreview();
      $('#mw-image-file-name').textContent = file.name;
      handToken = token(appState());
      status('Imagem pronta. Ajuste as áreas e tente ler; confirme cada carta antes de aplicar.');
      zoneFields();
    } catch (error) { if (current === sequence) { releaseImage(); status(`Não foi possível abrir esta imagem: ${error.message || 'formato inválido'}.`, true); } }
  }
  function crop(name) {
    const zone = zones[profile][name], [x1, y1, x2, y2] = zone;
    const sourceWidth = Math.round((x2 - x1) * image.naturalWidth), sourceHeight = Math.round((y2 - y1) * image.naturalHeight);
    const scale = Math.min(2, 1800 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(image,
      x1 * image.naturalWidth, y1 * image.naturalHeight, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  async function getWorker() {
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = ocrUrl; script.onload = resolve;
        script.onerror = () => { script.remove(); reject(Error('O OCR não carregou. Confira a conexão ou preencha as cartas manualmente.')); };
        document.head.append(script);
      });
    }
    if (!worker) worker = await window.Tesseract.createWorker('eng', 1, {
      workerBlobURL: false,
      workerPath: `${location.origin}/vendor/ocr/worker.min.js`,
      corePath: `${location.origin}/vendor/ocr`, langPath: `${location.origin}/vendor/ocr`
    });
    return worker;
  }
  async function detect(canvas, minimumCards) {
    if ('TextDetector' in window) {
      try {
        const result = await new window.TextDetector().detect(canvas);
        const entries = result.map(item => ({ text: item.rawValue }));
        if (model.cardCandidates(entries).length >= minimumCards) return entries;
      } catch { /* Fall back to the local WASM OCR worker. */ }
    }
    const engine = await getWorker();
    const result = await engine.recognize(canvas);
    return [{ text: result.data.text, confidence: Number.isFinite(result.data.confidence) ? result.data.confidence / 100 : undefined }];
  }
  async function readImage() {
    if (!image || busy) { status('Escolha ou fotografe uma imagem primeiro.', true); return; }
    const current = ++sequence;
    setBusy(true); status('Lendo suas cartas e o board no aparelho…');
    try {
      const count = Number(appState().multiway?.config?.variant?.match(/[456]/)?.[0] || 5);
      for (const name of ['hero', 'board']) {
        const result = model.reviewCards(await detect(crop(name), name === 'hero' ? count : 3), name === 'hero' ? count : 5);
        if (current !== sequence) return;
        findings[name] = result;
      }
      displayFindings();
      const issues = [...findings.hero.issues, ...findings.board.issues];
      status(`Leitura preliminar. ${issues.length ? issues.join(' ') : 'Confirme as cartas na imagem.'}`);
    } catch (error) { if (current === sequence) status(error?.message || 'Falha na leitura. Preencha as cartas manualmente.', true); }
    finally { setBusy(false); }
  }
  function review(scope = 'both') {
    const state = appState();
    if (!state.multiway || state.multiwayBusy) throw Error('Ative o Multiway e aguarde a atualização da mesa.');
    if (state.activeView !== 'analyze') throw Error('Abra a tela Analyze para importar cartas.');
    if (!image) throw Error('Escolha ou fotografe uma imagem.');
    if (handToken !== token(state)) throw Error('O histórico da mão mudou desde a imagem. Abra a imagem novamente antes de aplicar.');
    const heroCards = readCardField('hero'), board = scope === 'hero' ? state.multiwayState.board : readCardField('board');
    const result = model.validateReview({ variant: state.multiway.config.variant, heroCards, board,
      existingBoard: state.multiwayState.board, phase: state.multiwayState.phase,
      nextStreet: state.multiwayState.nextStreet, currentHero: state.multiway.config.heroCards, scope });
    if (!result.ok) throw Error(result.reason);
    return { state, heroCards, board, result };
  }
  function applyHero() {
    try {
      const { heroCards, result } = review('hero');
      if (!result.heroChanged) { status('Suas cartas já coincidem com o Multiway.'); return; }
      const applied = window.theibsCardKeyboard.applyReviewedHero(heroCards, window.theibsCardKeyboard.getRevision());
      if (!applied.ok) throw Error(applied.error);
      // A new server envelope is required before another imported event.
      status('Suas cartas foram registradas. Aguarde a atualização do Multiway antes de aplicar o board.');
      handToken = token(appState());
    } catch (error) { status(error.message, true); }
  }
  async function applyBoard() {
    try {
      const { state, heroCards, result } = review();
      if (!result.boardChanged) { status('O board já coincide com o Multiway.'); return; }
      if (JSON.stringify(heroCards) !== JSON.stringify(state.multiway.config.heroCards))
        throw Error('Aplique ou corrija primeiro suas cartas; depois registre o board.');
      const current = window.theibsMultiwayUI.voiceContext();
      setBusy(true);
      const ok = await window.theibsMultiwayUI.commitVoiceBoard({ addedCards: result.addedBoard, expectedToken: current.token });
      if (!ok) throw Error('A mesa mudou ou a rodada não está pronta. Confira o histórico antes de tentar novamente.');
      handToken = token(appState());
      status('Board registrado no histórico Multiway. Confira a análise e suas premissas.');
    } catch (error) { status(error.message, true); }
    finally { setBusy(false); }
  }
  function open() {
    if (!appState().multiway) { window.theibsMultiwayUI.openSetup(); return; }
    handToken = token(appState());
    const variant = appState().multiway.config.variant;
    $('#mw-image-variant').textContent = variant.replace('_HIGH', '');
    dialog.showModal(); status('Importe uma imagem ou fotografe a tela do computador. A imagem fica neste aparelho.');
    fileInput.focus();
  }
  function init() {
    const host = $('#multiway-controls');
    if (!host || $('#mw-image-open')) return;
    const button = document.createElement('button'); button.id = 'mw-image-open'; button.type = 'button';
    button.className = 'text-button'; button.textContent = 'Ler imagem'; button.addEventListener('click', open);
    host.querySelector('.mw-action-row').after(button);
    dialog = document.createElement('dialog'); dialog.id = 'mw-image-dialog'; dialog.className = 'multiway-dialog';
    dialog.innerHTML = `<div class="multiway-dialog-head"><h2>Imagem · <span id="mw-image-variant"></span></h2><button type="button" class="text-button" data-mw-image-close="true" aria-label="Fechar">×</button></div>
      <p class="mw-image-intro">Perfis de leitura preliminares, ainda sem validação com capturas reais de GGPoker e PokerStars. Revise as cartas antes de registrar. A foto não é enviada ao servidor nem salva no histórico.</p>
      <div class="mw-image-tools"><label>Perfil<select id="mw-image-profile"><option value="GGPOKER">GGPoker</option><option value="POKERSTARS">PokerStars</option></select></label><div class="mw-image-sources"><label class="mw-image-picker">Importar imagem<input id="mw-image-file" type="file" accept="image/*"><span>Escolher imagem</span></label><label class="mw-image-picker">Fotografar tela<input id="mw-image-camera" type="file" accept="image/*" capture="environment"><span>Abrir câmera</span></label></div></div><p id="mw-image-file-name" class="mw-image-file-name">Nenhuma imagem selecionada</p>
      <div id="mw-image-stage" class="mw-image-stage" hidden><img id="mw-image-preview" alt="Imagem da mesa para revisar cartas"><div id="mw-image-box" class="mw-image-box"></div></div>
      <details class="mw-image-calibration"><summary>Ajustar áreas de leitura</summary><label>Área<select id="mw-image-zone"><option value="hero">Suas cartas</option><option value="board">Board</option></select></label><p>Arraste sobre a imagem ou ajuste as porcentagens.</p><div class="mw-image-coordinates"><label>X início<input id="mw-image-x1" type="number" min="0" max="100"></label><label>Y início<input id="mw-image-y1" type="number" min="0" max="100"></label><label>X fim<input id="mw-image-x2" type="number" min="0" max="100"></label><label>Y fim<input id="mw-image-y2" type="number" min="0" max="100"></label></div></details>
      <button id="mw-image-read" type="button" class="ghost-button">Tentar reconhecer cartas</button>
      <div class="mw-image-review"><label>Suas cartas <small id="mw-image-hero-confidence">Não lido</small><input id="mw-image-hero" autocomplete="off" placeholder="As Kd Qh Jc"></label><button id="mw-image-apply-hero" type="button" class="ghost-button">Registrar minhas cartas</button><label>Board <small id="mw-image-board-confidence">Não lido</small><input id="mw-image-board" autocomplete="off" placeholder="2s 3h 4d"></label><button id="mw-image-apply-board" type="button" class="ghost-button">Registrar próxima street</button></div>
      <details class="mw-image-other"><summary>Outros dados da mesa</summary><p>Assentos, jogadores ativos, blinds, stacks, pote, apostas e ações ainda não são extraídos sem capturas de referência validadas. Registre-os nos controles Multiway. Nenhuma ação é inferida pela foto.</p></details>
      <p id="mw-image-status" role="status" aria-live="polite"></p>`;
    document.body.append(dialog);
    preview = $('#mw-image-preview'); fileInput = $('#mw-image-file'); cameraInput = $('#mw-image-camera');
    dialog.querySelector('[data-mw-image-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { releaseImage(); fileInput.value = ''; cameraInput.value = ''; $('#mw-image-file-name').textContent = 'Nenhuma imagem selecionada'; });
    fileInput.addEventListener('change', () => { void loadImage(fileInput.files?.[0]); });
    cameraInput.addEventListener('change', () => { void loadImage(cameraInput.files?.[0]); });
    $('#mw-image-profile').addEventListener('change', event => { profile = event.target.value; zoneFields(); findings = { hero: null, board: null }; displayFindings(); $('#mw-image-hero').value = ''; $('#mw-image-board').value = ''; });
    $('#mw-image-zone').addEventListener('change', event => { zoneName = event.target.value; zoneFields(); });
    for (const key of ['x1', 'y1', 'x2', 'y2']) $(`#mw-image-${key}`).addEventListener('change', () => {
      const candidate = ['x1', 'y1', 'x2', 'y2'].map(name => Number($(`#mw-image-${name}`).value) / 100);
      const accepted = model.normalizeZone(candidate);
      if (!accepted) { status('A área precisa caber na imagem e ter tamanho suficiente.', true); zoneFields(); return; }
      zones[profile][zoneName] = accepted; saveZones(); zoneFields(); invalidateZone();
    });
    let drag = null;
    const stage = $('#mw-image-stage');
    stage.addEventListener('pointerdown', event => {
      if (!image) return;
      const rect = preview.getBoundingClientRect();
      drag = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
      stage.setPointerCapture(event.pointerId); event.preventDefault();
    });
    stage.addEventListener('pointerup', event => {
      if (!drag) return;
      const rect = preview.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
      const accepted = model.normalizeZone([Math.min(drag.x, x), Math.min(drag.y, y), Math.max(drag.x, x), Math.max(drag.y, y)]);
      drag = null;
      if (accepted) { zones[profile][zoneName] = accepted; saveZones(); zoneFields(); invalidateZone(); } else status('Arraste uma área maior sobre as cartas.', true);
    });
    for (const name of ['hero', 'board']) $(`#mw-image-${name}`).addEventListener('input', () => {
      $(`#mw-image-${name}-confidence`).textContent = 'Corrigido manualmente · confira com a imagem';
    });
    window.addEventListener('resize', layoutPreview);
    $('#mw-image-read').addEventListener('click', () => { void readImage(); });
    $('#mw-image-apply-hero').addEventListener('click', applyHero);
    $('#mw-image-apply-board').addEventListener('click', () => { void applyBoard(); });
    zoneFields();
  }
  window.theibsMultiwayImage = { init, open };
})();
