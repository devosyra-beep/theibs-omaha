# THEIBS WebApp

1. Instale Node.js 22 ou superior uma única vez.
2. Execute `Iniciar-THEIBS-WebApp.cmd`.
3. O navegador abrirá `http://127.0.0.1:4173`.
4. No navegador, use **Instalar aplicativo** para criar um ícone do THEIBS.

O motor, as cartas, o histórico e o Ollama continuam locais. A janela do iniciador precisa permanecer aberta durante o uso. Os dados ficam em `%LOCALAPPDATA%\THEIBS` e não são enviados para Supabase ou Cloudflare.

No modo local, o botão **Continuar neste dispositivo** abre o aplicativo sem conta. No modo público, o servidor exige autenticação do Supabase, concede três dias de teste e libera a compra única configurada no AbacatePay. O histórico continua no servidor do THEIBS em uma pasta isolada por usuário; o Supabase guarda apenas identidade, direito de acesso e eventos de pagamento.

As variáveis e etapas de publicação estão em `DEPLOY-SAAS.md`. Apple permanece oculta até o provedor ser configurado; Google pode ser ativado separadamente.
