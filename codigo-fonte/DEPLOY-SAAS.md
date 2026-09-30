# THEIBS SaaS — acesso público seguro

## URL provisória no Render

O `render.yaml` na raiz prepara um **Web Service gratuito**, com a landing em `/` e o app em `/app`. Serviço publicado e verificado em **https://theibs-omaha.onrender.com**. Não foi contratado plano pago nem domínio.

1. Entre no Render, conecte somente o repositório privado `devosyra-beep/theibs-omaha` e use **New → Blueprint** com o `render.yaml`. Confira que o plano é **Free**.
2. Preencha `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` no painel, usando o projeto separado do THEIBS. Aplique a migração e habilite Google Auth nesse projeto.
3. O servidor usa `PORT` e `RENDER_EXTERNAL_URL` automaticamente. Depois de obter a URL, adicione `https://NOME.onrender.com/app` aos redirects do Supabase e teste o login real.
4. `/healthz` verifica que o servidor responde. Isso não comprova Google, banco ou pagamentos: confirme esses fluxos separadamente.

O plano Free pausa após inatividade e **perde arquivos de histórico/rascunhos em reinícios ou novos deploys**. Serve para validar a primeira URL; não é a versão comercial pronta. Mãos em andamento ficam na memória e encerram em qualquer reinício, mesmo com disco. A capacidade do motor precisa ser medida no servidor contratado; o benchmark local não comprova 100 mil simulações/s na nuvem.

O blueprint não configura AbacatePay. Antes de cobrar, adicione armazenamento persistente em um plano compatível, aponte `THEIBS_USER_DATA_ROOT` para ele, confirme que os arquivos sobrevivem a reinícios e defina `THEIBS_STORAGE_PERSISTENT=true`. As cobranças e direitos de acesso também exigem as migrações Supabase abaixo. O servidor bloqueia a inicialização hospedada sem autenticação ou com cobrança configurada sem armazenamento declarado persistente. Não contrate recursos pagos sem confirmar o preço.

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
- **LIVE:** AbacatePay consultado na loja Osyra, em Sandbox. Em 30/09/2026 foi criado o produto de teste `prod_xkAP3XK06kxXnEcqM0zXKYWK` (THEIBS Lifetime Access — Sandbox), ativo, compra única de R$ 250,00. Nenhuma cobrança foi criada. A ativação de produção solicita validação documental; não há checkout THEIBS validado nem cobrança habilitada no servidor.
- **LIVE:** Security Advisor sem erros, com dois avisos na função de automação `public.rls_auto_enable()` por permissão de execução. Revisar/restringir essa função antes de liberar a versão comercial. A função não foi criada pela migração THEIBS.
- **LOCAL:** 187 testes automatizados passaram após as proteções de chaves, tela inicial e prazo do worker (`validacao/hosting-final-tests.txt`). Não equivalem a homologação de pagamentos, isolamento entre dois usuários reais ou benchmark de 100 mil simulações/s na nuvem.

## Regra comercial

- Cadastro obrigatório por Supabase Auth.
- Três dias grátis contados no servidor desde `auth.users.created_at`.
- Compra única de **R$ 250,00** pela AbacatePay. Pix dentro do app ou cartão em checkout hospedado somente quando a conta tiver o método habilitado e a configuração do servidor o autorizar.
- `checkout.completed` ou `transparent.completed` validado contra pedido interno, cobrança e produto libera acesso permanente; reembolso, disputa ou chargeback suspendem apenas o acesso daquela compra.
- `devosyra@gmail.com`, `ninjadevtester@gmail.com` e os IDs/e-mails definidos em `THEIBS_LIFETIME_*` têm acesso vitalício sem cobrança.

## Serviços

1. Hospede este servidor Node em um serviço com processo persistente e HTTPS. A raiz `/` publica a landing page e `/app` contém o laboratório autenticado.
2. Crie um projeto Supabase separado do OSYRA e aplique, nesta ordem, `supabase/migrations/202609260001_theibs_access.sql` e `supabase/migrations/202609300001_theibs_payment_orders.sql`. Verifique tabela, índice de pedido aberto, RPC de evento, grants e RLS no projeto correto antes de habilitar a cobrança. A migração define `theibs_billing_environment=production` por padrão. **Somente no projeto Supabase de desenvolvimento isolado**, altere o singleton para `development` e confirme com uma consulta server-side. A API e a RPC recusam pedidos/eventos se o ambiente divergir.
3. Ative Google Auth. Cadastre `https://SEU_DOMINIO/app` na allow list de redirects do Supabase.
4. Na AbacatePay, crie um produto avulso de 25000 centavos, moeda BRL, sem ciclo, com status ACTIVE. Confirme o ambiente, o ID em `ABACATEPAY_PRODUCT_ID` e os métodos realmente liberados na conta. O backend consulta o produto e recusa preço, ciclo, moeda ou ambiente divergentes.
5. Cadastre o webhook HTTPS:
   `https://SEU_DOMINIO/api/billing/webhook?webhookSecret=SEU_SECRET`
   Eventos: `checkout.completed`, `checkout.refunded`, `checkout.disputed`, `checkout.lost`, `transparent.completed`, `transparent.refunded`, `transparent.disputed` e `transparent.lost`. Use a versão v2; o servidor exige secret na URL e HMAC no corpo bruto.
6. Configure as variáveis de `.env.example` no cofre de segredos da hospedagem. Defina `THEIBS_BILLING_SCHEMA_VERIFIED=true` somente depois de confirmar a migração no projeto correto. `THEIBS_BILLING_ENV=development` usa chaves e produto sandbox **com projeto Supabase de desenvolvimento separado**; o backend bloqueia o projeto de produção THEIBS conhecido nesse modo. `production` exige os correspondentes reais. `THEIBS_PAYMENT_METHODS` deve listar apenas os métodos comprovadamente habilitados (`PIX`, `CARD` ou ambos); vazio desativa a oferta. Nunca envie a secret key do Supabase ou a API key da AbacatePay ao navegador.

O Account e a landing usam as mesmas rotas autenticadas: `GET /api/billing/offer`, `GET /api/billing/order` e `POST /api/billing/checkout` com `{"method":"PIX"}` ou `{"method":"CARD"}`. O servidor define preço, produto, usuário e ambiente. Pix retorna QR Code e copia e cola; cartão retorna URL oficial hospedada. `GET /api/access` é a fonte do direito de uso. URL de sucesso e estado do navegador nunca alteram acesso.

Se a criação no gateway concluir e o servidor cair antes de salvar o ID, o pedido fica `CREATING`. Ao reabrir, o backend procura a cobrança pelo `externalId` do pedido e a recupera. Se o gateway não a localizar, o servidor **não cria uma segunda cobrança automaticamente**; após dez minutos a interface deve encaminhar para suporte. Um operador deve verificar o pedido no banco e no gateway antes de liberar nova tentativa. A rota `GET /api/billing/order` limita consultas repetidas ao gateway por cinco segundos durante atualização da interface.

**Situação em 30/09/2026:** o Render atual é Free e não possui armazenamento persistente; não há variáveis AbacatePay nem métodos habilitados. A loja Osyra tem apenas o produto THEIBS de teste no Sandbox; a loja e o produto comerciais do THEIBS ainda precisam ser definidos. Não há acesso administrativo ao projeto Supabase THEIBS nesta execução. A migração nova está no repositório, mas **não foi aplicada nem testada no banco real**. Portanto, o checkout permanece desativado e nenhuma cobrança real deve ser criada nesta implantação.

## Validação antes da produção

- Use chaves de desenvolvimento e o produto sandbox da AbacatePay, sem movimentar dinheiro real. Cubra compra pelo Account e pela landing; trial ativo e expirado; usuário já pago; métodos individualmente habilitados; reabertura de cobrança pendente; Pix pendente, aprovado, expirado e recusado; cartão hospedado; retorno antes do webhook; webhook inválido, repetido e fora de ordem; concorrência; duas contas; acesso entre dispositivos; e tentativas de alterar valor, produto, método ou status pelo navegador.
- Confirme o webhook devMode para o sandbox e o de produção separadamente. Não use eventos de teste para liberar acesso real.
- Rode `node --test "test/*.test.cjs"`.
- Confirme no Supabase Advisors que as tabelas continuam com RLS ativa.
- Troque para as chaves de produção somente após o fluxo completo passar no ambiente de teste, a migração e persistência serem verificadas e o produto/métodos reais serem confirmados na conta.
