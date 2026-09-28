# THEIBS 0.14.4 — velocidade da entrada por voz

Escopo: Analyze da webapp. O modo **Rápido · uma carta por vez** solicita a conclusão do reconhecimento assim que uma única carta válida permanece estável por 220 ms. A inserção continua dependendo de um resultado final verdadeiro do reconhecedor. Uma transcrição parcial, sozinha, nunca modifica as cartas.

## Uso e implementação

- Selecione português ou inglês, mantenha aplicação automática e use o ritmo Rápido. Diga, por exemplo, “oito paus” ou “eight clubs”; espere a carta aparecer antes da próxima.
- Para falar várias cartas seguidas, escolha **Frase completa · cartas em sequência**. Esse modo preserva o lote sem encerramento antecipado.
- A antecipação não corta ações e valores Multiway, comandos incompletos/ambíguos, revisão manual ou o botão Segure para falar. A intenção de manter o botão pressionado sobrevive aos reinícios do provedor.
- Edição de cartas, troca de contexto, resultado revisado, cancelamento e mudança de sessão invalidam a antecipação pendente. Duplicatas, cartas ilegais e contexto incompatível continuam bloqueados. O comando de desfazer permanece disponível.
- Reinício automático em modo rápido usa a próxima tarefa do navegador, removendo a espera deliberada de 80 ms. A disponibilidade de idioma no dispositivo é reaproveitada por 60 s desde a consulta bem-sucedida, sem estender o prazo a cada uso.
- A aplicação não instala modelos, não troca silenciosamente o provedor e não persiste áudio nem transcrições. Métricas de tempo não incluem o texto reconhecido.

O pedido de conclusão usa [SpeechRecognition.stop](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop), que solicita ao navegador um resultado para o áudio capturado. O provedor ainda pode demorar ou não produzir um final; o aplicativo não inventa um resultado nesses casos.

## Resultado medido

Reconhecedor nativo do Chrome 154.0.8037.57, serviço do navegador, AudioTrack explícito com WAV sintético. Mesmos arquivos e navegador em cada par, duas repetições por cenário/idioma/versão. Dezesseis exemplos ao todo: oito com 0.14.3 e oito com 0.14.4, **16/16 exatos**, sem erros de página.

| Cenário | 0.14.3 | 0.14.4 | Resultado |
|---|---:|---:|---|
| Uma carta, português | 1.362 ms | 916 ms | Redução observada de 32,8% |
| Uma carta, inglês | 852 ms | 482 ms | Redução observada de 43,4% |
| Duas cartas, português | 1.289 ms | 1.229 ms | Ambas preservadas |
| Duas cartas, inglês | 811 ms | 798 ms | Ambas preservadas |

Tempos são médias entre o fim estimado da fala na waveform e a alteração das cartas; não são duração total de captura. Final verdadeiro até inserção: média de 4,15 ms em português e 4,75 ms em inglês nos exemplos individuais da nova versão. A pequena variação dos lotes não é atribuída à melhoria.

Limites: amostra pequena, ordem baseline antes de candidato, sem randomização, IC ou SLA. Não houve microfone físico, falante humano, ambiente ruidoso ou medição acústica da hospedagem. O modo no dispositivo não foi instalado nem medido. Esses números não garantem a mesma latência ou precisão no aparelho do usuário. Os componentes do candidato foram congelados antes de um ajuste posterior no TTL do cache de disponibilidade; somente esse cache, fora do caminho Browser/AudioTrack medido, difere da versão final. A integração final foi verificada separadamente.

## Validação executada

- **379/379 testes gerais PASS**, execução final isolada (`unit-isolated-final.txt`). Dez testes novos cobrem o temporizador, candidato elegível e invalidação.
- **100 verificações de navegador PASS**: 42 de aplicação automática, 26 do novo modo rápido, 26 de revisão manual e seis de ciclo de sessão. ASR por eventos controlados e conta fictícia; não equivalem a avaliação acústica humana.
- As 42 automáticas e 26 rápidas foram executadas com as fontes finais estáveis; a bateria manual de 26 antecedeu os últimos ajustes específicos de hold/reinício e TTL. Hold após reinício está coberto na bateria rápida final. Os seis cenários de sessão usaram o runtime final.
- As primeiras execuções gerais tiveram 378/379, com timeout de 8 s em treinamento sob concorrência de baterias. O teste isolado passou 4/4 e a suíte completa final passou 379/379, sem alterar motor, autenticação ou limites de tempo do produto.
- A primeira tentativa do teste de expiração consumia os 2,2 s do token fictício antes de abrir o painel sob carga. A fixture foi corrigida para agendar a expiração real somente após iniciar captura; os seis cenários passaram. As tentativas anteriores ficam preservadas.
- **48 arquivos do motor e servidor preservados byte a byte** em relação à 0.14.3. Esta entrega não muda cálculos de equity/EV nem estabelece lucro esperado.

Evidências em `validacao/voice-speed-2026-09-28/`: `comparison.json`, `METODO.md`, `RESULTADOS.md`, `baseline-final/provider-speed.json`, `candidate-final/provider-speed.json`, `auto-regression-final/browser-qa.json`, `fast-browser-release/browser-qa.json`, `manual-regression-attempt1/browser-qa.json`, `session-release/session-qa.json` e `unit-isolated-final.txt`.

SHA256 da comparação: `14aa0bac907651cd944776aa0ee9fdb57fc5897c0f8c51a5e2debeb2a5c33dfe`. Scripts de reprodução estão em `codigo-fonte/scripts/`. A confirmação da publicação é registrada separadamente em `PUBLICACAO-0.14.4.md`; PASS local não é tratado como confirmação de produção.
