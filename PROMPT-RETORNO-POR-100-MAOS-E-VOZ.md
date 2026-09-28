# Prompt — Analyze online: retorno por 100 mãos e entrada de cartas por voz

> Adendo autorizado na execução (27/09/2026): validar localmente; hospedagem depois. A voz deve interpretar português (pt-BR) e inglês (en-US), distinguindo valores e naipes com o mesmo rigor nos dois idiomas. Medir reconhecimento acústico separadamente do parser; falas ambíguas não alteram cartas. Priorizar redução de latência de entrada e cálculo preservando orçamento, precisão, regras de decisão e qualidade já alcançados. Otimização não autoriza diminuir amostras nem afrouxar intervalos para aparentar velocidade.

Preparado para o THEIBS 0.13.0 em 27/09/2026, após inspeção do código e revisão por três subagentes. Este documento prepara a próxima execução; nenhuma funcionalidade de voz ou nova estimativa de lucro foi implementada nesta preparação.

Copie a partir de “Início do prompt”, ou peça ao agente para executar integralmente este arquivo.

---

> Ampliação autorizada durante a execução: voz também registra fold/check/call/bet/raise, valores e ator (herói ou ADV.N) no ledger Multiway, em PT/EN. Exigir identificação inequívoca, vez e limites legais; raise indica o total, não incremento adivinhado. Testar desfazer, persistência e resposta obsoleta durante requisição. Investigar reconhecimento acústico real, sem confundir parser com ASR. Diagnosticar demora, EV ausente/inconclusivo e baixa frequência de EV positivo na versão efetivamente usada, sem fabricar valores verdes. A imagem fornecida mostrou produção com flop de uma carta: orientar a completar o flop antes de calcular. Produto único: webapp hospedada; testes em loopback são QA, nunca uma entrega desktop ou instalação para o jogador.

## Início do prompt

Atue como responsável técnico e estatístico pela próxima evolução do THEIBS, com foco na área **Analyze da versão web hospedada**. Execute programação, testes e experimentos, com três subagentes especializados e revisão cruzada. Não entregue apenas um plano. Há duas frentes: **avaliar e melhorar o retorno líquido de seguir a política de recomendações do Analyze** e **permitir ditar cartas em português no Analyze como alternativa ao teclado**.

O produto é uma ferramenta de estudo e apoio à decisão. É legítimo buscar vantagem econômica; a tarefa é descobri-la, quantificá-la e melhorar o que impede alcançá-la. Não confunda ausência de estudo humano com defeito do motor. Não use a ausência de jogadores humanos para interromper validações computacionais possíveis. Entretanto, não converta cálculo condicional correto em promessa de lucro.

### 1. Escopo, equipe e preservação

O produto de destino é o Analyze acessado pelo navegador em uma hospedagem HTTPS. O escopo inclui seus inputs por teclado/mouse/voz, equity, EV, ações e sizings suportados, assistente/coach, gráficos, rastreabilidade e apresentação das estimativas econômicas. Preserve as variantes e os fluxos existentes, incluindo multiway. Não trabalhar no aplicativo desktop, Electron, empacotadores, executáveis ou permissões nativas.

Treino não é uma frente de produto desta entrega. Seu simulador pode servir como ambiente de experimento, mas o agente avaliado deve executar a mesma política, contratos, hipóteses, prazos e fallback utilizados pelo Analyze. Melhorar apenas o avaliador do Treino não comprova melhoria no Analyze. Uma mudança em módulo compartilhado deve ser rastreada até a API e a interface do Analyze e manter as regressões relevantes dos consumidores existentes.

Localize a raiz que contém `codigo-fonte/package.json`. Leia instruções locais e estes documentos:

- `RELATORIO-VALIDACAO-0.13.0.md`;
- `PROTOCOLO-BENEFICIO-ESTRATEGICO.md`;
- `validacao/execucao-2026-09-27/MATRIZ-COBERTURA.md`;
- `validacao/execucao-2026-09-27/policy-pilot/protocol.json`, `results.json` e `hands.jsonl`;
- `validacao/execucao-2026-09-27/MANIFESTO-FINAL.json`.

Reconfirme versões e arquivos; não trate os números históricos como testes novos. Preserve o baseline 0.13.0, seus hashes, registros pessoais e toda evidência anterior. Se não houver Git, crie snapshot identificável. Use dados temporários nos ensaios.

Divida o trabalho:

1. **Matemática e estratégia:** rollouts, ranges, custos, comparação de ações, política completa e adversários independentes.
2. **Voz e desempenho:** ASR, parser, transações de input, permissões, latência e regressões de teclado.
3. **Avaliação independente e produto:** protocolo, amostragem, interpretação econômica, painel/coach e testes adversariais de ambas as frentes.

Defina propriedade de arquivos. Quem implementa não pode ser o único revisor. Coordenador integra alterações, mede ponta a ponta e resolve conflitos. Reutilize os agentes para procurar vazamento de informação, falsa aprovação e falhas de concorrência.

Pode desenvolver e testar a versão web localmente; o destino da entrega é a hospedagem online. Valide também em preview/staging autorizado, quando disponível, registrando URL, versão e configuração. Localhost não comprova funcionamento hospedado. Se não houver ambiente online autorizado, conclua o trabalho independente, registre essa validação como NOT_EXECUTED e especifique o que falta. Preserve autenticação, sessões e persistência existentes. Não publicar, contratar serviços, apostar dinheiro, alterar produção ou instalar modelos grandes. Dependência que exija custo, conta ou download significativo deve ser especificada concretamente; conclua o trabalho independente dela. Não atribua ao “talento do jogador” um resultado ruim sem hipótese ou medição.

### 2. O resultado econômico que deve ser medido

Nesta tarefa, “100 partidas” significa **100 mãos completas**, incluindo blinds, folds, mãos sem recomendação e falhas com fallback. Não significa 100 decisões escolhidas a dedo, 100 vitórias, 100 sessões ou 100 torneios.

Use resultados líquidos do ledger, sem somar EVs de streets como se fossem lucros independentes. Para cada ambiente e política, apresente:

| Medida | Definição e interpretação |
|---|---|
| Retorno médio líquido | `w = 100 × média(resultado líquido da mão / BB da mão)`, em **bb/100**. |
| Vantagem relativa | Diferença pareada de bb/100 versus o baseline, com intervalo ajustado. Pode melhorar e continuar negativa. |
| Percentual sobre capital de referência | Com stakes constantes e capital `B_ref` expresso em BB: `100 × w / B_ref` % por 100 mãos. Declare o denominador e propague o intervalo de w. |
| Probabilidade de terminar 100 mãos positivo | `P(soma dos resultados líquidos das próximas 100 mãos > 0)`, condicional ao ambiente, política e processo de banca definidos. |
| Dispersão do próximo bloco | Intervalo preditivo do resultado de 100 mãos; não é o IC da média de longo prazo. |
| Risco e cobertura | Drawdown observado/simulado, perdas extremas, falhas, abstenções e composição das decisões suportadas. |

Exemplo **somente aritmético**: 5 bb/100 corresponderiam a 5% de um capital de referência de 100 BB, ou 0,5% de 1.000 BB, por 100 mãos. Não significam 5% de chance de ganhar, 5% sobre cada aposta nem uma medição do THEIBS. Não chamar essa razão de ROI de torneio ou rentabilidade de banca real sem modelar o processo correspondente.

Se `S100` já estiver expresso em BB para um bloco de 100 mãos, sua média já é bb/100: não multiplique novamente por 100. Não invente um percentual-alvo aprovado. Estime um valor, uma faixa e sua origem. Para a mesma configuração, reporte separadamente resultados observados, estimativa confirmatória e projeções do modelo. Se a informação não permitir uma faixa útil, informe **“estimativa indisponível/imprecisa”**, explique a causa e dimensione o próximo experimento. Não use os 18 deals antigos para preencher um cartão de lucro confiável.

A lei dos grandes números é a justificativa para estimar uma expectativa sob condições apropriadas; ela não demonstra que a expectativa verdadeira é positiva nem corrige modelo adversário errado. Expectativa positiva não exige mais de 50% de blocos positivos, e alta frequência de blocos positivos pode esconder perdas raras grandes. Inclua contraexemplos desses dois casos na validação das interpretações do painel. Adversários adaptativos, mudança de stakes e dependência entre mãos precisam de desenho explícito. A convergência não estabelece um número universal de mãos para obter lucro.

### 3. Diagnóstico obrigatório no código

Trace primeiro o caminho do Analyze e reconfirme os achados com arquivo/linha, impacto, hipótese testável e contraexemplo. Os caminhos abaixo são relativos a `codigo-fonte`:

- `public/app.js` chama `/api/analyze` para PREVIEW e FINAL. Em `server.js`, a rota usa `analyzeManual`; `src/analysis-worker.js` encaminha a análise normal para `src/decision-engine.js`. Trace equity, EV de ações, ranges, custos, seleção e contrato até o valor e a recomendação visíveis. Verifique quais casos são apenas SHOWDOWN_ONLY e o que falta para modelar respostas adversárias e decisões futuras.
- `public/assistant-ui.js` usa `/api/analysis/prepare` e `/api/analysis/doubt`; esta última também chama `analyzeManual`. As explicações do coach do Analyze devem corresponder ao mesmo estado e resultado numérico, incluindo incerteza e ausência de modelo. Não validar esse fluxo apenas por `/api/training/doubt`.
- Levante as entradas efetivamente fornecidas pelo Analyze para ação/sizing, contribuições, side pots, ranges, histórico e modelos de resposta adversária. Identifique o que é informado, inferido ou ausente. Não preencher hipóteses faltantes com valores favoráveis só para emitir recomendação.
- `src/analysis-contract.js`: `recommendation.action` é a preferência suportada; `recommendation.pointLeader` é o líder pontual. `recommendedAction` legado pode incluir ajuste heurístico. Preserve a diferença e confirme qual campo cada consumidor usa.

Os achados históricos seguintes pertencem principalmente ao avaliador e ao piloto de Treino. Use-os para reaproveitar infraestrutura e identificar limites do experimento; não os apresente como medição direta do Analyze:

- `src/training-evaluator.js`: `publicConfig` aceita apenas heads-up com herói BTN; `trainingEvaluationInput` usa 256 rollouts por opção e `normalizeInput` limita a 2.048. `drawWorld` usa prior uniforme, sem atualização pela sequência de ações. `rollout` continua o herói pela heurística MIXED e liquida com rake zero.
- O mesmo avaliador compartilha mundos entre candidatos, mas `empiricalInterval` constrói limites marginais e `candidateLeadership` exige separação de todos eles. Investigue o uso efetivo do pareamento.
- Em configuração inicial com amplitude W=200 fichas, K≈5 opções e N=256, o termo linear do limite Bernstein é aproximadamente **10,96 fichas por intervalo antes do clipping**, mesmo com variância amostral zero. Verifique essa conta no estado real; compare com gaps de EV e efeitos relevantes. Isso pode reduzir utilidade sem significar ausência de vantagem.
- `scripts/evaluate-policy.cjs`: piloto HU/BTN, 100 fichas com BB=2 (**50 BB**), 256 rollouts, duas mãos por célula; a política executada reconsulta o motor em cada decisão, diferentemente da continuação usada no rollout. Todas as 72 decisões candidatas do piloto recorreram ao fallback. Não confundir essas duas políticas.
- `src/policy-experiment.js`: rake é hoje sensibilidade descontada depois da mão, sem influenciar a escolha. Regras de custo precisam entrar no ambiente e na avaliação da decisão.
- `src/opponent-policy.js`, `src/training-simulator.js`, `src/hand-flow.js`, `src/training-analysis.js` e o worker definem informação, legalidade, políticas e orçamento efetivamente usados. Trace o caminho executado, não apenas nomes de funções.

Instrumente as abstenções atuais do Analyze separadamente das 72 decisões históricas do piloto de Treino: falta de modelo, adversários ausentes, empate exato, equivalência prática, sobreposição, grade com tamanhos quase idênticos, margem de amplitude, variância, amostras, prazo ou erro. Mostre percentuais **com denominadores**, por variante/street/posição/stack e dificuldade. Não exija recomendação em 100% dos casos: exigir isso incentiva falsa certeza.

### 4. Implementar melhorias estratégicas que possam ser testadas

Priorize o gargalo demonstrado no Analyze, em lotes pequenos, antes de aumentar indiscriminadamente o volume de mãos. Aplique as melhorias abaixo às camadas em que forem pertinentes; se adotar rollouts hoje exclusivos do Treino, integre-os explicitamente ao Analyze ou a um motor compartilhado e valide esse caminho. Não encerrar com mudanças isoladas em `training-evaluator.js`:

1. Comparar intervalos de **diferenças pareadas** entre ações, com limites corretos e controle simultâneo da seleção. O suporte da diferença pode ser maior que o de cada retorno: não presuma intervalos menores nem omita o termo de amplitude. Mostre ganho ou ausência de ganho nos mesmos casos.
2. Usar enumeração em subproblemas pequenos, reaproveitamento válido de cálculos, redução de variância e orçamento adaptativo quando justificáveis. Se olhar repetidamente o resultado, usar inferência sequencial válida ou etapas/alpha pré-definidos; não consultar IC de N fixo até aprovar.
3. Avaliar **equivalência prática** ou limite de arrependimento para ações próximas, com epsilon em BB escolhido antes do teste e compatível com o objetivo econômico. Um rótulo “equivalentes dentro de epsilon no modelo” não vira “melhor ação comprovada”. Não reduzir o gate para esconder a abstenção.
4. Modelar rake dentro das escolhas e pagamentos: percentual, cap, no-flop-no-drop quando aplicável, arredondamento, aposta não coberta e potes elegíveis. Testar conservação com rake: stacks finais + valor recolhido = stacks iniciais, respeitando aportes/retiradas definidos.
5. Avaliar ranges condicionados à ação e posição, com origem e versão. Mostrar sensibilidade a ranges plausíveis e erro de especificação, sem consultar cartas ocultas ou aprender do teste reservado.
6. Tornar explícita e consistente a política de continuação avaliada versus a política que será seguida. Resolver por desenho justificado — não assumir que o EV de seguir MIXED depois da primeira ação é o EV de reconsultar o motor em todas as streets.
7. Implementar suporte correto a BTN e BB no cenário HU, antes de declarar desempenho da mesa inteira. Não obter alternância apenas trocando o texto da posição.
8. Definir política de fallback, deadline e erros como parte da estratégia completa. Compare alternativas justificadas; CHECK/CALL automático não é fallback economicamente seguro por definição.

Produza ablações: baseline 0.13.0 congelado; mesmo motor com outra regra de seleção; nova inferência com mesmos ranges/política; novos ranges; novo modelo de custos; candidato combinado. Manter ação, sizing, orçamento e informação comparáveis quando a pergunta for sobre uma camada específica. Não procurar retrospectivamente só a combinação vencedora.

Para cada mudança aplicável, demonstre que ela alcança `/api/analyze`, o resultado visível e o coach em `/api/analysis/doubt`. Resultados de treinamento só contam como evidência do Analyze quando a equivalência de política e entradas estiver demonstrada; o E2E da API/interface continua obrigatório.

### 5. Um primeiro cenário econômico bem definido e expansão

Comece pela comparação reproduzível mais próxima do código existente: **PLO5 High, heads-up, 50 BB**, confirmando blinds, stacks e ausência de antes/straddle. Avalie os dois assentos após implementar essa capacidade. Mantenha o cenário histórico BTN isolado como regressão, sem chamá-lo de mesa balanceada.

Esse é o primeiro cenário do benchmark econômico, não uma redução das capacidades da interface Analyze. Preserve PLO4/PLO5/PLO6 e os fluxos já suportados; identifique separadamente os cenários cuja vantagem ainda não foi avaliada.

Use ambientes de custo separados: zero explicitamente declarado como controle e rake sintético documentado como teste. Só chame de configuração real quando taxa, cap e incidência tiverem origem verificável. Depois expanda para 100 BB, PLO4/PLO6 e outras mesas como coortes próprias. Sucesso em HU não aprova automaticamente multiway.

Adversários devem incluir baselines simples e políticas de famílias implementadas/reservadas de forma independente do avaliador, incluindo perfis que explorem erros recorrentes do candidato. O estilo verdadeiro do adversário reservado não pode ser um parâmetro privilegiado fornecido ao herói; compare modelo desconhecido/inferido usando apenas histórico permitido. “Mesmo bot com outro nome ou seed” não é validação externa.

Avalie inicialmente seguimento integral da política; depois faça sensibilidade a desvios do jogador com regras explícitas. Frações de adesão, atrasos ou erros hipotéticos são simulações, não perfis humanos medidos. O objetivo é verificar se o apoio funciona dentro de hipóteses identificáveis, sem exigir prova de aprendizagem humana nesta fase.

### 6. Experimento de vantagem e projeção de 100 mãos

Antes do teste final, grave protocolo, hashes, limites de recursos, critérios de aprovação e todas as políticas. Separe desenvolvimento, piloto de variância, validação e holdout final. Se uma amostra orientar mudanças, deixe de tratá-la como holdout.

Construa um adaptador de política que consulte o motor efetivamente usado pelo Analyze a cada decisão, recebendo somente informações disponíveis ao jogador. Inclua a regra explícita que transforma seu contrato em ação/sizing, além de abstenções, prazos e fallback. Compare Analyze 0.13.0 congelado versus Analyze candidato. O piloto anterior baseado no avaliador TRAINING é referência histórica, não substituto dessa comparação. É permitido usar o simulador como ambiente; não fornecer cartas ocultas, modelos adversários privilegiados ou mais informação ao adaptador do que o produto teria. Se o harness chamar diretamente módulos para ganhar velocidade, comprove equivalência com a API por fixtures e mantenha testes ponta a ponta do fluxo hospedado.

- Pareie deals e assentos entre políticas; o cluster reúne execuções correlacionadas. Para oponentes adaptativos, preserve sessões e memória, com clusters independentes. Não conte as três políticas no mesmo deal como três observações independentes.
- Dimensione a amostra por variância, poder e efeito relevante. Use como proposta inicial a meta anterior de **ganho relativo mínimo de 1 bb/100**, alpha familiar 5% e poder 80%; justifique uma alternativa maior que o limiar para planejar o poder. Essa é uma meta de validação, não ganho já obtido. Dimensione também a positividade absoluta.
- Aprovação de vantagem: limite inferior ajustado da diferença acima do limiar relevante. Aprovação de expectativa positiva: limite inferior ajustado do retorno absoluto acima de zero. Ambas precisam passar para a alegação conjunta, no ambiente declarado.
- Controle multiplicidade entre variantes, custos, políticas e métricas confirmatórias. Use N fixo ou regra sequencial válida. Publique tentativas, falhas e resultados negativos; não parar porque o gráfico ficou positivo.
- Para `P(lucro em 100 mãos)`, defina primeiro: stakes constantes? reset de stack por mão ou sessão contínua? reposição e financiamento? limite de banca? ordem dos assentos? adaptação adversária? Sem isso, a probabilidade está mal definida. Aportes externos, retiradas e transferências internas entre caixa e mesa precisam de ledger; transferência interna não é lucro nem custo novo. Não excluir blocos interrompidos por falta de capital, pois isso cria viés de sobrevivência.
- Gere **blocos/sessões de 100 mãos completos**, incluindo a política de capital/stop definida. Com reposição ilimitada, chame de benchmark com reposição, não probabilidade de sobrevivência de uma banca finita. Não estimar risco de ruína a partir de mãos isoladas que sempre reiniciam o stack.
- Reporte probabilidade de saldo >0, de saldo =0 e de perda; quantis preditivos; intervalo para a probabilidade; número de blocos/cluster e erro Monte Carlo. Não tratar janelas sobrepostas como blocos independentes. Bootstrap só com unidades/dependência adequadas e suporte empírico suficiente.
- Distinga incerteza da média, variabilidade do próximo bloco e erro de modelo. Uma simulação maior reduz erro Monte Carlo; não valida a população adversária. Aproximação normal deve ser testada/justificada e identificada como aproximação.

Sem evidência suficiente, entregue valores exploratórios identificados, intervalo amplo/indisponível e o tamanho/referência que falta; não produza um “% de lucro” com precisão falsa.

### 7. Painel e coach orientados ao estudo

Implemente uma seção acessível dentro do Analyze para os resultados do experimento, distinguindo visualmente métricas de longo prazo da análise da mão atual. Não criar uma nova frente de interface no Treino. Exiba ambiente, versão, custos, tamanho da amostra, bb/100, diferença versus baseline, percentual sobre B_ref, probabilidade de terminar 100 mãos positivo e respectivos intervalos/origens. Valores sem evidência aparecem indisponíveis, não como zero. Uma estimativa econômica de outro cenário não deve ser aplicada automaticamente à mão atual.

A chave de cenário econômico inclui posição, número de jogadores, profundidade, custos, adversários/ranges, política/grade, fallback, orçamento, versão e esquema de financiamento. O agrupamento atual do histórico não basta automaticamente para esse uso. O coach do Analyze deve explicar o mecanismo da recomendação, alternativas próximas, custos e informação ausente, pelo fluxo `/api/analysis/doubt`. Mostre como uma decisão pode ser boa e perder, e como um resultado bom pode vir de uma decisão ruim. Não atribua ao usuário incapacidade quando o recomendador se abstém ou seu modelo falha.

A interface não pode transformar retorno médio em taxa de vitórias, IC da média em faixa provável da próxima sessão, nem dados sintéticos em histórico pessoal. Identifique origem dos dados (`MODEL/SIMULATION` ou referência externa real) e ambiente de execução (`LOCAL_EXECUTED`, `HOSTED_EXECUTED` ou `NOT_EXECUTED`) separadamente. Executar uma simulação na hospedagem não a transforma em resultado observado de jogadores reais.

### 8. Voz: um fluxo de entrada de cartas em português

Implemente no **Analyze online** o fluxo **“pressionar para falar → reconhecer cartas → validar → aplicar → avançar o slot”**, com botão acessível, alternativa acessível de iniciar/parar sem segurar e atalho sem conflito. Não use Shift isolado, que já inicia nova mão no THEIBS. Esta primeira função de voz é para registrar/editar cartas; não é conversa falada com o coach nem execução de apostas. Ative-a apenas nos contextos de entrada de cartas suportados do Analyze; não estender a interface do Treino nesta entrega.

Exemplos de comportamento:

| Fala | Carta do motor | Notação atual de teclado |
|---|---|---|
| “ás de espadas” |As|AE|
| “rei de copas” |Kh|KC|
| “dama de ouros” |Qd|QO|
| “valete de paus” |Jc|JP|
| “dez de espadas” |Ts|TE|

Aceitar cartas isoladas e sequências como “ás de espadas, rei de copas, dama de ouros”. Suportar comandos claramente delimitados: “minhas cartas”, “flop”, “turn”, “river”, “selecionar carta três”, “corrigir carta três para dama de ouros”, “remover carta selecionada”, “desfazer” e “cancelar”. Defina escopo dos destinos: mão, board e carta selecionada; um lote destinado ao flop não pode derramar cartas para turn/river ou mão; não adivinhe se o destino é ambíguo. Comando destrutivo amplo mantém a confirmação que o produto já exige.

Use as 13 figuras/valores e quatro naipes, singular/plural e acentos; documente aliases. **Dama falada deve virar Q**, embora o atalho D atual signifique dez. O `c` canônico significa paus; C do teclado significa copas. Nunca atravesse conversores misturando essas notações.

Quando a transcrição final for completa, inequívoca e admitida pelo gate de qualidade medido, aplique sem pedir confirmação a cada carta e avance como teclado. Se faltar naipe, houver ambiguidade/baixa qualidade, duplicata, capacidade excedida ou erro, destaque a pendência sem mudar a mesa. Não “conserte” automaticamente para outra carta apenas porque a reconhecida já existe. Confidence do ASR não é probabilidade calibrada de acerto.

### 9. Integração e permissões de voz

Inspecione `public/card-model.js`, `public/card-keyboard.js`, `public/app.js`, `public/multiway-ui.js`, CSP, inicialização web e configuração da hospedagem existente.

Crie comandos tipados em uma camada comum. Fluxo: ASR → parser determinístico → proposta tipada → validação/transação de estado → render/evento existente → invalidação, cálculo e persistência. Reaproveite as regras de teclado/mouse; não simule sequências de KeyboardEvent nem escreva diretamente slots/DOM ignorando validação.

- `CardKeyboardState.assign/paste/undo` já possui comportamento a preservar. `writeInputs` emite `theibs:cards-changed`, usado pelo app. A API pública atual não oferece commit tipado/revisão; refatore minimamente para isso.
- Não use `theibsCardKeyboard.restore()` para toda frase: hoje ele limpa undo. Faça frase/lote atômico com uma operação de desfazer, restaurando cartas e seleção. Defina explicitamente a unidade de undo para vários segmentos finais.
- No push-to-talk, consolide todos os segmentos finais numa única frase/transação ao encerrar a fala; um trecho posterior ambíguo não pode deixar parte anterior aplicada. Transcrição parcial só gera prévia visual; nunca afeta equity, EV, gráfico ou histórico. Um resultado “final” de ASR ainda pode estar errado e passa pelo parser/gate.
- Use identidade da sessão de reconhecimento e índice/identificador de segmento para idempotência. Não deduplique só pelo texto: duas falas iguais em momentos distintos podem ser intencionais.
- Capture mão, modo, variante, destino/seleção, revisão e sessão do usuário. Se teclado/mouse, nova mão, mudança de slot/variante/street, saída de tela, logout ou expiração de sessão mudar o contexto durante a fala, cancele/revalide explicitamente; nunca aplique a um destino diferente silenciosamente. Diferencie revisões dos próprios commits de voz de edições concorrentes. Retorno tardio após desconexão/reconexão não pode reaplicar o comando.
- Multiway no Analyze respeita a fase e a transação BOARD do ledger; não antecipa streets nem altera board pelo caminho simples. Indique visualmente os contextos onde a voz está disponível.
- Microfone ativo tem indicador, início e término visíveis, cancelamento e tratamento de silêncio, permissão negada, dispositivo ausente, falha/reconexão e perda de foco. Se o usuário soltar/cancelar enquanto aguarda a autorização inicial do microfone, não comece a escutar depois. Não manter escuta permanente escondida nem gravar áudio ou transcrições por padrão.

Escolha um adaptador ASR após testar o ambiente real da versão hospedada. Defina a matriz de navegadores/dispositivos suportados e verifique reconhecimento real em pt-BR. `SpeechRecognition` tem disponibilidade limitada e, em certas implementações, envia áudio a um serviço remoto. Não presuma reconhecimento funcional pela presença do construtor; não prometa processamento no dispositivo ou offline apenas por existir `processLocally`.

Capture o microfone no navegador do usuário, em contexto seguro HTTPS, com gesto explícito e permissão visível. Se o adaptador usar `getUserMedia`, solicite somente áudio. Verifique Permissions-Policy quando houver incorporação em iframe e ajuste CSP apenas para os destinos efetivamente necessários. Trate negação/revogação de permissão e indisponibilidade sem impedir o teclado. O servidor hospedado não acessa diretamente o microfone do usuário. Não depender de aplicativo instalado, serviço em localhost ou modelo local do desenvolvedor para aprovar a entrega online.

Prefira processamento no próprio navegador quando viável e verificado; para processamento remoto, informe destino/modo ao usuário e obtenha a permissão correspondente antes de enviar áudio. Não faça fallback silencioso do dispositivo para nuvem. Se houver ASR no backend, verifique autenticação, limites de payload, duração, concorrência, latência e recursos da hospedagem, mantendo segredos no servidor. Não instalar modelo grande ou serviço pago para declarar a tarefa concluída. Se o provedor real estiver indisponível, implemente o adaptador/parser/UX/testes possíveis e registre a dependência exata; mock não aprova reconhecimento acústico.

### 10. Validação da voz e preservação de desempenho

Congele os critérios antes de ajustar o parser/reconhecedor. Separe três camadas de evidência:

1. **Texto/parser e estado:** 52 cartas × três variantes; sequências, destinos, correções, duplicatas, slots cheios, ambiguidades, interims, finais repetidos, cancelamento, undo, digitação simultânea e resposta obsoleta. Esperado: 100% dos casos determinísticos corretos, zero commit de frase inválida e zero aplicação duplicada/obsoleta.
2. **Áudio pelo provedor real:** corpus com referência correta, vozes/sotaques, dispositivos, ruído/silêncio e frases fora de domínio. Separe conjuntos por falante/gravação; não validar só com TTS limpo ou frases usadas no desenvolvimento. Áudio sintético fica identificado. Não alegar diversidade humana que não foi gravada/testada.
3. **Fluxo real no Analyze hospedado:** falar → cartas visíveis → próximo slot → payload canônico correto em `/api/analyze` → recálculo → persistência/reabertura e undo. Exercitar com cálculo concorrente, erros de permissão, interrupção, navegação, expiração de sessão e perda de rede. Registrar URL autorizada de preview/staging, versão, navegador, dispositivo, provedor, rede e configuração do servidor. Sem esse ensaio, o E2E online é NOT_EXECUTED, mesmo com parser e testes locais aprovados.

Medir separadamente: acerto exato por carta/lote, comandos corretos, rejeições/pedidos de confirmação, correções manuais e **cartas erradas aplicadas automaticamente**. Não publicar alta precisão baseada apenas nas transcrições aceitas sem reportar cobertura/rejeições. WER não substitui erro de carta: errar o naipe uma vez pode invalidar toda a análise.

Metas iniciais, a validar no equipamento/corpus e na configuração de hospedagem/rede declarados:

- zero corrupção, duplicação de efeito e aplicação a contexto obsoleto nos testes executados;
- resultado final aceito → oportunidade visual: p95 ≤100 ms;
- fim da fala → carta aplicada: p95 ≤1,5 s, separando ASR, parser, fila, render e inicialização;
- acerto exato de comando/carta ≥98% no corpus reservado de áudio, com amostra e intervalo reportados; estimar também erro de autoaplicação e sua incerteza, sem tratar “zero observado” como risco zero;
- preservar o alvo do teclado p95 ≤50 ms/p99 ≤100 ms, preview ≤500 ms e final ≤3 s **com precisão/decisão exigida**, na matriz previamente declarada.

Essas metas são requisitos propostos, não fatos já atingidos. Pré-registre se o gate acústico usa estimativa pontual ou limite inferior e dimensione o corpus de acordo. Não baixar o limiar depois de uma falha; reportar tradeoff entre autoaplicação, precisão e necessidade de correção. Medir segundo rAF como proxy, sem chamar isso de pintura física.

Separe latência de input/render no cliente, rede, fila, cálculo no servidor e ASR. Meça execuções frias/quentes e concorrência representativa, com percentis e número de observações. Benchmarks locais anteriores não demonstram latência da hospedagem. Preserve a prioridade do teclado e descarte respostas de cálculo obsoletas. Verifique o coach e os gráficos sob as mesmas condições, sem permitir que uma explicação demorada bloqueie a entrada de cartas.

### 11. Entregas e conclusão obrigatória

Entregue:

- implementação web focada no Analyze, pronta para a hospedagem prevista, diffs/snapshot, testes e comandos reproduzíveis;
- mapa do fluxo Analyze → API → motor → contrato → coach/gráficos e diagnóstico das abstenções e orçamento/precisão, com comparação antes/depois no mesmo cenário;
- melhorias de política/custo/posição implementadas, ablações e holdout preservado;
- harness de políticas completas do Analyze e blocos de 100 mãos, resultados/intervalos, fontes, equivalência com a API e modelos de capital;
- painel/coach do Analyze que apresentem as métricas econômicas sem misturar significados;
- entrada por voz no Analyze integrada ao estado real, com provedor/capacidade identificados e fluxo de correção;
- evidência separada de parser, áudio real e E2E; matriz de navegadores/dispositivos compatíveis/incompatíveis e distinção entre testes locais e testes na hospedagem autorizada;
- relatório capacidade → cenário → esperado → observado → evidência → PASS/FAIL/INCONCLUSIVE/NOT_EXECUTED;
- versão e histórico coerentes, limitações e próximos experimentos concretos.

Responda diretamente ao final:

1. Quanto a política ganha/perde em bb/100 em cada cenário e com qual intervalo?
2. Qual percentual isso representa sobre o capital de referência declarado?
3. Qual é a chance estimada de terminar um bloco de 100 mãos positivo, e sob qual modelo de sessão/banca?
4. O candidato melhorou versus 0.13.0 e demonstrou retorno absoluto positivo, ou apenas uma dessas condições?
5. Por que o motor se abstinha, o que mudou e a que custo de latência/risco de erro?
6. Quais frases de voz funcionaram no Analyze hospedado pelo provedor real, com que precisão/latência e em quais navegadores/dispositivos?
7. O que continua dependente de referência externa ou estudo humano?

Se os resultados forem negativos ou inconclusivos, explique o mecanismo identificado e a alteração prioritária. Não encerre apenas repetindo que “poker tem variância”; também não fabrique um número positivo para cumprir a meta.

## Fim do prompt

---

## Referências consultadas na preparação

- [Lei dos grandes números — Statlect, Marco Taboga](https://new.statlect.com/asymptotic-theory/law-of-large-numbers): convergência e hipóteses; não certifica expectativa positiva.
- [Howard et al. — sequências de confiança válidas no tempo](https://arxiv.org/abs/1810.08240): referência para inferência sequencial; escolher uma implementação apropriada ao desenho concreto.
- [MDN — SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition): suporte limitado, reconhecimento remoto em algumas implementações e APIs dependentes do runtime.
- [MDN — getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): contexto seguro, permissões de microfone e restrições de incorporação.
- [MDN — available()](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static): verificar recursos locais/idioma sem presumir suporte.
- [MDN — interimResults](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults): distinguir resultados parciais dos finais.

Os caminhos de código acima foram inspecionados nesta preparação; devem ser reconfirmados quando o prompt for executado. Nenhum percentual de lucro, taxa acústica ou nova meta de latência foi medido nesta preparação.
