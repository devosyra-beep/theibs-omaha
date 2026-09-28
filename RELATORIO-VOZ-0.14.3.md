# THEIBS 0.14.3 — aplicação automática da voz no Analyze

O caso reportado exibia “oito de paus” mas exigia encerrar a escuta e confirmar um lote. A entrada agora aplica cada comando final válido, avança a seleção e permite continuar falando. A opção de aplicação automática inicia marcada. A revisão manual continua disponível ao desmarcá-la.

## Comportamento

- Português e inglês: cartas, destinos, seleção, correção, remoção, desfazer e ações observadas no Multiway.
- Somente resultados finais e completos são aplicados. Interims aguardam o provedor; fim de fala solicita conclusão, sem transformar um texto provisório em carta por timeout.
- Reenvio do mesmo índice final não reaplica; alteração, remoção ou downgrade de um final encerra a escuta preservando entradas já confirmadas. Novo índice válido segue para a próxima posição.
- Teclado, seleção, preço, navegação ou sessão alterada invalidam fala pendente. Controles de carta permanecem bloqueados durante a transação Multiway. Parar, cancelar e Escape impedem retomada da captura durante uma transação.
- Multiway valida ator, turno, valor total, estado e street pelo ledger. A captura é suspensa durante a transação HTTP e retomada somente após confirmação no contexto esperado. Não envia apostas a mesas externas.
- Feedback direto com carta e naipe; nenhuma transcrição ou áudio persistido. Processamento local exige disponibilidade do idioma; processamento pelo serviço do navegador exige consentimento específico.

## Validação executada

- 369/369 testes gerais PASS, incluindo os novos testes de streaming do parser/sessão.
- 42/42 cenários de aplicação automática em Edge PASS; eventos ASR controlados e servidor HTTP real em desenvolvimento. Oito de paus => 8♣ + próximo slot sem parar/aplicar; PT/EN PLO4/5/6; replay; interims; lote; ambiguidades; undo; contexto; reinício natural; cancelamento na janela de retomada; payload real do Analyze; cache; workspace; ações e board Multiway; retorno HTTP atrasado.
- 26/26 cenários da revisão manual PASS, selecionando explicitamente esse modo.
- 6/6 cenários de sessão PASS em harness com conta fictícia: expiração, 401, rotação saudável e troca/remoção de sessão.
- Zero erros de página no harness final; fontes permaneceram estáveis durante a execução. Os 48 arquivos do motor e servidor são idênticos byte a byte ao pacote 0.14.2.

Em 46 eventos controlados, do resultado final ao segundo frame: mediana 28,6 ms, P95 80,9 ms e máximo 244,1 ms. Parsing: mediana 0,2 ms e P95 0,5 ms. A amostra mistura cartas locais e transações de ledger. Não mede tempo de fala/reconhecimento acústico nem latência de hospedagem e não é SLA.

As tentativas anteriores foram preservadas: a segunda identificou uma corrida do helper de teste na retomada de 80 ms; a terceira tentou clicar cartas intencionalmente inertes durante HTTP. O harness final aguarda uma instância efetivamente iniciada e comprova o bloqueio dos controles durante a transação. Nenhum desses dois ajustes alterou o produto para acomodar um teste.

## Limites da evidência

Acústica humana/microfone/provedor nesta rodada: NOT_EXECUTED. A ausência dessa medição não desativa a funcionalidade solicitada: aplicação automática está habilitada, com comandos finais validados. O produto de destino é exclusivamente a webapp hospedada; testes locais são QA do código. Verificação da publicação fica em PUBLICACAO-0.14.3.md após o deploy. Este ajuste não modifica ou reclassifica evidência financeira/estratégica.

Evidências: `validacao/voice-auto-2026-09-28/unit-output.txt`, `browser-final/browser-qa.json`, `browser-final/eight-of-clubs-auto.png`, `manual-attempt1/browser-qa.json` e `session-attempt1/session-qa.json` dentro da mesma pasta de validação.
