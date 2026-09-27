# THEIBS SaaS — acesso público seguro

## URL provisória no Render

O `render.yaml` na raiz prepara um **Web Service gratuito**, com a landing em `/` e o app em `/app`. Serviço publicado e verificado em **https://theibs-omaha.onrender.com**. Não foi contratado plano pago nem domínio.

1. Entre no Render, conecte somente o repositório privado `devosyra-beep/theibs-omaha` e use **New → Blueprint** com o `render.yaml`. Confira que o plano é **Free**.
2. Preencha `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` no painel, usando o projeto separado do THEIBS. Aplique a migração e habilite Google Auth nesse projeto.
3. O servidor usa `PORT` e `RENDER_EXTERNAL_URL` automaticamente. Depois de obter a URL, adicione `https://NOME.onrender.com/app` aos redirects do Supabase e teste o login real.
4. `/healthz` verifica que o servidor responde. Isso não comprova Google, banco ou pagamentos: confirme esses fluxos separadamente.

O plano Free pausa após inatividade e **perde arquivos de histórico/rascunhos em reinícios ou novos deploys**. Serve para validar a primeira URL; não é a versão comercial pronta. Mãos em andamento ficam na memória e encerram em qualquer reinício, mesmo com disco. A capacidade do motor precisa ser medida no servidor contratado; o benchmark local não comprova 100 mil simulações/s na nuvem.

O blueprint não configura AbacatePay. Antes de cobrar, adicione um disco persistente em um plano compatível, aponte `THEIBS_USER_DATA_ROOT` para ele, confirme que os arquivos sobrevivem a reinícios e defina `THEIBS_STORAGE_PERSISTENT=true`. O servidor bloqueia a inicialização hospedada sem autenticação ou com cobrança configurada sem armazenamento declarado persistente. Não contrate recursos pagos sem confirmar o preço.

O runtime web usa apenas Node, sem instalar Electron/Chromium. O build verifica a sintaxe e inicia `node server.js`. Referências: [Render Node](https://render.com/docs/deploy-node-express-app), [plano gratuito](https://render.com/docs/free), [variáveis do Render](https://render.com/docs/environment-variables).

## Estado verificado em 26/09/2026

- Repositório privado `devosyra-beep/theibs-omaha`, branch `main`, recebeu a versão 0.12.2 e a preparação Render no commit `5e963e4`.
- **LIVE:** projeto Supabase `theibs-omaha`, organização THEIBS, referência `kevcwoeqgdwvfsvdpghe`. Tabelas `theibs_entitlements` e `theibs_payment_events` criadas com RLS ativa; consulta anônima via API retorna HTTP 401 para ambas. A leitura entre usuários autenticados ainda precisa de validação real.
- **LIVE:** Google Cloud tem projeto `theibs` e cliente `THEIBS Web - Supabase` criado, com callback `https://kevcwoeqgdwvfsvdpghe.supabase.co/auth/v1/callback`. O usuário prefere preencher as credenciais diretamente nos painéis. Não salvar segredos neste repositório.
- **LIVE:** Render `theibs-omaha`, serviço `srv-das7of8jo6nc73aisi6g`, Node Free (0.1 CPU / 512 MB), raiz `codigo-fonte`, comandos `node --check server.js` / `node server.js`, `/healthz`, auto-deploy desativado. Chaves preenchidas pelo usuário nos campos protegidos; prefixos conferidos sem revelar valores. Runtime não instala Electron/Chromium.
- **LIVE:** landing `/` → login `/app?login=1` → Google → laboratório `/app`. `devosyra@gmail.com` autenticado e reconhecido como acesso vitalício. Logout e reentrada verificados. `/healthz` retorna OK; `/api/access` sem sessão retorna 401; configuração pública exige login e contém somente a chave publicável. `ninjadevtester@gmail.com` está configurado para acesso vitalício, mas não teve login real testado nesta sessão.
- **LIVE:** Supabase Google habilitado, Site URL e redirect exato `https://theibs-omaha.onrender.com/app`. Google ainda está em Testing, com branding comercial pendente; a requisição pede somente `email profile`. A [exceção oficial para login básico](https://support.google.com/cloud/answer/15549945) dispensa lista de testadores e expiração de sete dias nesses escopos; não foi solicitado acesso a Gmail, Drive ou outros dados.
- **LIVE:** correção do flash no commit `c0fa305`: HTML inicia com laboratório `hidden inert`; a tela de acesso aparece antes de qualquer resposta da API. Sessão autorizada libera a interface. Cache PWA renovado.
- **LIVE:** primeira pergunta ao treinador no Render excedeu o prazo local de 8 segundos. Commit `2553d18` amplia somente o prazo do treino no Render para 60 segundos, mantendo as 256 simulações por alternativa e rejeitando resultados incompletos. Deploy confirmado como Live. Nova mão PLO5 e pergunta ao treinador concluíram: leitura em inglês, Fold EV 0.00, Raise to 4 EV -0.60 e aviso de faixas sobrepostas. Essa é uma validação funcional, não um benchmark; o plano gratuito ainda é lento para esse cálculo. Evidência: `validacao/public-training-verified.png`.
- **LIVE:** AbacatePay consultado na loja Osyra, em Sandbox; busca por THEIBS sem produto encontrado. A ativação de produção solicita validação documental. Não há checkout THEIBS validado nem cobrança habilitada no servidor.
- **LIVE:** Security Advisor sem erros, com dois avisos na função de automação `public.rls_auto_enable()` por permissão de execução. Revisar/restringir essa função antes de liberar a versão comercial. A função não foi criada pela migração THEIBS.
- **LOCAL:** 187 testes automatizados passaram após as proteções de chaves, tela inicial e prazo do worker (`validacao/hosting-final-tests.txt`). Não equivalem a homologação de pagamentos, isolamento entre dois usuários reais ou benchmark de 100 mil simulações/s na nuvem.

## Regra comercial

- Cadastro obrigatório por Supabase Auth.
- Três dias grátis contados no servidor desde `auth.users.created_at`.
- Compra única de **R$ 250,00** pela AbacatePay (PIX ou cartão).
- `checkout.completed` libera acesso permanente; reembolso, disputa ou chargeback suspendem o acesso.
- `devosyra@gmail.com`, `ninjadevtester@gmail.com` e os IDs/e-mails definidos em `THEIBS_LIFETIME_*` têm acesso vitalício sem cobrança.

## Serviços

1. Hospede este servidor Node em um serviço com processo persistente e HTTPS. A raiz `/` publica a landing page e `/app` contém o laboratório autenticado.
2. Crie um projeto Supabase separado do OSYRA e aplique `supabase/migrations/202609260001_theibs_access.sql`.
3. Ative Google Auth. Cadastre `https://SEU_DOMINIO/app` na allow list de redirects do Supabase.
4. Na AbacatePay, crie um produto avulso de 25000 centavos, sem ciclo, e informe o ID em `ABACATEPAY_PRODUCT_ID`.
5. Cadastre o webhook HTTPS:
   `https://SEU_DOMINIO/api/billing/webhook?webhookSecret=SEU_SECRET`
   Eventos: `checkout.completed`, `checkout.refunded`, `checkout.disputed` e `checkout.lost`.
6. Configure as variáveis de `.env.example` no cofre de segredos da hospedagem. Nunca envie a secret key do Supabase ou a API key da AbacatePay ao navegador.

## Validação antes da produção

- Use chaves de desenvolvimento da AbacatePay e confirme login, expiração do trial, compra, webhook repetido e reembolso.
- Rode `node --test "test/*.test.cjs"`.
- Confirme no Supabase Advisors que as tabelas continuam com RLS ativa.
- Troque para as chaves de produção somente após o fluxo completo passar no ambiente de teste.
