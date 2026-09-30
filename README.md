# THEIBS — laboratório Omaha

Versão do código: **0.14.8**. Análise e treino de Omaha High PLO4, PLO5 e PLO6, com equity, EV condicionado às premissas, coach, entrada de cartas e histórico.

## Multiway 0.14.8

The observed table now distinguishes a new street from a new hand, keeps stable
player identities and requires reconciliation for unknown results. Actions can
be recorded before Hero cards are entered. Local Players history feeds a frozen
pre-hand contextual profile, with notes kept separate from observed statistics.

Action EV uses an explicit heuristic continuation model, including legal sizing
candidates and side pots when solver coverage is absent. The fallback is labeled
`HEURISTIC`, never GTO. A shared strategic contract now also supports small PLO5
river subgames with explicit complete study ranges and a fully enumerated tree
for the declared sizing abstraction. CFR+ results replace the whole EV table;
they do not borrow heuristic rows. Two-player constant-sum subgames can receive
`SOLVED` only after supported mathematical qualification and exact NashConv
at or below 0.01 bb. Multiplayer and materially abstracted games remain
`APPROXIMATE`; they do not inherit heads-up convergence guarantees. This is not
a solution of full PLO5 Multiway or safe re-solving of an earlier equilibrium.

The interface
automatically calculates EV before room fees; a specific fee is an optional
advanced assumption. No room fee is inferred. Overlapping numerical intervals
remain inconclusive.
Known voice sequences use the deterministic parser. Optional Llama assistance
is disabled for this delivery and is not required for voice or calculations.

See [the Multiway contract and limitations](codigo-fonte/docs/multiway-continuity.md)
and [the optional provider boundary](codigo-fonte/docs/multiway-llm-provider.md).
The [solver architecture and qualification](codigo-fonte/docs/solver-architecture.md)
documents coverage, versions, cancellation, cache compatibility and validation.
FAST, STANDARD and DEEP are computational budgets, not quality promises. Source,
scope, iterations and measured quality accompany each result. Voice and manual
recording do not wait for background solving.

## Produto e validação

A única entrega ao jogador é a **webapp hospedada**, acessada pelo navegador. Não exige aplicativo instalado, Node.js, Electron, Ollama nem serviço no computador do jogador. A voz é capturada no navegador com permissão explícita; cálculo, coach e persistência usam a API hospedada.

Os comandos de Node.js nos relatórios são ferramentas de desenvolvimento e QA do mesmo código antes da publicação. `LOCAL_EXECUTED` identifica o ambiente de teste, não uma segunda versão do produto. A versão anterior publicada é 0.14.4; o registro da atualização atual e sua verificação online ficam em PUBLICACAO-0.14.5.md quando concluídos. A configuração de hospedagem está em `render.yaml` e `codigo-fonte/DEPLOY-SAAS.md`.

## O que mudou em 0.14.5

A voz distingue preparação, captura real, processamento e retomada. **Ouvindo** só aparece depois de o navegador confirmar a captura de áudio. O modo de frase completa mantém a escuta através de pausas; uma frase já aplicada não força um novo encerramento. No modo rápido, aguarde o indicador Ouvindo antes de dizer a próxima carta. O limiar de 220 ms e a exigência de final verdadeiro permanecem.

Quando uma frase final está incompleta de forma identificável, a voz pede apenas o dado ausente, como naipe ou valor. O complemento vale por até 15 segundos no mesmo contexto; não substitui informações já ditas. Teclado, cancelamento, nova mão ou mudança de sessão invalidam a solicitação. Há também **Desfazer última entrada** no próprio painel.

No Multiway, **raise to / aumentar para** significa total da street; **raise by / aumentar em** significa incremento sobre a maior aposta atual. BB explícito usa o big blind da mesa. All-in só é registrado quando o stack e os limites legais permitem, sem reduzir silenciosamente o valor ao limite do pote. Isso registra uma ação observada e não amplia a cobertura matemática do estudo de EV.

**Teste voluntário da sua voz** oferece frases PT/EN em estado simulado, sem alterar a mão real. Requer início e consentimento explícitos, usa uma captura por vez e exporta resultados agregados somente quando solicitado. O THEIBS não grava áudio nem persiste transcrições. Corpus de frases, testes controlados e avaliação acústica humana são evidências distintas: os testes automatizados não demonstram as metas humanas de precisão e latência.

Método e resultados em `RELATORIO-QUALIDADE-VOZ-0.14.5.md`; publicação em `PUBLICACAO-0.14.5.md` depois de confirmada online.

## O que mudou em 0.14.4

A voz recebe **Ritmo da fala**. **Rápido · uma carta por vez** solicita ao navegador a conclusão quando uma carta completa e válida fica estável por 220 ms. Não aplica transcrição provisória: ainda exige resultado final validado. Diga a carta e aguarde ela entrar antes da próxima; formas curtas como “oito paus” e “eight clubs” são aceitas. A pausa de reinício própria da aplicação cai de 80 ms para a próxima tarefa do navegador nesse modo.

**Frase completa · cartas em sequência** mantém a captura do lote. Ações e valores de aposta aguardam a conclusão normal para não cortar expressões numéricas. **Segure para falar** segue o gesto e preserva essa intenção após reinícios do provedor. Disponibilidade do idioma no dispositivo é reutilizada por até 60 segundos; não baixa pacotes nem muda o modo de processamento automaticamente.

As medições separam resposta do reconhecedor e inserção da carta. O limiar de 220 ms é uma regra para solicitar conclusão, não promessa de tempo total. Resultados comparativos e limites em `RELATORIO-VELOCIDADE-VOZ-0.14.4.md`; publicação em `PUBLICACAO-0.14.4.md` após verificação.

## O que mudou em 0.14.3

A entrada por voz do Analyze aplica automaticamente comandos completos em português ou inglês assim que o reconhecedor entrega um resultado final válido. “Oito de paus” insere 8♣ e avança a seleção, sem parar a escuta ou clicar em Aplicar lote. Resultados provisórios aguardam a conclusão; replay do mesmo resultado não reaplica cartas. “Desfazer” corrige a última entrada. A revisão manual continua disponível desmarcando **Aplicar ao reconhecer e avançar para a próxima carta**.

No Multiway, ações e streets passam pelo ledger, com ator, turno, total e contexto validados. A escuta retoma somente após confirmação da transação; parar ou cancelar impede a retomada. Teclado, navegação, mudança de sessão e contexto invalidam fala pendente. Não grava áudio nem persiste transcrições. Precisão acústica humana ainda não foi medida; essa ausência de medição não desativa a função autorizada pelo usuário. Motor de equity/EV preservado.

## O que mudou em 0.14.2

O **Analyze** passa a responder se o **preço do CALL atual** é favorável dentro do modelo, sem exigir estudo de BET/RAISE nem perfis dos adversários. Mostra equity, equity necessária para pagar, margem pelo limite inferior e faixa de EV. Favorável exige limite inferior positivo; desfavorável exige limite superior negativo; faixa que toca zero fica incerta. CHECK sem custo é neutro. Prévia, custos desconhecidos e CALL sem modelo válido não ganham sinal verde.

A leitura usa o resultado já calculado, sem uma nova simulação. Coach e snapshots recebem o mesmo indicador. Alterar cartas, preço ou premissas invalida o sinal anterior. As proteções do Multiway e o contrato de comparação entre todas as ações continuam ativos; uma leitura favorável do CALL não declara que CALL supera BET/RAISE.

É necessário informar o pote e o valor real para pagar para interpretar o preço. Sem isso, cartas e número de adversários permitem estudar equity, mas não certificar se vale pagar. A leitura supõe nenhuma aposta futura e permanece condicionada aos ranges/custos informados. Publicação 0.14.2 confirmada em `PUBLICACAO-0.14.2.md`.

## O que mudou em 0.14.1

No **Analyze web**, abra **Entrada por voz · PT / EN** para selecionar português ou inglês. A fala produz uma proposta de lote para revisar e confirmar; o reconhecimento acústico ainda não foi homologado. `Dama/queen` é Q, `dez/ten` é T; duplicatas, frases ambíguas e resultados obsoletos não alteram a mesa. Teclado e mouse continuam disponíveis.

**Adversários · opcional** permite aplicar range ou chance de call somente ao assento escolhido. Sem preenchimento, todos usam mãos legais aleatórias e nenhuma resposta comportamental é presumida. Não é necessário observar ou preencher adversários para usar a análise básica. Taxas incompletas limitam o estudo da aposta; não completamos os outros jogadores com 50%.

Em **Configurar mesa**, informe custos fixos ou a tabela percentual com cap; custo desconhecido continua distinto de zero. O motor trata a opção do BB após limp e explica a razão de uma abstenção. **Retorno por 100 mãos** apresenta o experimento sintético separado da mão atual: média/intervalo, comparação, percentual sobre capital de referência e chance de bloco positivo. Reposição ilimitada de stack não equivale a banca finita.

A enumeração exata foi otimizada com paridade de resultados. Os testes desta entrega rodam em ambiente de desenvolvimento; o produto de destino é a webapp hospedada. Hospedagem, reconhecimento acústico humano e lucro contra jogadores reais continuam fora da evidência aprovada.

## Base preservada da 0.13.0

- Resultados identificados por versão, entradas e saída; recomendações acionáveis exigem comparação completa e separação da incerteza nas hipóteses avaliadas. Adversários ausentes, preview, comparação parcial e ajuste heurístico não recebem esse status.
- Prévia curta identificada e cálculo final separados; cache inclui entradas econômicas, modelo e versão. O cache não conta como novas simulações.
- Cartas renderizadas sem recriar o baralho a cada tecla; foco, atalhos, colagem, desfazer e validação continuam disponíveis.
- Gráficos guardam proveniência e invalidam pontos incompatíveis após alterações. Histórico separa coortes e resultados desconhecidos de zero.
- Coach entrega fatos calculados primeiro. Seleção opcional de explicações pelo Ollama pode ser cancelada e não bloqueia a próxima ação depois do cálculo.
- Histórico agregado em worker, com cache limitado; recuperação de casos possui limite de leitura. Ranges conjuntos raros têm fallback exato limitado e falhas explícitas.

## Como interpretar

Equity estima a fração do pote dentro do modelo. O EV exibido é incremental a partir da decisão; não é uma previsão do lucro de toda a estratégia. `recommendation.action` só existe quando o contrato estruturado permite uma preferência condicional. `recommendedAction` legado pode incluir um ajuste heurístico e não deve ser usado sozinho como ordem de ação. O líder pontual está em `recommendation.pointLeader`.

Uma entrada de rake vazia significa custo desconhecido. Zero precisa ser explicitamente informado ou assumido. Um resultado `No clear choice` é uma abstenção deliberada quando falta suporte para indicar uma ação. Os detalhes continuam permitindo estudar os números e suas premissas.

A ferramenta não é solver GTO, não demonstrou lucro contra jogadores reais e não treina pesos automaticamente ao guardar mãos. O piloto de políticas completas é exploratório. A validação de cálculo não substitui calibração de ranges, política futura, custos e adversários.

## Evidências e continuidade

- [Qualidade da voz 0.14.5](RELATORIO-QUALIDADE-VOZ-0.14.5.md): continuidade, interpretação, testes e limites da avaliação acústica.
- [Entrega 0.14.2](RELATORIO-CONTINUAR-0.14.2.md): indicador do CALL atual, casos reais do motor e validação.
- [Entrega 0.14.1](RELATORIO-VALIDACAO-0.14.1.md): resultados econômicos, voz, tempos e pendências anteriores.
- [Relatório anterior](RELATORIO-VALIDACAO-0.13.0.md): baseline histórico preservado.
- [Protocolo de benefício estratégico e aprendizagem](PROTOCOLO-BENEFICIO-ESTRATEGICO.md): o que falta para testar vantagem e aprendizagem de forma independente.
- [Histórico](HISTORICO_VERSOES.md) e [método](METODO-VALIDACAO-E-APRENDIZAGEM.md).

Os testes de desenvolvimento usam loopback e arquivos temporários; o produto usa hospedagem e autenticação. A comprovação da publicação fica em seu registro separado. A validação técnica e sintética não comprova reconhecimento humano, cobrança, lucro ou aprendizagem.
