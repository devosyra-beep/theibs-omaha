# THEIBS 0.14.5 — reconhecimento por voz no Analyze web

Data: 28/09/2026. Escopo: captura, interpretação, aplicação e avaliação da voz na webapp. O produto continua sendo o serviço hospedado; localhost e scripts são ferramentas de desenvolvimento.

## Resultado e limites

Implementação concluída com interpretação PT/EN, estados de captura reais, continuidade em frase completa, esclarecimento do campo ausente, desfazer na interface e avaliação voluntária isolada. **Validação acústica humana: NÃO EXECUTADA.** Nenhuma meta humana de precisão ou latência é declarada cumprida. Publicação e inspeção da hospedagem são registradas separadamente em `PUBLICACAO-0.14.5.md`.

As falhas acústicas sintéticas ficam no relatório, inclusive quando a interpretação por texto passa. Aplicação correta depende do final que o navegador fornece. Confiança numérica do reconhecedor não é tratada como probabilidade calibrada de acerto.

## Diagnóstico e mudanças

O código anterior solicitava encerramento no evento `speechend` mesmo no modo de frase completa. Também podia encerrar novamente depois de um final já aplicado. Isso introduzia retomadas desnecessárias e intervalos sem captura. A versão atual mantém o reconhecedor ativo nas pausas de frases completas; no modo rápido só solicita final quando há entrada pendente. Não reduz o limiar de estabilidade de 220 ms e não transforma resultados parciais em comandos.

O indicador **Ouvindo** passa a depender de `audiostart`. Preparando, processando, concluindo, retomando e aplicando têm estados próprios. Cancelar mantém a propriedade do microfone até o `onend` nativo; uma segunda captura espera a liberação e falha de forma explícita se ela não vier. O modo rápido continua exigindo esperar Ouvindo antes de falar a próxima carta. Frase completa é a escolha para sequências naturais.

Essas decisões seguem os eventos documentados do navegador: [`audiostart`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/audiostart_event) confirma captura; [`speechend`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/speechend_event) indica detecção do fim de fala, não encerramento do reconhecedor. `continuous` define o comportamento dos resultados e não promete latência nem ausência de interrupções ([SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)).

Um comando final incompleto agora pode pedir somente naipe, valor, ator ou outra informação necessária. O lote fica suspenso sem inserir apenas seu prefixo. O complemento é vinculado ao contexto original e expira em 15 segundos. Parar, cancelar, trocar mão/sessão ou usar o teclado invalida a espera. O temporizador é cancelado antes de uma transação válida Multiway aguardar a rede.

Ações distinguem `raise to`/“aumentar para” (total da rodada) de `raise by`/“aumentar em” (incremento sobre a aposta atual). BB explícito é convertido pelo big blind da mesa; valores sem unidade continuam em fichas. All-in é resolvido como CALL, BET ou RAISE legal no estado atual, sem reduzir silenciosamente uma aposta que ultrapassaria o limite do pote. Ator, turno, saldo, unidade e valor são validados juntos. Nenhuma ação de adversário é inferida; nenhuma aposta é enviada a plataforma externa.

O botão **Desfazer última entrada** usa o mesmo caminho validado das cartas/ledger e cancela fala pendente. As proteções contra duplicação, mudança de contexto e callbacks atrasados permanecem. Eventos de diagnóstico ficam limitados a 300 registros em memória, sem texto reconhecido, áudio ou identificação pessoal.

## Testes de software e integração

| Camada | Resultado | Limite da evidência |
|---|---:|---|
| Suíte geral Node | 425/425 PASS | Lógica e contratos; inclui 30 testes da avaliação voluntária |
| Estatística do benchmark | 6/6 PASS | Percentis, falhas no denominador e intervalo de Wilson |
| Auditoria descritiva da classificação | 7/7 PASS | Distingue abort intencional, sequência parcial e destino errado; não substitui o score bruto |
| Matriz controlada de cartas | 624/624 exatas | 52 cartas × PT/EN × PLO4/5/6 × nomes completos/curtos; ASR simulado |
| Grupos de qualidade no navegador | 31/31 PASS | Incluem a matriz acima, sequências, reinício, complemento, ações, valores e desfazer |
| Aplicação automática | 42/42 PASS | Navegador real, eventos controlados |
| Modo rápido | 26/26 PASS | Navegador real, eventos controlados |
| Revisão manual | 26/26 PASS | Navegador real, eventos controlados |
| Troca de sessão | 6/6 PASS | Cancelamento e isolamento |
| Avaliação voluntária no navegador | 10/10 PASS | Exclusão de captura, consentimento, cancelamento, isolamento, PT/EN e largura de 390 px |

Os 31 grupos incluem a matriz de 624 casos; não são 655 amostras acústicas. Os testes controlados não medem sotaque, dicção, microfone ou ruído humano. Nenhum resultado controlado é chamado de precisão do reconhecedor.

Evidências em `validacao/voice-quality-2026-09-28`: `unit-attempt-1.txt`, `controlled-release/quality-qa.json`, `auto-release/browser-qa.json`, `fast-release/browser-qa.json`, `manual-regression/browser-qa.json`, `session-regression/session-qa.json`, `evaluation-release/browser-qa.json`. As duas tentativas anteriores da matriz foram preservadas; a primeira revelou um erro do teste ao comparar tamanho absoluto de histórico de undo, corrigido para o incremento relativo. O relatório final verifica hashes da fonte antes/depois.

## Experimento sintético pareado

Foram congelados 32 WAVs de desenvolvimento, 16 PT-BR e 16 EN-US, produzidos pelas vozes Microsoft Maria Desktop e Microsoft Zira Desktop. Cada áudio é apresentado uma vez a cada versão, em ordem A/B e B/A alternada: 64 tentativas. Não são gravações humanas nem um holdout acústico. O ruído é branco sintético com SNR nominal de 15 dB, um cenário por idioma; não representa uma validação abrangente de ruído moderado real.

Os quatro assets de voz/teclado da 0.14.4 e da candidata são servidos alternadamente no mesmo ambiente web de teste; o restante da aplicação e o servidor são comuns, preservando as mesmas condições. O fluxo inclui cartas completas/curtas, duas velocidades de síntese, sequência com pausas de 150/650 ms em cada modo, flop/turn, correção, raise decimal, call, fold e frase incompleta. Recursos novos sem equivalente na baseline, como all-in, são cobertos pelos testes controlados e não entram na comparação acústica pareada.

O Chrome nativo recebe uma `AudioTrack` sintética contínua. O áudio não é repetido após reinícios e o microfone físico está bloqueado. Fim de fala é estimado pela amplitude do PCM limpo antes da adição de ruído; a medida tem incerteza de alinhamento e não constitui anotação fonética humana. Aplicações de cartas são observadas no evento síncrono do teclado; ações, na confirmação da Promise do ledger. Só finais novos contam para latência, e a aplicação de uma sequência é medida na conclusão do estado inteiro esperado. A observação continua após o áudio para detectar duplicações; erros e timeouts são preservados.

O script foi validado antes da execução nativa por oito tentativas com eventos controlados: 8/8 exatas, sem validade de tempo acústico. O modo rápido com fala contínua através de reinícios é um teste de estresse deliberado; a orientação de uso pede esperar Ouvindo. Seus resultados são separados dos casos de frase completa, sem removê-los dos totais.

Execução completa em Chrome 154.0.8037.57: **64/64 tentativas retidas, com falhas; não é PASS acústico**. Manifesto do corpus SHA-256 `bf8474f98f18b891782fb3355805d1984307d9a31bd235b20f8da899e879b2a2`. Dados brutos: `native-final/native-quality.json`; protocolo anterior à execução: `native-final/protocol-before-run.json`; auditoria posterior: `native-audit/audit.json`.

| Resultado no corpus fixo | 0.14.4 | 0.14.5 |
|---|---:|---:|
| Cartas, sequências, destino e correção exatos | 17/24 (70,8%) | 18/24 (75,0%) |
| Ações com ledger correto, após distinguir abort intencional | 5/6 | 5/6 |
| Frases negativas efetivamente exercitadas sem aplicação | 1/2 | 1/2 |
| Sequências em Frase completa | 4/4 | 4/4 |
| Sequências em modo rápido através de reinícios | 1/4 | 2/4 |
| Cartas isoladas limpas PT | 4/4 | 4/4 |
| Cartas isoladas limpas EN | 3/4 | 3/4 |
| Cartas com ruído branco sintético | 2/2 | 2/2 |
| Falhas de início | 0/32 | 0/32 |
| Timeouts, inclusive estado final errado | 3/32 | 3/32 |

Os intervalos de Wilson de 95% meramente descritivos para cartas são 50,8–85,1% e 55,1–88,0%. Uma voz sintética por idioma, um ensaio por condição e frases dependentes não permitem inferência sobre falantes humanos nem prova estatística de superioridade. O ganho é **um caso** de sequência rápida em português. As quatro sequências em Frase completa já passaram na baseline; não se atribui uma melhora acústica nesse subconjunto à mudança de código.

O coletor bruto classificava todo evento `aborted` como falha, inclusive o cancelamento que a própria UI solicita antes de confirmar uma ação HTTP. Por isso o score bruto positivo é 17/30 e 18/30. Uma auditoria posterior separada correlaciona `abort-request` e `aborted` do mesmo reconhecedor, simetricamente nas duas versões, mantendo exigências de estado correto, unicidade, final recebido e ausência de timeout. Os resultados funcionais positivos ficam 22/30 e 23/30. **O score original não foi apagado ou reescrito**, e a auditoria não é usada para declarar as metas cumpridas. Os resultados de cartas 17/24 e 18/24 são iguais nas duas classificações.

| Fim estimado da fala → carta aplicada | 0.14.4 p50 / p95 | 0.14.5 p50 / p95 |
|---|---:|---:|
| Cartas isoladas limpas PT, n=4 por versão | 753 / 975 ms | 635 / 913 ms |
| Cartas isoladas limpas EN, n=4 por versão | 642 ms / censurado | 797 ms / censurado |
| Frase completa, n=4 por versão | 837 / 1.343 ms | 818 / 1.371 ms |
| Todos os 24 cenários de cartas, incluindo falhas | 937 ms / censurado | 818 ms / censurado |

Não há melhora uniforme. Em inglês uma abreviação falhou nas duas versões; esse caso continua no denominador e impede um p95 completo. Nos 17/18 cenários de cartas exatos, final → aplicação teve p95 9,5/8,6 ms e final → duas oportunidades de renderização teve p95 38,3/42,1 ms. **Esses tempos são condicionais aos acertos**, não o p95 de toda a experiência. Com as falhas incluídas, o p95 final → visual também fica censurado.

Para diagnóstico, a candidata apresentou: pedido nativo de início → `audiostart`, p50 15,4 ms/p95 72,7 ms (24 cenários, inclusive falhas); áudio inicial → primeiro parcial, p50 796,5 ms/p95 1.120 ms (18 acertos); fim estimado da fala → final novo, p50 789,5 ms/p95 1.362,5 ms (18 acertos); aplicação → segunda oportunidade de renderização, p50 27,3 ms/p95 37,0 ms (18 acertos). O maior intervalo entre fim e retomada da captura por cenário teve p50 119,1 ms/p95 158,6 ms nos 24 casos, contando zero quando não houve retomada. A inicialização medida começa na chamada nativa, não inclui todo o caminho do clique/consentimento. A maior parcela da espera observada permanece no reconhecedor, não no cálculo do THEIBS.

Falhas concretas, presentes nas duas versões salvo indicação:

- PT rápido/pausa curta: só a primeira carta entrou corretamente; o início da segunda se perdeu durante a retomada. Em PT rápido/pausa longa a candidata completou a sequência e a baseline ficou parcial.
- PT flop: o serviço devolveu “por causa de espadas...” e a frase foi recusada sem inserir cartas.
- PT turn: o serviço omitiu “turn” e devolveu somente a carta. Ela entrou no slot selecionado da mão, produzindo **um erro de destino em cada versão**. A ferramenta não consegue reconstruir com certeza uma palavra ausente do reconhecimento. Escolher visualmente o destino antes de falar reduz a dependência desse prefixo, mas não resolve a limitação acústica.
- EN forma curta: “eight clubs” virou “a clubs” e foi recusado. EN sequência rápida curta não concluiu o lote. EN correção virou “correct card 328 of Clubs” e preservou a carta antiga, sem aplicar uma substituição aproximada.
- EN fold não recebeu final dentro do prazo. A frase negativa curta PT também não recebeu final durante a janela observada; manter a mesa vazia não lhe dá crédito de recusa correta.

Não houve carta de valor/naipe extra ou errada nem duplicação observada fora do erro de destino descrito. Isso é uma constatação deste corpus pequeno, não uma garantia. O contador bruto `incorrectApplications` inclui sequências parciais corretas; a auditoria distingue essas classes, evitando chamar toda tentativa incompleta de carta errada. Zero gravações humanas foram usadas.

## Metas e critérios preservados

- Fim acústico da fala → carta aplicada: p50 ≤ 400 ms, p95 ≤ 800 ms.
- Resultado final → atualização visual: p95 ≤ 100 ms.
- Acerto exato: ≥ 99% em fala humana limpa, ≥ 97% em ruído moderado.
- Nenhuma regressão observada em duplicação, contexto, ações ou valores.

O tempo visual dos scripts usa duas oportunidades de `requestAnimationFrame`, não uma medição física dos pixels na tela. Falhas e tempos ausentes permanecem no denominador. Percentis apenas dos sucessos são fornecidos separadamente e não substituem o critério completo. Um percentil censurado indica que o critério não foi demonstrado, não latência zero.

**Conclusão das metas:** p50 ≤ 400 ms e p95 ≤ 800 ms para o fluxo completo não foram atingidos; final → visual ≤ 100 ms foi observado nos acertos, mas não demonstrado para o conjunto com falhas; 99%/97% de precisão humana permanece NÃO EXECUTADO. Os testes de regressão de software passaram, e o pequeno comparativo acústico não apresentou novos tipos de erro na candidata. Não se declara homologação geral de velocidade, precisão ou ausência de regressões acústicas.

## Próximo gargalo e experimento proposto

O próximo trabalho deve comparar a conclusão acústica e a continuidade do reconhecedor usando gravações humanas consentidas, mantendo congelado o contrato de comandos. Nesta rodada o Chrome indicou serviço do navegador `available` e modo no dispositivo `downloadable` nos dois idiomas. Este último exigiria instalar um pacote e não foi executado; uma consulta de disponibilidade não é benchmark. Não foi instalado idioma nem ativado outro provedor.

Se o serviço nativo continuar acima das metas, a alternativa concreta é um adaptador opcional de ASR por streaming, com captura contínua, resultados finais identificados por sequência e reconexão explícita. Manter o parser e as validações atuais, impedir replay após reconexão e aplicar só finais. O piloto deverá usar o mesmo corpus humano reservado, alternância entre versões e medir latência, acerto, comandos perdidos e custo por minuto. Antes de ativá-lo, definir provedor, destino/retenção do áudio, credenciais somente no servidor, teto de gasto e consentimento visível; valores e condições comerciais ainda não foram cotados. Nesta entrega, essa alternativa é uma proposta técnica, não uma integração habilitada.

## Avaliação humana disponível, ainda pendente

Analyze → Entrada por voz → **Teste voluntário da sua voz** oferece 69 frases por combinação de idioma/variante, totalizando 414 cenários. Há 18 frases de prática e 51 reservadas em cada combinação. O teste usa cartas e ledger simulados, não altera a mesa real, não executa apostas nem solicita equity/EV.

Só captura após clique e consentimento voluntário. Há autorização separada para o serviço do navegador processar áudio remotamente. Modo somente no dispositivo exige disponibilidade do idioma, sem instalar modelos nem recorrer à nuvem silenciosamente. O THEIBS não grava áudio e não salva transcrições. A exportação JSON é local e agregada; não há upload automático. Cancelamentos, silêncio e timeouts permanecem no denominador.

Este fluxo serve para diagnóstico individual de reconhecimento. Seus tempos usam eventos do provedor e pontuação isolada; não comprovam fim acústico → carta da mesa real. Sua exportação não identifica falantes, portanto não permite estimar variabilidade por pessoa. O intervalo de Wilson é ilustrativo porque independência entre tentativas não foi estabelecida.

Para homologar as metas: recrutar falantes PT/EN, com sotaques, ritmos, distâncias e microfones variados; fixar antecipadamente o desenho e as condições de ruído; reservar **falantes e gravações**, além de frases; obter consentimento específico se houver gravação externa; comparar versões com os mesmos áudios em ordem alternada; alinhar relógio da forma de onda, aplicação e visualização; relatar erros, perdas, correções e intervalos compatíveis com amostras agrupadas por pessoa. O protocolo detalhado está em `validacao/voice-quality-2026-09-28/human-evaluation.md`.

## Como usar

1. Abra Analyze → Entrada por voz; escolha Português ou English, o processamento disponível e confira o destino selecionado na mesa.
2. Para uma carta, use Rápido, espere **Ouvindo**, diga valor e naipe e aguarde Ouvindo para a próxima.
3. Para “ás de espadas, dez de copas, oito de paus”, escolha **Frase completa**.
4. Se faltar informação, responda só ao complemento pedido. Para corrigir, diga “desfazer” ou use o botão.
5. No Multiway, identifique o ator e informe ações observadas. Raise exige esclarecer total ou incremento quando a frase não distingue os dois.

## Integridade e reversão

O escopo não modifica equity, EV, coach, autenticação ou servidor. A preparação da publicação compara todos os 48 arquivos do motor/servidor com o manifesto anterior e rejeita qualquer diferença. Os quatro assets da comparação são congelados antes da medição; fonte e corpus não podem mudar depois de obtidos os dados sem uma nova rodada identificada.

Baseline publicada: commit `dac980dda0b33287a451b02b0bc47f8a9b3d4701`, versão 0.14.4, árvore `d3502688b490fa5900cbe50c40ab28c59f6a6aa5`. A reversão de serviço consiste em selecionar esse commit em Manual Deploy do mesmo serviço Render e conferir `/healthz`, `/api/status`, arquivos servidos e Analyze autenticado. Não requer migração de dados. O deploy pode reiniciar armazenamento efêmero da hospedagem; preservar a mão visível antes da operação.

Arquivo anterior preservado: `validacao/voice-speed-2026-09-28/theibs-web-source-0.14.4.zip`, SHA-256 `174e3d077f28775805af47caedfdd11f716e7dec423c3b3ad701147521e2a203`. O ZIP novo, o hash, a árvore, o commit e a evidência HTTP são registrados junto à publicação. PASS técnico, implantação online e reconhecimento humano são resultados separados.
