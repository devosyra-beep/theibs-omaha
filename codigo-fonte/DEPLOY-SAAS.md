# THEIBS SaaS — acesso público seguro

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
