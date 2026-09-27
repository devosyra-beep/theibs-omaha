## Preparação de hospedagem — 26/09/2026

Eliminado o flash do laboratório antes do login: HTML inicia com mesa oculta e inativa; somente acesso autorizado ou modo local confirmado revela a interface. Logout oculta imediatamente e falhas mantêm a tela bloqueada. Cache PWA renovado. Validação direcionada: 18 testes passaram, incluindo configuração lenta, sessão aguardando confirmação, acesso expirado, falha de rede e modo local.

Proteção adicional contra configuração incorreta: chave pública exige prefixo `sb_publishable_` e chave do servidor exige `sb_secret_`. A configuração pública e a inicialização bloqueiam chaves trocadas, inclusive JWT legado de service role. Validação local direcionada: 14 testes de autenticação, hospedagem e cobrança passaram.

Blueprint Render Free para URL provisória com landing e motor Node no mesmo serviço. Suporte à porta e URL fornecidas pela hospedagem, health check mínimo e bloqueio de inicialização hospedada sem Google/Supabase configurados. Cobrança exige chaves completas e armazenamento declarado persistente. Prévia gratuita tem histórico efêmero e não inclui habilitação de vendas. Validação local: 182 testes passaram; isso não valida login, pagamento ou desempenho em produção.

## 0.10.0 — 26/09/2026

Base da WebApp/PWA local sem Chromium empacotado: manifest instalável, service worker restrito aos arquivos estáticos, ícones 192/512 e maskable, iniciador Windows de dois cliques e armazenamento persistente em `%LOCALAPPDATA%\THEIBS`. O motor Node, os workers numéricos, o histórico e o Ollama permanecem locais; rotas `/api/` nunca entram no cache offline.

Nova identidade com espada geométrica facetada em dourado e tipografia limpa. O destaque NUTS abandona o estilo 3D e passa a usar um HUD compacto preto e dourado, com pulso desativado quando o sistema solicita movimento reduzido. A tela de acesso Google/Apple foi adicionada como preparação visual e pode ser aberta pelo botão de conta. Como nenhum projeto Supabase ou credencial OAuth foi fornecido, os provedores ficam explicitamente desativados e o modo local continua funcional; não há login simulado.

## 0.9.1 — 26/09/2026

Shift sozinho inicia uma nova mão em Analisar ao soltar a tecla, sem confirmação: limpa privadas, board, EV, equity e NUTS. No Multiway, reinicia ações e blinds mantendo jogadores, posição e stack inicial. Não atua em campos de texto, diálogos, Treinar ou durante atualização da rodada. Shift+letra, Shift+Tab, modificadores, cliques, repetição e perda de foco não disparam limpeza. Ajuda e tooltips dos botões informam o atalho. Fórmulas e modelos permanecem na base validada 0.9.0.

## 0.9.0 — 26/09/2026

Multiway opcional em Configurar mesa: início no pré-flop com posição, número de jogadores, blinds e stack inicial. Atalhos B sair, N passar, M pagar, vírgula apostar e ponto aumentar; bet/raise pedem o total da rodada dentro dos limites legais. Os assentos e posições são preservados após saídas. Clicar nas cartas de um adversário permite registrar uma saída observada elegível, inclusive fora da vez, sem inventar ações intermediárias. Desfazer reconstrói o estado anterior com as mesmas contribuições e fichas. Flop, turn e river são informados quando a rodada fecha. Cartas e configurações do modo simples são recuperadas ao desativar Multiway; o rascunho persiste localmente.

O ledger é a fonte de pote, contribuições, jogadores ativos, posição e ações legais. A análise e o assistente usam os mesmos limites. EV fica indisponível fora da vez do herói, em all-ins/potes laterais e na opção de raise gratuito do big blind; equity pode ser calculada na vez do herói quando as premissas do cenário permitem. Respostas observadas não viram probabilidades futuras. CALL com outros jogadores ainda devendo fichas exige modelo de resposta; apenas FOLD=0 disponível não vira indicação automática de fold. Modelos explícitos da API precisam identificar os assentos para não migrar para outro adversário após uma saída. No showdown o registro de ações termina; esta interface ainda não distribui os potes.

Revisão por três subagentes: ledger/estatística, API/dados e experiência Omaha. 161 testes locais de unidade e integração passaram, incluindo conservação de fichas, ordem física, all-in, saída/desfazer, modelo por assento, restauração e rejeição de pote futuro inventado. A integração não treina Llama, não altera o Monte Carlo e não constitui solução GTO. Evidências desta versão ficam em `validacao/unit-v0.9.0.*`, `validacao/multiway-v0.9.0/`, `validacao/focus-v0.9.0/` e `validacao/training-layout-v0.9.0/`.

O destaque NUTS aparece abaixo da equity, em letras douradas inclinadas, somente quando a leitura exata confirma que nenhuma dupla privada possível supera a mão no board atual. Empates continuam possíveis. O destaque é retirado ao invalidar a análise ou limpar a mão; pré-flop não recebe classificação de nuts. Nenhuma fórmula foi modificada para esse destaque.

## 0.8.1 — 26/09/2026

Tela de análise concentrada na mesa, EV e equity. Menu lateral recolhível para 64 px, iniciado recolhido e com preferência salva no rascunho. Navegação compacta por ícones; variante atual, expansão, ajuda e estado de salvamento continuam acessíveis. Menu expandido preserva variante, baralho e feltro. Configurar mesa, Ver cálculo, Assistente e Nova mão usam SVGs locais com nomes acessíveis e identificação ao passar o mouse.

Unidade do EV, método/amostras, premissas, leitura da mão e nota da comparação passam para Ver cálculo. Histórico gráfico fica recolhido. O ícone ao lado da ação abre a comparação e explica a limitação no tooltip; cobertura incompleta de adversários mantém sinal visível com mensagem acessível. Não houve alteração nas fórmulas, ranges, políticas, Llama ou resultados numéricos. Cartas começa recolhido; Remover e Desfazer aparecem ao expandir. Limpar cartas continua disponível no botão de lixeira.

QA em Edge e Electron empacotado: menu expandido/recolhido, cartas abertas/fechadas em 1910×1000, 1366×768 e 1024×660; sem rolagem da página ou sobreposição de board/mão. Preferência restaurada nos dois estados, teclado, remoção/desfazer/limpeza, ações dos ícones, detalhes, alerta de cobertura e navegação conferidos. Treino vazio, ativo, feedback, showdown e limpeza/restauração em quatro resoluções com menu expandido. Evidências em `validacao/focus-v0.8.1/` e `validacao/training-layout-v0.8.1/`. Os 142 testes matemáticos/de integração e a validação Llama permanecem como baseline da 0.8.0; não foram anunciados como executados novamente nesta alteração visual.

## 0.8.0 — 26/09/2026

Revisão conjunta de estatística, Omaha e desempenho. O treino heads-up agora compara fold/call/check com bet/raise mínimo, intermediário, máximo e o total personalizado. Cada alternativa simula respostas, reaumentos, apostas futuras e encerramento da mão. O EV é o saldo incremental desde a decisão, com devoluções e empates corretos. O avaliador recebe apenas o estado público; não usa as cartas ocultas, o board futuro ou a seed da mão real da sessão.

O treino calcula 256 cenários por alternativa no worker. Pergunta, ação, feedback, revisão e histórico reaproveitam exatamente a mesma comparação e preservam o tamanho escolhido. Tamanho inválido, revisão antiga e ação concorrente são rejeitados antes de alterar a sessão. Faixas de EV sobrepostas não recebem nota de erro nem perda de EV comprovada. A referência usa range uniforme, políticas heurísticas fixas de continuação e uma grade finita de tamanhos: não é GTO nem validação de estratégia contra jogadores reais. O cálculo manual mantém suas premissas explícitas e não recebe automaticamente a política do simulador.

Treinador com conclusão e até três pontos: leitura da mão, comparação de EV incluindo aumento e custo ou outro fato pertinente. Cálculos, faixas e premissas ficam em expansão. Removida a repetição das premissas por ação. Botões em português, atalhos de tamanho, histórico com valor apostado e tabela legível no lugar do JSON. Resumo principal cabe sem rolagem interna em 1366×768 no cenário verificado. Llama local continua restrito a selecionar fatos calculados; fatos fora do tema são descartados. Não altera EV, não acelera Monte Carlo e não aprende pesos com o histórico.

Validação: 142 testes automatizados PASS; QA funcional em Edge e Electron empacotado, incluindo Llama 3.2 1B real, aumento personalizado 5,25, revisão, histórico e proteção do modo Desafio. Fluxo de treino vazio/ativo/feedback/showdown/limpeza/restauração em quatro áreas desktop, sem rolagem da página principal. Dados de teste isolados do histórico pessoal. Método e evidências: `validacao/training-rollout-method-0.8.0.md`, `unit-v0.8.0.json`, `training-coach-v0.8.0/`, `training-layout-v0.8.0/` e `clean-assistant-v0.8.0/`.

Benchmark HTTP local sem Llama: três estados em cada cenário PLO5/PLO6 pré-flop/flop, medianas de 1,01–1,82 s e máximo de 2,04 s; cache com medianas de 25–79 ms. Relatório `validacao/training-http-2026-09-26T22-12-32-927Z.json`. São simulações completas com política de apostas, diferentes das simulações somente de showdown do benchmark de 100 mil/s. A amostra não constitui SLA. ZIP contém somente o runtime atual, sem modelos Llama, fontes de desenvolvimento ou histórico pessoal.

## 0.7.1 — 26/09/2026

Somente apresentação: removidos visualmente os textos marcados pelo usuário (total redundante de jogadores, estado positivo/negativo, instrução da próxima carta, valor para pagar ao lado da mesa e regras na lateral). Regras continuam na ajuda; valores continuam nos cálculos/configuração. Baralho e Feltro viraram expansões independentes. EV e equity usam números de 52–64 px. Alertas de sinal incerto e cobertura incompleta preservados.

QA funcional em Edge e no Electron empacotado, três resoluções com teclado aberto/fechado, sem rolagem ou sobreposição; expansões, remoção/desfazer, detalhes e proposta do Assistente passaram. Motor numérico e integração Llama não foram alterados. Evidências em validacao/clean-assistant-v0.7.1/.

## 0.7.0 — 26/09/2026

Tela de análise com regras, premissas, leitura da mão e teclado recolhidos. Cartas abre o teclado; selecionar uma posição também o abre. Limpar, remover e desfazer ficam acessíveis. Alertas de cobertura incompleta continuam visíveis. Fontes preservadas e layout sem rolagem principal em 1910×1000, 1366×768 e 1024×660, com teclado aberto ou fechado.

Assistente local com configuração persistente de Ollama. Llama 3.2 1B seleciona de um a três tópicos; somente textos e números calculados pelo motor são exibidos. Modelo não escreve resultados matemáticos. Resposta inválida, erro ou timeout usa explicação local. Pergunta da análise recalcula o cenário pelo worker. Frases com valores explícitos preparam uma prévia de campos; aplicar exige clique e alterações da entrada invalidam a prévia. Esse reconhecimento é determinístico, sem inventar cartas, ranges ou probabilidades.

106 testes unitários passaram. QA em Edge e Electron: recolhimento, três resoluções, alertas, prévia/aplicação, persistência, teclado físico completo, análise e treino. Llama real respondeu pelo executável empacotado. Quatro ensaios curtos de seleção com 1B: 11,80 s frio; 2,56–3,18 s carregado, sem fallback. Isso não certifica acurácia geral. Evidências em validacao/clean-assistant-v0.7.0/, llama-api-unit-tests.json e ollama-compact-fact-ids-1b-2026-09-26T21-44-24-435Z.json. Modelos ficam fora do ZIP; histórico pessoal preservado. Sem treino automático de pesos e sem aceleração de Monte Carlo por Llama.

## 0.6.0 — 26/09/2026

Revisão conjunta dos subagentes de estatística, Omaha e desempenho. A mesa mostra os adversários ativos com a quantidade correta de cartas fechadas; PLO6 = você +4, PLO5 = você +5. Posições adversárias são ilustrativas, sem valores ou naipes inventados. Posição do herói e stack efetivo são os informados. O treino continua heads-up. Nenhum registro manual de ações foi reintroduzido.

Painel Motor e IA distingue cálculo, explicação e memória. Mostra simulações completas, tempo até a interface, taxa do núcleo e reuso do worker. Ollama configurado não é anunciado como disponível sem resposta. O histórico não treina pesos nem ajusta automaticamente ranges; o LLM não acelera o cálculo.

Pool persistente de até dois workers reaproveita tabelas e código entre análises. Avaliador evita trincas equivalentes em boards pareados sem perder possibilidades de flush; A/B pareado no runtime Electron mostrou medianas de ganho de 20% no PLO5 e 22% no PLO6, com resultados numéricos idênticos. Cancelamento, falha e timeout descartam somente o worker afetado. Comparação completa agora é separada de liderança conclusiva: empates, sobreposição ou ausência de faixas não recebem uma nota de perda de EV. Registros antigos ficam preservados, mas não viram referência confiável por conter um número. Aviso visível quando a equity cobre menos adversários que os exibidos.

Validação final: 100 testes automatizados e QA funcional em Electron para análise, treino, keyboard, limpeza, persistência e call/raise. Mesa PLO4/5/6 em 1440×900, 1366×768 e 1024×660 sem sobreposição de assentos e cartas nem rolagem da página principal. Taxas dependem do runtime e da carga; dados brutos em validacao/engine-table-v0.6.0/report.json e demais relatórios dessa versão. O tempo HTTP não inclui pintura da tela. No teste HTTP final do aplicativo (três lotes de 50 mil por formato), medianas de 140.213/s no PLO5 contra 5 e 114.495/s no PLO6 contra 4; mínimos de 82.034/s e 112.969/s. O primeiro pedido PLO5 ficou abaixo da meta, portanto não há garantia de 100 mil/s em toda chamada. Atingir 100 mil simulações/s não valida os ranges nem prova estratégia ótima.

# Histórico local do THEIBS

## 0.5.1 — 26/09/2026

Fontes ampliadas na navegação, mesa, EV, botões, treinador e diálogos, com mais contraste no texto secundário. Feltro preto disponível e persistente. Baralho 4 cores agora usa fundo integral por naipe (grafite, vermelho, azul, verde) e um único valor branco central, incluindo board, treino, histórico e teclado de cartas. Clássico mantém os símbolos; nomes dos naipes continuam nos rótulos acessíveis e nas descrições ao passar o mouse.

Formatos da mesa de análise ajustados ao pedido: PLO6 inicia com você +4 adversários (5 jogadores); PLO5 com você +5 (6 jogadores). Esses são os limites do seletor da interface; ainda é possível reduzir os participantes ativos. Rascunhos PLO6 com contagem superior são ajustados sem apagar cartas. O simulador de treino continua identificado como exercício heads-up, com um adversário.

Validação visual e funcional em Edge e Electron empacotado: análise com seis cartas e board completo, treino e feedback em 1440×900, 1366×768 e 1024×660; página principal sem rolagem e cartas sem sobreposição. Persistência do feltro, faces sólidas/brancas, alternância para clássico e contagem realmente enviada ao motor verificadas. Regressões de análise/treino e raise passaram em Edge. Relatórios e capturas em `validacao/appearance-v0.5.1/`, `intelligence-v0.5.1/` e `raise-v0.5.1/`. Backup anterior em `resources/app.asar.v0.5.0.bak`.

## 0.5.0 — 26/09/2026

EV de CALL/BET/RAISE por cenários de pagadores, com contribuições e equities condicionais, validação de pot-limit/mínimos/stacks e comparação explícita completa/parcial. Interface Comparar bet / raise, premissas editáveis e cenários expansíveis. Pot odds alinhadas ao pote final do cenário. Removidas recomendações por limiares arbitrários e alteração da ação apenas por perfil. Treino incompleto não recebe nota de EV perdido. Intervalos fixos conservadores sem degeneração em 0/1. IDs numéricos, buffers reutilizados e lookup compacto.

70 testes passaram; integração Edge/Electron incluindo raise, persistência, treino e layouts. Ganho pareado de 3,5–4,3× sobre 0.4.1. A meta de 100 mil simulações/s ainda não é sustentada em todo caso: último núcleo PLO6+5 adversários teve mediana 94 mil/s; no Electron, três lotes renderam 98–115 mil/s. Doze análises adaptativas no pacote: 0,12–0,35 s. Limites estratégicos e evidências em `SOLUCAO-RAISE-E-MOTOR-0.5.0.md`. Mesmo executável; backup `resources/app.asar.v0.4.1.bak`.

## 0.4.1 — 26/09/2026

Avaliador compacto por tabelas no caminho de equity, preservando sorteios e resultados. Modo opcional Adaptativo em Configurar mesa → Amostras: lotes, orçamento de 2 s de simulação, limite de worker de 3 s, parada por precisão ou sinal do EV call. Faixa amostral propagada para EV de call/check; se cruza zero, a tela indica Sinal incerto. Não resolve EV de raise sem modelo de continuação.

31 testes focados passaram. Comparação exaustiva de 2.598.960 scores de cinco cartas, 3.000 mãos Omaha e igualdade dos cálculos em cenários fixos. Ganho do núcleo medido entre 31× e 158×. No pacote Electron, 12 cenários adaptativos completos: 0,33–1,73 s; 8.704–75.520 simulações. Não é garantia de latência para qualquer range/carga. Relatório e método em `VELOCIDADE-E-CONFIANCA-0.4.1.md`, evidências em `validacao/performance-v0.4.1/`. Backup anterior: `resources/app.asar.v0.4.0.bak`.

## 0.4.0 — 26/09/2026

Removido o acompanhamento manual de ações na análise e o atalho F para Fold. Adversários ficam visíveis e editáveis no topo da mesa; o treino identifica seu único adversário simulado. PLO4/PLO6 exibem confirmação de modo ativo, sem sugerir que falta cadastrar uma estratégia. A reserva de cartas limita o número de jogadores conforme a variante.

O simulador usa o registro interno de apostas e uma política adversária com fold/call/raise/bet/check. O treinador local explica fatos calculados de mão, nuts, draws e blockers de ás de flush. Histórico antigo preservado; tendências separadas por geração da política. Permanece uma base heurística, sem estratégia calibrada por solver e sem aprendizagem automática de pesos.

Validação: 27 testes focados, 8 grupos de integração em Edge e no pacote Electron Windows, layouts de 1440×900, 1366×768 e 1024×660. Ensaio numérico: 10.000 comparações de cinco cartas, 900 cenários Omaha, 900 mãos completas, 90 comparações de equity e censo de 2.598.960 combinações. Escopo, métricas e limites em `METODO-VALIDACAO-E-APRENDIZAGEM.md`. Executável mantido em `THEIBS-0.3.0-Windows/THEIBS.exe`; backup do pacote anterior em `resources/app.asar.v0.3.1.bak`.

## 0.3.1 — 26/09/2026

Corrigida a aba **Treinar**, que ainda mantinha a disposição antiga. Mesa, ações, treinador e revisão passam a caber na tela desktop. Configuração e cálculos detalhados abrem em janelas próprias. Botões visíveis **Limpar treino**, **Nova mão simulada** e **Limpar cartas**; limpar o treino preserva as decisões no histórico. Mantido o mesmo executável em `THEIBS-0.3.0-Windows/THEIBS.exe`, com 0.3.1 no título.

Validação local em Edge e no Electron Windows empacotado: treino vazio, mão ativa, feedback, showdown, limpeza e restauração; áreas úteis de 1702 × 980, 1440 × 900, 1366 × 768 e 1024 × 660. Relatórios e capturas em `validacao/training-layout/`. A análise também passou novamente pelos 10 grupos de integração em Edge. Detalhes extensos do treinador/revisão podem usar rolagem interna; a página principal permanece fixa.

## 0.3.0 — 26/09/2026

Mesa compacta para desktop, cartas ampliadas e quatro cores. EV de lucro em fichas com indicação positiva/negativa e premissas visíveis. Acompanhamento sequencial dos jogadores, blinds, ações, streets, all-in, potes laterais e resultados, com undo, rascunho e histórico. F para o Fold do usuário. Cálculo automático com modelo explícito de adversários aleatórios, correção do rake e processamento fora da thread do servidor. Testes e limites em `ATUALIZACAO-0.3.0.md`.

## 0.2.1 — 26/09/2026

Correção da entrada de cartas, aliases D/T/10, foco com Tab e avanço da seleção. Registro e evidências em `CORRECAO-TECLADO.md`.

## 0.2.0 — pacote recebido

Aplicativo unificado original. Documentação histórica em `THEIBS-Windows/docs/` e no trecho original de `THEIBS-Windows/README.md`.
