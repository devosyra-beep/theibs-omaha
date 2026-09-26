# THEIBS WebApp local

1. Instale Node.js 22 ou superior uma única vez.
2. Execute `Iniciar-THEIBS-WebApp.cmd`.
3. O navegador abrirá `http://127.0.0.1:4173`.
4. No navegador, use **Instalar aplicativo** para criar um ícone do THEIBS.

O motor, as cartas, o histórico e o Ollama continuam locais. A janela do iniciador precisa permanecer aberta durante o uso. Os dados ficam em `%LOCALAPPDATA%\THEIBS` e não são enviados para Supabase ou Cloudflare.

Google e Apple aparecem na tela de acesso como preparação visual. Eles permanecem desabilitados até o projeto Supabase, os provedores OAuth e os endereços de retorno serem configurados; o botão **Continuar neste dispositivo** mantém o fluxo local disponível.
