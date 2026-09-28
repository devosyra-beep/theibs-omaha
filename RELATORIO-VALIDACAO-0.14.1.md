# THEIBS 0.14.1 — Analyze web: entrega e validação

27/09/2026. Produto único: **webapp hospedada**. Desenvolvimento e testes em loopback são infraestrutura de QA do código web; não foi criado instalador, executável ou segundo produto. A autorização foi validar antes de hospedar. Nenhuma publicação, cobrança, alteração de conta ou aposta real foi realizada.

**Resultado:** correções matemáticas e de fluxo implementadas; entrada de cartas e ações por voz PT/EN integrada ao estado e ledger; painel econômico com dados efetivamente simulados. Testes determinísticos, API e browser têm evidência própria. **Vantagem econômica e reconhecimento acústico de produção não estão aprovados.** Chrome reconheceu exemplos de áudio sintético PT/EN pelo provedor real após uma correção de consolidação de segmentos; isso não substitui corpus humano ou ensaio hospedado.

## Versionamento após o experimento

O holdout foi congelado e executado na **0.14.0**. A revisão de 43 abstenções detectou resíduo de ponto flutuante negativo de aproximadamente 1e−14 num aporte que deveria ser zero. A versão **0.14.1** corrige esse limite numérico sem alterar hipóteses adversárias nem orçamento amostral; o retorno econômico dela **não foi reavaliado**. O painel identifica os números como evidência de outra versão. Não estimamos ganho da correção usando o teste reservado. Todas as observações anteriores e hashes permanecem preservados.

## 1. O que foi alterado e onde chega

Fluxo: `public/app.js` → `/api/analyze` → worker → `decision-engine` → equity/action EV/contrato → cartões EV/equity, snapshots de gráficos e `/api/analysis/doubt`. A evolução está no **Analyze**, incluindo seu modo Multiway. O Treino recebe apenas correções compartilhadas de proveniência; não é a fonte do retorno econômico desta entrega.

- **Adversários opcionais e individuais:** o fluxo padrão usa mãos legais uniformes para todos, sem presumir perfil, fold ou call. No painel “Adversários (opcional)”, Aplicar vincula range/taxa apenas ao assento escolhido. Os demais continuam desconhecidos; editar sem aplicar não muda o cálculo. Nova mão, mudança da configuração e saída do assento eliminam vínculos incompatíveis. Remover restaura a base estatística. Ações observadas não geram perfil automaticamente.
- Uma taxa parcial não impede equity/CALL disponíveis e não é copiada para outros jogadores. Para comparar agressão, o estudo exige taxas explícitas para todos, aceite, aportes e mínimos legais; ranges específicos ainda precisam de um modelo de continuação próprio. O botão de preencher 50% para todos foi retirado. Escopo por assento aparece na API, proveniência e contexto do coach.
- Rake percentual com cap, no-flop-no-drop e arredondamento entra no EV antes da escolha. Aposta não coberta retorna ao jogador; a parcela casada de um raise continua sujeita ao rake. Custos ausentes não são zero.
- CHECK/RAISE do BB após limp agora é legal e modelável. Contribuição anterior é explícita; Multiway usa o BB verdadeiro do ledger, inclusive para epsilon.
- No estudo HU com uma mesma equity para todas as ações, as diferenças afins compartilham um intervalo válido. Não reduzimos amostras nem o nível de confiança. Fora desse caso, permanece a inferência conservadora existente. Equivalência prática não vira recomendação acionável.
- Diagnósticos distinguem ausência de modelo, adversário não coberto, comparação incompleta, sobreposição, equivalência e prévia. A prévia não fornece ação recomendada.
- Cálculo exato prepara pares e buffers fora do loop, mantendo resultados, enumeração e contagem. Monte Carlo conserva o orçamento.
- Voz usa PT/EN explícitos, comandos canônicos, proposta de lote atômico, conferência, undo e proteção contra duplicação/contexto obsoleto. Ações do herói/adversários passam pelo mesmo ACT do Multiway, com identificação ADV.N, vez e limites legais. Raise exige total para/TO; CALL usa o preço do ledger, não um valor adivinhado.
- Expiração, troca de sessão e navegação invalidam respostas tardias. Nenhum texto parcial de voz muda cartas, gráficos ou cálculo.
- Painel “Retorno por 100 mãos” lê um agregado auditado, separado da mão aberta; comparar cenários não altera seus campos.

## 2. Por que parecia sem análise, inconclusivo ou raramente verde

Foi confirmado por GET público que `https://theibs-omaha.onrender.com/api/status` e `/app` estavam em **0.12.2**, sem os novos assets. GET de status não mede tempo de cálculo. Evidência: `published-version-observation.json`.

A segunda imagem tinha pré-flop válido e Calculating. A inspeção somente de leitura da aba do usuário revelou o desfecho NO_DECISION com mensagem “Sessão inválida ou expirada” escondida no tooltip. Essa falha concreta é de autenticação e apresentação, não de equity. Ver `published-session-observation.json`; nenhuma credencial ou armazenamento privado foi lido.

A correção web renova a sessão antes do vencimento, compartilha uma única renovação entre requisições e permite um único retry após 401. Indisponibilidade do fornecedor (5xx/429/rede/timeout) retorna 503 e conserva a sessão, em vez de tratá-la como senha ou token inválido. Rotação saudável preserva a identidade e a fala pendente; logout, troca de conta ou falha irrecuperável bloqueiam a tela e cancelam resultados. Há prazo total de 8 segundos, inclusive na espera de coordenação entre abas. Respostas tardias, incluindo o corpo JSON e o carregamento inicial, não restauram rascunho de outra sessão nem persistem resultado obsoleto. A validação usa contas sintéticas e transporte interceptado; não homologa o fornecedor em produção.

As cartas visíveis dessa segunda imagem (Ac 5d Qh Qc Qs, pré-flop, seis jogadores, pote12/call4) foram reproduzidas no motor0.14.1 com hipóteses adicionais explícitas de 500 amostras/seed42/range uniforme/rakezero/SHOWDOWN_ONLY: statusOK, equity12,3%, CALL EV−2,032 fichas e comparação incompleta por RAISE sem modelo. Uma execução direta levou cerca de102ms; esse número não mede produção nem reconstitui todos os campos ocultos da conta. Evidência: `screenshot-preflop-fixture.json`.

Na imagem do usuário havia cinco cartas privadas e **uma carta de flop**. Flop requer três: a interface agora informa quantas faltam e só dispara cálculo quando a street fica válida. Zero cartas de board continua sendo pré-flop válido. QA reproduziu 1/2 cartas com zero requisições e a terceira com uma análise completa.

Defaults realmente observados: PLO5, seis jogadores, pote 12, call 4, 500 amostras, modelo uniforme, estudo de respostas OFF, rake zero explicitamente selecionado pelo dashboard. O destaque mostra **EV de CALL/CHECK**, não lucro da estratégia nem valor de todas as ações. Para o preço 4/(12+4), o break-even sem rake é 25%; equity média simétrica contra cinco adversários é 1/6. Não é esperado que toda mão tenha CALL positivo.

Com 500 amostras, o raio Hoeffding nominal é cerca de 6,07 pontos percentuais; um CALL pontualmente positivo pode continuar com sinal incerto. A interface agora diz isso. Falta de resposta adversária para RAISE gera comparação parcial mesmo quando CALL já foi calculado. Mais amostras não fornecem hipóteses ausentes. Não recolorimos nem forçamos recomendações para obter verde.

Latência: Fast 500 não usa prévia; orçamentos maiores/ADAPTIVE fazem prévia e cálculo final. O estudo de agressão pode exigir equities por número de callers. Workers e fila/cancelamento, carga de hospedagem e rede precisam de medição específica no servidor publicado. O próximo alvo de otimização é reutilizar fatos de mão por cartas/board, mas isso não foi alterado após congelar a política econômica.

Detalhamento e reprodução: `DIAGNOSTICO-FLUXO-ANALYZE.md`, `analyze-feedback/`, `MATEMATICA-ANALYZE.md`.

## 3. Retorno por 100 mãos — respostas econômicas

**PLO5 High, HU, 50 BB**, SB=1/BB=2 fichas, BTN/BB alternados, 500 amostras FIXED, grade de meio pote, fallback CHECK/FOLD e deadline de motor 3 s. Modelo do herói: ranges uniformes e hipótese declarada de 50% call; estilo verdadeiro do adversário não é fornecido. A política reconsulta Analyze em toda decisão; seu EV interno continua SHOWDOWN_ONLY. Duas famílias independentes programadas: paga sempre/nunca aumenta e pressão seletiva por cartas próprias/preço. Não são jogadores reais.

16.000 execuções, **8.000 deals pareados**, quatro cenários, 20 blocos de 100 mãos por cenário/política, 2.000 mãos por célula. Cada mão reinicia com 50 BB e reposição ilimitada; não é risco de ruína de uma banca finita. B_ref = 1.000 BB é denominador de apresentação, não financiamento limitado.

| Cenário candidato | bb/100 | IC ajustado da média | % de B_ref | P(bloco positivo), IC ajustado | Delta vs 0.13.0 bb/100 |
|---|---:|---|---:|---|---:|
| CALL_STATION_ZERO | 63,20 | [-308,43; 434,83] | 6,32% | 65,00% [32,75; 89,52] | 15,20 |
| CALL_STATION_RAKE | -70,15 | [-435,54; 295,24] | -7,02% | 25,00% [5,23; 57,71] | -2,24 |
| PRESSURE_ZERO | 59,90 | [-460,02; 579,83] | 5,99% | 60,00% [28,41; 86,45] | 36,89 |
| PRESSURE_RAKE | 37,40 | [-498,83; 573,64] | 3,74% | 55,00% [24,32; 83,11] | 68,32 |

ICs de médias/diferenças: família 5%, 12 estimativas, nível individual 99,5833%; probabilidades: família descritiva separada, nível individual 99,375%. Todos os ICs absolutos cruzam zero e todos os ICs de diferença cruzam zero e a meta +1 bb/100. **Nem positividade absoluta nem ganho relativo foram demonstrados.** Os pontos positivos/negativos são exploratórios, não percentuais prometidos.

Rake sintético: 5%, cap 1 BB, no-flop-no-drop, arredondamento para baixo ao centavo. Cenários com/sem rake têm deals distintos: sua diferença não isola causalmente rake. Dentro de cada cenário, baseline/candidato são pareados. O baseline modela zero na decisão e paga o mesmo custo do ambiente, logo a comparação combinada não isola inferência, BB e custos.

A auditoria passou em 16.000 mãos, 160 blocos de política, 48.399 decisões, conservação, aportes/retiradas, legalidade e 64 showdowns por avaliador independente interno. Zero erros e timeouts. Planejamento aproximado indica da ordem de 1,03–4,27 milhões de mãos por cenário para o contraste relativo pequeno e 3,63–12,96 milhões para positividade, condicionado à variância piloto; isso não é poder atingido nem garantia de poder do limite conservador.

O corpus diagnóstico separado de 192 estados mostrou abstenções 108/192 → 96/192, explicadas pelo suporte do BB; o pareamento não aumentou cobertura neste corpus. No holdout, alta cobertura não resolveu erro de modelo: supor 50% de folds quando o adversário nunca folda pode gerar BET−CHECK=P/4 no modelo, independente da equity. A hipótese fixa de 50% pertence ao experimento congelado, não ao uso padrão atual. Conforme a orientação final do usuário, não exigiremos monitoramento ou preenchimento contínuo de adversários. A próxima avaliação deve estudar a política básica sem leitura comportamental, sensibilidade a modelos desconhecidos e continuação consistente; hipóteses manuais individuais entram somente quando escolhidas pelo jogador. Mais volume não corrige uma hipótese inadequada.

Fontes completas, ICs de diferença, quantis, predição e cobertura: `economics/holdout-v2/RESULTADOS.md` e `economics/METHODS.md`. O JSON original está incorporado com SHA-256 `f2e5fed09ddacba2415446bda60fc04e4a93303c60203f3e0181bd648d7f1181`. A errata `ERRATA-METADATA.md` afeta somente o suporte auxiliar da transformação percentual; limites, números exibidos e conclusões estão corretos e o original foi preservado.

Histórico preservado: desenvolvimento e piloto v1; protocolo v1 retirado antes de outcomes após achar arredondamento e mínimo de all-in incorretos no adaptador; piloto v2 e primeiro/único holdout executado v2, com seeds novas. Nenhuma estratégia foi retunada pelos retornos. O holdout reserva deals, não novas famílias adversárias.

## 4. Voz: capacidade e limite real

“Minhas cartas, ás de espadas, dez de copas” / “my cards, ace of spades, ten of hearts”; “eu aumento para vinte” / “I raise to twenty”; “adversário dois aposta dez” / “opponent two bets ten”. Parser e fluxo aceitam as formas documentadas, não linguagem natural irrestrita. Identificação de ator é obrigatória para ação; fora da vez, valor ambíguo, duplicata ou street incorreta não alteram o ledger. CALL/pagar sem valor usa amountToCall do ator e o mostra antes da confirmação.

52 cartas × três variantes × dois idiomas e casos de ação/valor são testes determinísticos. O browser foi exercitado com eventos ASR controlados e API real em QA. Esses resultados não medem sotaque, ruído ou acerto acústico.

Os ensaios nativos de Edge/Chrome com áudio sintético são registrados separadamente: nenhum áudio de hardware pessoal foi capturado. Edge chegou a eventos de fala e resultados vazios. No Chrome, o AudioTrack explícito forneceu texto correto nos dois idiomas e revelou um bug: segmentos provisórios removidos pelo ASR continuavam no estado interno. A reconciliação do snapshot foi corrigida e os exemplos sintéticos de cartas passaram pelo provedor real até a aplicação canônica conferida. **O runtime do usuário usa `start()` com microfone; o probe aprovado usou `start(audioTrack)` com WAV sintético.** A captura falsa pelo caminho `start()` permaneceu sem texto, inclusive sem o preflight de getUserMedia. O smoke de ação em português registrou RAISE total 2,5; em inglês a transcrição mudou “raise to” para “raised a” e foi rejeitada com segurança: uma aplicação correta e uma rejeição em dois exemplos. **O smoke sintético não garante reconhecimento humano/produção.** Confirmação por lote continua ativa; não há autoaplicação autorizada nem alegação de 98%/1,5 s.

A integração web não exige programa, modelo ou serviço no PC do jogador. O modo do navegador explica possível processamento remoto; o modo estritamente no dispositivo exige capacidade/idioma disponível e não faz download/fallback silencioso. O código não grava áudio/transcrições de uso. Frases sem conteúdo geram orientação para tentar novamente/usar teclado, sem carta inventada.

E2E na hospedagem e corpus humano reservado PT/EN permanecem NOT_EXECUTED por escopo/ausência de evidência. O próximo teste deve resolver provedor em navegador/dispositivo autorizado, medir carta/comando/lote, rejeição, correção e erro aplicado, com separação por falante/gravação; só então aprovar autoaplicação. Ver `voice/RELATORIO-VOZ.md` e matriz de compatibilidade.

## 5. Desempenho sem reduzir qualidade

Ambiente: Node24, Windows, Intel i5-1235U, Edge154. Os tempos são do ambiente de QA, não da hospedagem. Segundo rAF mede oportunidade de apresentação, não pintura física/INP. Corpora e hashes foram salvos antes de cada benchmark.

- Enumeração exata em nove fixtures ×40 repetições, A/B alternado, paridade integral: medianas de flop PLO4 1,619→0,551 ms; PLO5 2,491→0,757; PLO6 4,105→1,105, aproximadamente 66–73% menos. Não extrapolar para Monte Carlo/rede.
- Interativo HU, 360 análises: p95 preview 153/161/164 ms e final 235/259/445 ms (PLO4/5/6), zero falhas de resolução exigida. Seed/amostras/IC/stop/status iguais ao baseline histórico em 360/360 casos. PLO6 foi mais lento que o ensaio histórico: não foi demonstrada aceleração genérica de Monte Carlo.
- Mesa com vários adversários, 360 análises (6/6/5 jogadores PLO4/5/6): p95 preview 143/152/146 ms; final 225/298/285 ms. Todos alcançaram precisão ou separação do sinal do CALL; continuaram podendo abster-se por faltar modelo de ação. Isto não aprova lucro multiway.
- Teclado sob worker ativo de 50 mil simulações: 3.316 eventos, p95 33,8/34,7/34,1 ms e p99 37,6/39,4/38,2; zero cartas erradas e zero botões de deck recriados. Eventos físicos humanos/dispositivos diversos não foram medidos.

O parser puro é rápido, mas não substitui latência acústica. Resultados de cada execução, inclusive frio/limites e revisões de código, estão nos diretórios de performance. Esses benchmarks antecedem as últimas mudanças de autenticação e do editor individual. A regressão funcional foi repetida, incluindo paridade matemática da base e isolamento das hipóteses, mas não é uma nova medição causal de velocidade. Os tempos valem para os snapshots identificados nos arquivos, não homologam a versão publicada.

## 6. Validação e pendências

A matriz consolidada está em `validacao/analyze-online-2026-09-27/MATRIZ-VALIDACAO.md`.

- **347/347 testes gerais passaram**, zero falhas, cancelamentos ou skips: `tests-final-0141.tap`.
- **9/9 editor individual**, incluindo rascunho por assento sem aplicação automática: `opponent-inputs-drafts-final/report.json`. **11/11 backend** de escopo, proveniência e cache também passaram.
- **5/5 Analyze**, **6 verificações do painel econômico**, **8/8 integração/coach/gráficos** e **17/17 teclado/mouse**, nos diretórios `analyze-ui-final`, `economic-panel-0141-final`, `integration-navigation-final` e `keyboard-0141-final`.
- **58/58 testes focados de autenticação**, **10/10 browser** e **5/5 condições de corrida do app**: `RELATORIO-AUTH.md`, `auth-refresh/` e `auth-app-guards-final/`. Fornecedor e contas são sintéticos.
- **26/26 voz na interface** e **6/6 voz/sessão** nas execuções finais, com ASR controlado. O reconhecimento acústico real tem os resultados separados da seção de voz.

Os ajustes finais de rascunhos e de cancelamento por navegação foram posteriores à suíte geral e receberam regressões próprias: nove cenários do editor, cinco condições de corrida e oito verificações de integração. Rascunhos não aplicados sobrevivem à troca de assento enquanto a página está aberta; somente hipóteses aplicadas entram no cálculo e na persistência estruturada.  Falhas anteriores e protocolos retirados permanecem preservados; não sobrescrevê-los para apresentar somente PASS.

Pendente para aprovação econômica: uma política básica avaliada sem informações comportamentais obrigatórias; consistência da continuação; sensibilidade ao modelo de cartas desconhecidas e às hipóteses individuais opcionais; famílias realmente reservadas, 100 BB/PLO4/PLO6/multiway, sensibilidade a adesão e referência externa. Não implantar milhões de mãos para encobrir um modelo inadequado. Aprendizagem humana não foi executada nesta fase.

Pendente para voz: ampliar o smoke acústico funcional do Chrome para dispositivos e corpus reservado em dois idiomas; gate de precisão/latência, dispositivos e navegador; E2E HTTPS da versão publicada. Sem esse resultado, a funcionalidade é integrada e testada por eventos, com smoke sintético de reconhecimento real, mas **não homologada como reconhecimento confiável de fala humana em produção**.

Pendente para publicação: validar a versão 0.14.1 em staging/hospedagem autorizada, recursos/concorrência/rede e áudio. A produção 0.12.2 foi somente consultada. O snapshot `validacao/analyze-online-2026-09-27/theibs-web-source-0.14.1.zip`, o diff `changes-0.13.0-to-0.14.1.diff` e `MANIFEST-FINAL.json` permitem revisar o código e suas evidências antes dessa etapa. O ZIP é código para revisão, não instalador desktop nem publicação.

## 7. Reprodução para desenvolvimento/QA

Executar na pasta `codigo-fonte`, com Node22.13+ e Playwright disponíveis no ambiente de desenvolvimento. Isso não é requisito para o jogador da webapp.

```powershell
node --test "test/*.test.cjs"
node scripts/qa-analyze-online.cjs --out=../validacao/reexecucao-analyze
node scripts/qa-economic-panel.cjs --out=../validacao/reexecucao-economia
node scripts/qa-opponent-inputs.cjs --out=../validacao/reexecucao-adversarios
node scripts/qa-auth-app-guards.cjs --out=../validacao/reexecucao-guardas
node scripts/qa-card-voice.cjs --out=../validacao/reexecucao-voz
node scripts/qa-voice-session.cjs --out=../validacao/reexecucao-sessao
node scripts/qa-reliability.cjs --out=../validacao/reexecucao-integracao
node scripts/test-keyboard-ui.cjs --out=../validacao/reexecucao-teclado
node scripts/benchmark-interactive.cjs --per-variant=120 --multi-opponent --out=../validacao/reexecucao-performance
node scripts/benchmark-keyboard-ui.cjs --events=1100 --worker-load --out=../validacao/reexecucao-teclas
```

Experimentos têm protocolo e snapshots congelados. Ver `economics/METHODS.md`: não repetir um diretório/trial iniciado; novo ensaio exige namespace de seeds e protocolo próprios. Os scripts usam arquivos temporários e não editam configuração/histórico pessoal.
