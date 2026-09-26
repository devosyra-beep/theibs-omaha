/* Local language assistance. Proposals never bypass the numeric engine or its form validation. */
(function () {
  'use strict';
  const $=s=>document.querySelector(s), app=window.theibsApp;
  const labels={variant:'Variante',position:'Posição',players:'Jogadores no total',potBeforeAction:'Pote atual',amountToCall:'Para pagar',effectiveStack:'Stack efetivo',betSize:'Bet total',raiseTo:'Raise total',samples:'Simulações'};
  let config=null, busy=false, proposal=null, proposalSignature=null, controller=null;
  const context=()=>Object.fromEntries(Object.keys(labels).map(key=>[key,key==='variant'?`PLO${window.theibsCardKeyboard.state.count}_HIGH`:$('#'+key)?.value||'']));
  const signature=()=>JSON.stringify({context:context(),cards:window.theibsCardKeyboard.state.slots});
  async function json(url,body,signal) {
    const response=await fetch(url,body===undefined?{signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    const data=await response.json();if(!response.ok)throw Error(data.reason||data.error||`HTTP ${response.status}`);return data;
  }
  function clearProposal() {proposal=null;proposalSignature=null;$('#analysis-ai-proposal').hidden=true;$('#analysis-ai-proposal-fields').replaceChildren();}
  function setBusy(value) {
    busy=value;for(const id of ['analysis-ai-explain','analysis-ai-prepare','llama-refresh','llama-connect'])$('#'+id).disabled=value;
    $('#analysis-ai-apply').disabled=value;$('#analysis-ai-response').setAttribute('aria-busy',String(value));
  }
  function renderStatus(data) {
    config=data.config||config;
    if(!config)return;
    const availability=data.availability||{state:'NOT_CHECKED'},models=availability.models||[];
    const selected=$('#llama-model').value||config.model||'';
    const names=models.map(m=>typeof m==='string'?m:m.name||m.model).filter(Boolean);
    if(config.model&&!names.includes(config.model))names.unshift(config.model);
    $('#llama-model').replaceChildren(...names.map(n=>new Option(n,n)));
    if(!names.length)$('#llama-model').add(new Option('Nenhum modelo encontrado',''));
    $('#llama-model').value=names.includes(selected)?selected:names.includes(config.model)?config.model:names[0]||'';
    $('#llama-url').value=config.baseUrl||'http://127.0.0.1:11434';
    const status={NOT_CHECKED:'Ainda não verificado',AVAILABLE:'Modelo disponível',MODEL_MISSING:'Escolha um modelo instalado',UNAVAILABLE:'Ollama não está disponível',DISABLED:'Explicação local'}[availability.state]||'Estado desconhecido';
    $('#llama-status').textContent=availability.state==='AVAILABLE'&&data.lastInference?.state==='SUCCEEDED'?'Llama respondeu nesta sessão':status;$('#llama-status').dataset.state=availability.state;
    $('#llama-config-message').textContent=availability.state==='AVAILABLE'?'Modelo encontrado. A resposta é verificada ao perguntar.':availability.reason||'Conecte ao Ollama para usar o Llama.';
    document.dispatchEvent(new CustomEvent('theibs:llm-updated',{detail:config}));
  }
  async function refresh() {
    if(busy)return;setBusy(true);$('#llama-config-message').textContent='Verificando modelos locais…';
    try {renderStatus(await json('/api/llm/check',{}));}
    catch(error){$('#llama-status').textContent='Não foi possível verificar';$('#llama-config-message').textContent=error.message;}
    finally {setBusy(false);}
  }
  async function connect() {
    if(busy)return;setBusy(true);$('#llama-config-message').textContent='Conectando ao Ollama local…';
    try {
      // Save only explicit settings. Starting the local runtime is tied to this click.
      const model=$('#llama-model').value||config?.model||'llama3.2:1b';
      renderStatus(await json('/api/llm/config',{provider:'ollama',model,baseUrl:$('#llama-url').value||'http://127.0.0.1:11434'}));
      const checked=await json('/api/llm/check',{});
      if(checked.availability?.state==='UNAVAILABLE')await json('/api/llm/start',{});
      renderStatus(await json('/api/llm/check',{}));
    }catch(error){$('#llama-status').textContent='Conexão pendente';$('#llama-config-message').textContent=error.message;}
    finally {setBusy(false);}
  }
  function renderProposal(next,provider) {
    const changes=next?.changes;
    if(!next?.patch||!Array.isArray(changes)||!changes.length||Object.keys(next.patch).some(key=>!Object.hasOwn(labels,key)))throw Error('A proposta contém campos não suportados.');
    proposal=next;proposalSignature=signature();
    const list=document.createElement('dl');list.className='engine-metrics';
    for(const change of changes){
      if(!Object.hasOwn(labels,change.field))throw Error('Campo não permitido na proposta.');
      const row=document.createElement('div'),title=document.createElement('dt'),description=document.createElement('dd');
      title.textContent=labels[change.field];description.textContent=String(change.value);row.append(title,description);list.append(row);
    }
    $('#analysis-ai-proposal-fields').replaceChildren(list);$('#analysis-ai-proposal').hidden=false;
    $('#analysis-ai-response').textContent=`Confira os valores antes de aplicar. ${provider==='ollama'?'Preparado pelo Llama.':'Dados explícitos reconhecidos localmente.'}`;
  }
  async function ask(mode) {
    if(busy)return;
    if(mode==='prepare'&&app.getState().multiway){$('#analysis-ai-response').textContent='No Multiway, configure a mesa e registre as ações nos controles da rodada. O assistente pode explicar a análise na sua vez.';return;}
    const question=$('#analysis-ai-question').value.trim()||(mode==='explain'?'Explique esta mão de forma curta.':'');
    if(!question){$('#analysis-ai-response').textContent='Descreva o cenário com os valores que quer usar.';return;}
    let input;
    if(mode==='explain')try{input=app.getAnalysisInput();}catch(error){$('#analysis-ai-response').textContent=error.message;return;}
    clearProposal();setBusy(true);controller=new AbortController();
    const requestedSignature=signature(),requestedQuestion=$('#analysis-ai-question').value;
    $('#analysis-ai-response').textContent=mode==='explain'?'Calculando a mão e preparando a explicação…':'Preparando os campos do cenário…';
    try {
      const data=await json(mode==='explain'?'/api/analysis/doubt':'/api/analysis/prepare',mode==='explain'?{input,question}:{question,context:context()},controller.signal);
      if(signature()!==requestedSignature||$('#analysis-ai-question').value!==requestedQuestion){$('#analysis-ai-response').textContent='A entrada mudou. Faça a pergunta novamente.';return;}
      if(mode==='prepare') {
        if(data.status==='PROPOSAL')renderProposal(data.proposal,data.provider);
        else $('#analysis-ai-response').textContent=data.reason||'Informe valores concretos, por exemplo: pote 20, para pagar 4.';
      } else {
        if(!data.answer?.answer)throw Error(data.reason||'Não houve explicação para esta mão.');
        app.renderCoachAnswer($('#analysis-ai-response'),data.answer,data.context);
      }
    }catch(error){$('#analysis-ai-response').textContent=error.name==='AbortError'?'A entrada mudou. Faça a pergunta novamente.':error.message;}
    finally{controller=null;setBusy(false);}
  }
  function applyProposal() {
    if(!proposal||busy)return;
    if(app.getState().multiway){clearProposal();$('#analysis-ai-response').textContent='O cenário Multiway é definido pelas ações registradas. Volte ao modo simples para aplicar outro cenário.';return;}
    if(signature()!==proposalSignature){clearProposal();$('#analysis-ai-response').textContent='A mão mudou. Prepare o cenário novamente.';return;}
    const patch=proposal.patch;
    if(patch.variant){
      const count=String(patch.variant).match(/^PLO([456])_HIGH$/)?.[1];
      if(!count)throw Error('Variante inválida.');
      const selector=$('#variant-select');selector.value=count;selector.dispatchEvent(new Event('change',{bubbles:true}));
      if(selector.value!==count){$('#analysis-ai-response').textContent='Mudança de variante cancelada.';clearProposal();return;}
    }
    for(const [field,value]of Object.entries(patch))if(field!=='variant')$('#'+field).value=String(value);
    // A single form event makes the numerical engine invalidate the old result.
    $('#players').dispatchEvent(new Event('change',{bubbles:true}));
    clearProposal();$('#analysis-ai-response').textContent='Cenário aplicado. Use Analisar mão para calcular o EV.';
    $('#engine-dialog').close();
  }
  $('#llama-refresh').addEventListener('click',refresh);$('#llama-connect').addEventListener('click',connect);
  $('#analysis-ai-explain').addEventListener('click',()=>ask('explain'));$('#analysis-ai-prepare').addEventListener('click',()=>ask('prepare'));
  $('#analysis-ai-apply').addEventListener('click',applyProposal);
  $('#analysis-ai-question').addEventListener('input',()=>{clearProposal();controller?.abort();});
  document.addEventListener('theibs:analysis-invalidated',()=>{clearProposal();controller?.abort();});
  app.ready.then(async()=>{try{const current=await json('/api/llm/config');renderStatus(current);if(current.config?.provider==='ollama')renderStatus(await json('/api/llm/check',{}));}catch(error){$('#llama-status').textContent='Configuração indisponível';$('#llama-config-message').textContent=error.message;}});
})();
