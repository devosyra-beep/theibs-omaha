# THEIBS — laboratório Omaha

Versão do código: **0.14.2**. Análise e treino de Omaha High PLO4, PLO5 e PLO6, com equity, EV condicionado às premissas, coach, entrada de cartas e histórico.

## Produto e validação

A única entrega ao jogador é a **webapp hospedada**, acessada pelo navegador. Não exige aplicativo instalado, Node.js, Electron, Ollama nem serviço no computador do jogador. A voz é capturada no navegador com permissão explícita; cálculo, coach e persistência usam a API hospedada.

Os comandos de Node.js nos relatórios são ferramentas de desenvolvimento e QA do mesmo código antes da publicação. `LOCAL_EXECUTED` identifica o ambiente de teste, não uma segunda versão do produto. Nesta rodada, o usuário autorizou validar o código antes de hospedar; a produção existente permanece separada até a publicação. A configuração de hospedagem está em `render.yaml` e `codigo-fonte/DEPLOY-SAAS.md`.

## O que mudou em 0.14.2

O **Analyze** passa a responder se o **preço do CALL atual** é favorável dentro do modelo, sem exigir estudo de BET/RAISE nem perfis dos adversários. Mostra equity, equity necessária para pagar, margem pelo limite inferior e faixa de EV. Favorável exige limite inferior positivo; desfavorável exige limite superior negativo; faixa que toca zero fica incerta. CHECK sem custo é neutro. Prévia, custos desconhecidos e CALL sem modelo válido não ganham sinal verde.

A leitura usa o resultado já calculado, sem uma nova simulação. Coach e snapshots recebem o mesmo indicador. Alterar cartas, preço ou premissas invalida o sinal anterior. As proteções do Multiway e o contrato de comparação entre todas as ações continuam ativos; uma leitura favorável do CALL não declara que CALL supera BET/RAISE.

É necessário informar o pote e o valor real para pagar para interpretar o preço. Sem isso, cartas e número de adversários permitem estudar equity, mas não certificar se vale pagar. A leitura supõe nenhuma aposta futura e permanece condicionada aos ranges/custos informados. A versão foi validada em QA; ainda não foi publicada.

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

- [Entrega 0.14.2](RELATORIO-CONTINUAR-0.14.2.md): indicador do CALL atual, casos reais do motor e validação.
- [Entrega 0.14.1](RELATORIO-VALIDACAO-0.14.1.md): resultados econômicos, voz, tempos e pendências anteriores.
- [Relatório anterior](RELATORIO-VALIDACAO-0.13.0.md): baseline histórico preservado.
- [Protocolo de benefício estratégico e aprendizagem](PROTOCOLO-BENEFICIO-ESTRATEGICO.md): o que falta para testar vantagem e aprendizagem de forma independente.
- [Histórico](HISTORICO_VERSOES.md) e [método](METODO-VALIDACAO-E-APRENDIZAGEM.md).

Os testes desta entrega usaram arquivos temporários, sem alterar histórico/configuração pessoal. Os testes usam loopback e arquivos temporários; o produto usa hospedagem e autenticação. Produção, login, cobrança, modelos reais e novo pacote Electron não foram homologados nesta rodada. Nenhuma publicação foi feita.
