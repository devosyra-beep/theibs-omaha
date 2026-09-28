# Analyze web — leitura do CALL atual — 0.14.2

Data: 28/09/2026. **Implementado e validado em QA local da webapp. Não publicado.** A entrega ao jogador continua sendo exclusivamente o site hospedado.

## O que o jogador recebe

O Analyze passa a responder **se o preço para pagar agora é favorável dentro do modelo**, mesmo sem modelar BET/RAISE. Não exige perfis comportamentais dos adversários: as cartas deles continuam uniformes por padrão; uma variável aplicada a um assento continua restrita àquele adversário.

| Sinal | Critério |
|---|---|
| Preço favorável para pagar | Todo o intervalo válido de EV do CALL está acima de zero, após os custos informados. |
| Preço desfavorável para pagar | Todo o intervalo válido está abaixo de zero. |
| Ainda sem margem para concluir | O intervalo toca zero, é inconsistente ou não está disponível. |
| CHECK sem pagar | CHECK legal com custo imediato zero; sinal neutro. |
| Sem avaliação / calculando | Prévia, dados incompletos, custo desconhecido ou CALL sem modelo válido. |

O painel mostra equity, equity necessária, valor para pagar, margem em pontos percentuais pelo limite inferior e faixa de EV. Reaproveita a leitura existente de mão/nuts e avisa quando novas cartas ou apostas podem mudar a decisão. O coach responde a perguntas como “posso continuar?” e “vale seguir?” usando o mesmo resultado. Os snapshots guardam o indicador com sua versão e identidade; entradas alteradas invalidam o sinal anterior.

O indicador **não escolhe a melhor ação entre CALL, BET e RAISE**. O contrato de comparação completa continua separado e pode estar incompleto enquanto o preço do CALL já tem uma leitura válida. Isso remove uma fonte de confusão da interface, sem afrouxar o critério matemático nem aumentar artificialmente a frequência de EV positivo.

## O que significa segurança nesta leitura

Cartas e quantidade de adversários permitem estimar equity condicionada ao modelo. Para avaliar o preço de continuar, também são necessários pote, valor real para pagar e custos da mesa. Valores iniciais da interface devem ser ajustados à mão estudada.

No CALL simples, o limiar é `valor para pagar / pote líquido após o CALL`. O EV é `equity × pote líquido − valor para pagar`. O cálculo já existente fornece ambos; o indicador apenas lê esses resultados. O limiar não é calculado quando o pote líquido é zero. Em cenários com respostas condicionais, a ferramenta usa a faixa do cenário e não cria uma equity necessária fictícia a partir da equity global.

Uma faixa amostral de 95% não representa 95% de chance de ganhar a mão ou de obter lucro. Ela não incorpora erro do modelo de adversários. Faixas condicionais de cenários recebem rótulo diferente. Uma conta exata também continua condicionada às entradas e ao modelo. A leitura presume nenhuma aposta futura; em streets anteriores ao river isso é uma limitação concreta.

Referência conceitual: [PokerStars Learn — pot odds](https://www.pokerstars.com/poker/learn/lesson/pot-odds/). Os resultados abaixo vêm do código executado nesta entrega.

## Validação executada

| Evidência | Resultado |
|---|---|
| Bateria automatizada completa | **361/361 PASS**, incluindo 14 novos testes do indicador. |
| Paridade com fonte congelada 0.14.1 | **57/57 PASS**; mesmos resultados numéricos e recomendações do motor. |
| Navegador Edge com HTTP real — indicador | **7/7 PASS**. |
| Navegador — entrada incompleta e feedback | **6/6 PASS**. |
| Navegador — fluxo, restauração, coach e navegação | **8/8 PASS**. |

Casos reais do motor verificaram preços favoráveis, negativos e que tocam zero; mesmos cards com preço diferente; rake percentual/cap; equity exata; custo ausente; cobertura incompleta; respostas condicionais; bloqueios Multiway antes/depois do cálculo; prévia/cache e identidade do coach. O verde nunca vem apenas da estimativa pontual.

Exemplo determinístico, sem rake: PLO5, herói `As Ah Ks Kh Qd`, flop `2c 3d 4h`, um adversário uniforme, pote 12, 500 simulações FIXED, seed 42. Equity calculada: **43%**.

| Valor para pagar | Equity necessária | EV do CALL | Sinal |
|---|---:|---:|---|
| 1 ficha | 7,69% | +4,59 fichas | Favorável; intervalo inteiro positivo. |
| 9,052631578947368 fichas | 43% | Aproximadamente zero | Incerto; intervalo atravessa zero. |
| 60 fichas | 83,33% | −29,04 fichas | Desfavorável; intervalo inteiro negativo. |

São fixtures para verificar a implementação, não uma amostra representativa de partidas nem um experimento de lucratividade.

No navegador, o indicador funcionou com comparação de RAISE ainda incompleta; dados antigos sumiram ao mudar preço/cartas; CHECK sem custo permaneceu neutro; custos ausentes direcionaram ao campo correto; a prévia não mostrou verde; coach e snapshot preservaram a mesma avaliação; o resultado restaurado manteve a identidade. Layouts 1366, 390 e 320 px passaram sem overflow horizontal.

A primeira tentativa do novo harness falhou porque selecionava o último snapshot inserido, que pertencia a outra street. O harness foi corrigido para selecionar a identidade da análise atual. A falha foi preservada em `browser-attempt1`; a execução seguinte passou. Nenhum ajuste de cálculo foi necessário para esse caso.

## Velocidade e qualidade

A paridade comparou PLO4/PLO5/PLO6, pré-flop/flop/turn/river, HU e cinco adversários uniformes, mão conhecida, rake percentual/cap, CHECK, respostas condicionais e range individual. O resultado completo foi comparado após excluir somente versão, identificadores/hashes, timestamp, novo indicador e medidas de tempo. Equity, EV, limites, amostras, legalidade e recomendações coincidiram em 57/57 fixtures. O orçamento Monte Carlo foi 500 FIXED/seed42, preservando a enumeração exata quando aplicável. A fonte0.14.1 e suas evidências permaneceram intactas.

O indicador não chama outra simulação, não reduz amostras e não altera a condição de parada do motor. O navegador confirmou uma única requisição no modo 500 amostras e as duas requisições já previstas no fluxo prévia/final. O coach e os gráficos continuam reutilizando a análise existente.

Um caso do harness de integração registrou 182,7 ms até o segundo frame e 28,9 ms de HTTP no cálculo final. É uma observação de QA em loopback, **não benchmark nem previsão de latência da hospedagem**. A validação de latência online continua pendente da publicação autorizada.

## Escopo técnico e evidências

- `codigo-fonte/src/continuation-assessment.js`: interpretação dos limites do CALL; enumeração/simulação preservadas.
- `codigo-fonte/src/analysis-contract.js` e `server.js`: indicador assinado após guards do Multiway e definição de prévia/final.
- `codigo-fonte/public/continuation-view.js`, `app.js`, `dashboard.css`: apresentação, margens e invalidação.
- `codigo-fonte/src/coach.js` e `public/analysis-snapshots.js`: consistência do coach e snapshots.
- `codigo-fonte/test/continuation-assessment.test.cjs`: 14 testes novos.
- `validacao/continuar-2026-09-28/numeric-parity.json`: comparação reproduzível com a fonte0.14.1.
- `validacao/continuar-2026-09-28/tests-final.tap`, `browser-attempt2/report.json`, `analyze-feedback/report.json`, `reliability/qa-reliability.json`: evidência desta execução.

O experimento econômico preservado continua na versão 0.14.0; não foi reexecutado nesta entrega. A voz PT/EN permanece com as evidências e pendências acústicas descritas no relatório 0.14.1. Esta mudança não certifica lucro, aprendizagem humana nem reconhecimento de microfone em produção.
