# THEIBS 0.4.0 — cálculo, treinador e validação

26/09/2026. Aplicativo: `THEIBS-0.3.0-Windows/THEIBS.exe`. A pasta mantém seu nome; o título deve mostrar 0.4.0. Código editável em `codigo-fonte`.

## O que está ligado

- PLO4, PLO5 e PLO6: avaliação com exatamente duas cartas privadas e três comunitárias, equity por enumeração ou Monte Carlo e EV nas ações com premissas suficientes.
- Analisar: escolha a quantidade de adversários diretamente acima da mesa. O total inclui você. Não é necessário registrar call, bet ou fold; F deixa de registrar Fold. Os registros antigos permanecem como histórico, sem controlar a tela.
- Treinar: um adversário simulado, dois jogadores. Suas escolhas fazem parte do exercício; o adversário responde automaticamente. Ele pode desistir, pagar, aumentar, apostar ou dar check, conforme a situação. A política usa somente suas próprias cartas e o board, sem consultar cartas ocultas do herói. É uma heurística de estudo, não um jogador treinado ou um solver.
- Treinador local: explica mão formada, nuts no board atual, cartas que melhoram na próxima carta, draws de flush/sequência, bloqueadores de ás de flush, equity, pot odds e EV disponível. Perguntas fora dessas análises recebem uma indicação de limite.
- Histórico e tendências: decisões e dúvidas ficam registradas. Frequências do simulador não são tendências de jogadores reais. Estatísticas da nova política são separadas da versão antiga que sempre pagava.

## Limites que continuam explícitos

O modelo-base distribui mãos aleatórias aos adversários; não ajusta automaticamente os ranges à sequência de apostas. Mão ou range explícito pode refinar a análise. O catálogo inicial de perfis de range continua específico de PLO5; isso não impede calcular PLO4/PLO6 com o modelo aleatório ou mãos compatíveis.

O EV padrão considera showdown sem apostas futuras. EV de bet/raise exige premissas de resposta e continuação; quando faltam, fica indisponível. Recomendações heurísticas não provam a jogada de maior EV. Não há árvore estratégica completa, certificação GTO ou calibração contra um solver externo em nenhuma variante.

Cartas que completam uma sequência ou flush não são automaticamente outs limpos: o adversário pode continuar ganhando. A contagem apresentada é para a próxima carta, não para duas cartas até o river. Bloqueadores ainda cobrem o caso de ás do naipe relevante; não há classificação completa de todos os blockers. Nuts no board atual não garantem vitória em streets futuras.

## Llama e Ollama

Llama é uma família de modelos de linguagem. Ollama é um programa que pode executar modelos localmente. A integração do THEIBS usa a API local de chat do Ollama, configurada por `THEIBS_LLM_PROVIDER=ollama`, `THEIBS_LLM_MODEL` e, opcionalmente, `THEIBS_LLM_URL` (padrão `http://127.0.0.1:11434`). Aceita apenas endpoint HTTP de loopback.

Nesta verificação, não havia serviço acessível em 11434, processo Ollama ou configuração THEIBS_LLM ativa. Não foi instalado ou baixado um modelo. As explicações calculadas locais funcionam sem ele. O texto de um LLM conectado continua sendo explicação não validada como cálculo: o modelo não é a fonte dos números e pode errar a redação. Falha de conexão usa a resposta local.

Documentação oficial: https://docs.ollama.com/api/introduction

## Aprendizagem: situação atual e evolução

Hoje existe memória de decisões/dúvidas e recuperação simples de casos semelhantes. Isso não atualiza pesos do Llama, não treina a política adversária e não modifica as fórmulas. Jogar milhares de mãos, por si só, não ensina o sistema.

Método proposto para melhorar:

1. Registrar variante, cartas conhecidas, posição, preço, pote, stacks, modelo de range, semente, versão do motor/política, resultado e origem do dado.
2. Curar os dados: remover duplicatas, inconsistências e vazamento de informação futura. Separar simulação, histórico próprio e referência revisada.
3. Criar conjuntos independentes de desenvolvimento, validação e teste reservado (por exemplo, 60/20/20). Agrupar pela mão/cenário para não deixar versões do mesmo board nos dois lados da divisão. Fixar o teste antes de ajustar parâmetros.
4. Ajustar uma camada por vez: ranges, frequências da política, recomendação estratégica ou redação do treinador. Fórmulas e regras permanecem cobertas por testes determinísticos.
5. Comparar com referência externa adequada à variante e às mesmas premissas. Avaliar arrependimento de EV somente quando os EVs das ações forem comparáveis. Resultado de uma mão e concordância com a própria heurística não são rótulos de decisão ótima.
6. Aprovar uma nova versão somente sem regressões de regras, com resultados no teste reservado e métricas por variante, street, número de adversários e classe de mão. Manter rollback e transformar cada bug em caso fixo de regressão.

Fine-tuning de linguagem seria uma etapa opcional posterior para ensinar explicações e formato. Não substitui um avaliador correto nem corrige um range mal especificado.

## Milhares de quê?

**Casos de teste** são situações diferentes, com resultados esperados ou invariantes. **Amostras Monte Carlo** são distribuições aleatórias usadas dentro de um cálculo. **Mãos de aprendizagem** são dados curados para ajustar parâmetros. Essas contagens não são intercambiáveis.

Sim, milhares de casos fazem sentido. A cobertura importa: empates, wheel, dois naipes, cartas repetidas, exatamente 2+3, limites de tamanho de aposta, all-in, devolução de excesso, várias posições e todas as variantes. Repetir o mesmo caso milhares de vezes não cobre esses riscos.

No Monte Carlo, quatro vezes mais amostras reduz aproximadamente pela metade o erro amostral, mantendo o modelo. Não reduz o erro causado por um range irreal ou premissas erradas de apostas futuras.

## Evidência executada localmente

Relatório: `validacao/engine-method-report.json`. O ensaio foi iniciado com metadado de versão 0.3.1, já sobre o código candidato desta atualização, antes de trocar o número para 0.4.0. O relatório original foi preservado. Não é evidência de homologação externa.

| Camada | Execução | Resultado |
|---|---:|---|
| Ranking de cinco cartas | 10.000 comparações com implementação de referência separada | PASS |
| Avaliação Omaha | 900 cenários, 300 por variante; 2.700 verificações incluindo invariância por ordem e naipes | PASS |
| Simulador completo | 900 mãos, 300 por variante; legalidade, término e conservação de fichas | PASS |
| Equity amostral | 90 cenários de turn com mão adversária conhecida, 1.000 amostras por caso, comparação com enumeração exata | PASS |
| Censo do núcleo de cinco cartas | Todas as 2.598.960 combinações, frequências por categoria | PASS |

Nos 90 cenários de equity: erro quadrático médio de 1,13 ponto percentual, viés médio de −0,0304 ponto percentual e cobertura de 95,6% do intervalo nominal de 95%. Esses resultados são desse conjunto fixo; não demonstram calibração universal, multiway ou qualidade de ranges.

O censo de 2.598.960 combinações valida a distribuição de categorias do núcleo de cinco cartas. Não equivale a enumerar todos os estados possíveis de Omaha. A implementação de referência foi escrita separadamente neste projeto; falta comparação com referência externa certificada.

Testes focados: `node --test codigo-fonte/test/training-intelligence.test.cjs codigo-fonte/test/keyboard-regression.test.cjs codigo-fonte/test/hand-flow.test.cjs`. Incluem 315 outras mãos simuladas, ausência de vazamento de cartas, respostas específicas do treinador, ações inválidas sem mutação e regressões matemáticas do registro interno.

Ensaio reproduzível: `node codigo-fonte/scripts/validate-engine.cjs --exhaustive-five`.

Interface: `codigo-fonte/scripts/qa-intelligence.cjs` (Edge HTTP) e o mesmo script com `--electron` (pacote Windows). Usam dados temporários, sem modificar o histórico real. Relatórios e capturas em `validacao/intelligence-v0.4.0/`. O teste antigo `qa-workflow.cjs` documenta o fluxo manual removido da 0.3.0 e não é a suíte vigente.

## Próximos conjuntos de validação

Resultado final da versão 0.4.0: 27 testes focados e 8 grupos de integração passaram, estes tanto em Edge quanto no Electron Windows. As telas Analisar/Treinar foram verificadas em 1440×900, 1366×768 e 1024×660, sem rolagem da página. O teste inclui escolher dois adversários e obter equity com esse mesmo número em PLO4 e PLO6.

- Casos numéricos exatos multiway, ranges ponderados e colisões de cartas; separar testes baratos de regressão dos ensaios longos.
- Mais sementes e cenários reservados para medir intervalos e erro de equity por street e variante, sem ajustar limites depois de ver o resultado.
- Base estratégica revisada externamente, com premissas consistentes e legalidade de ações; validar decisões por EV, não por lucro de curto prazo.
- Perguntas do treinador com fatos esperados, números proibidos, cartas ocultas que nunca podem aparecer e limites que devem ser admitidos. Repetir com cada modelo LLM conectado antes de liberar seu uso.
- Testes de interface com preenchimento/limpeza/troca de variantes, adversários e restauração, além de acessibilidade e tamanhos de tela.
