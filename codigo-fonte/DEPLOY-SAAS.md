# THEIBS SaaS — acesso público seguro

## URL provisória no Render

O `render.yaml` na raiz prepara um **Web Service gratuito**, com a landing em `/` e o app em `/app`. Não é necessário comprar domínio. O endereço `https://NOME.onrender.com` só existe depois de criar o serviço; este arquivo não confirma publicação.

1. Entre no Render, conecte somente o repositório privado `devosyra-beep/theibs-omaha` e use **New → Blueprint** com o `render.yaml`. Confira que o plano é **Free**.
2. Preencha `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` no painel, usando o projeto separado do THEIBS. Aplique a migração e habilite Google Auth nesse projeto.
3. O servidor usa `PORT` e `RENDER_EXTERNAL_URL` automaticamente. Depois de obter a URL, adicione `https://NOME.onrender.com/app` aos redirects do Supabase e teste o login real.
4. `/healthz` verifica que o servidor responde. Isso não comprova Google, banco ou pagamentos: confirme esses fluxos separadamente.

O plano Free pausa após inatividade e **perde arquivos de histórico/rascunhos em reinícios ou novos deploys**. Serve para validar a primeira URL; não é a versão comercial pronta. Mãos em andamento ficam na memória e encerram em qualquer reinício, mesmo com disco. A capacidade do motor precisa ser medida no servidor contratado; o benchmark local não comprova 100 mil simulações/s na nuvem.

O blueprint não configura AbacatePay. Antes de cobrar, adicione um disco persistente em um plano compatível, aponte `THEIBS_USER_DATA_ROOT` para ele, confirme que os arquivos sobrevivem a reinícios e defina `THEIBS_STORAGE_PERSISTENT=true`. O servidor bloqueia a inicialização hospedada sem autenticação ou com cobrança configurada sem armazenamento declarado persistente. Não contrate recursos pagos sem confirmar o preço.

O runtime web usa apenas Node, sem instalar Electron/Chromium. O build verifica a sintaxe e inicia `node server.js`. Referências: [Render Node](https://render.com/docs/deploy-node-express-app), [plano gratuito](https://render.com/docs/free), [variáveis do Render](https://render.com/docs/environment-variables).

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
