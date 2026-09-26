# THEIBS — Laboratório Omaha

Aplicativo local e WebApp instalável para análise e treino de Omaha High PLO4, PLO5 e PLO6. A interface acompanha equity, EV sob premissas explícitas, leitura da mão e registro opcional de ações Multiway.

## Versão atual

`0.10.0`

- Entrada rápida de cartas em português.
- Monte Carlo e avaliação exata quando aplicável.
- Multiway opcional com posições, pote, stacks, ações observadas e desfazer.
- Treino heads-up separado da análise manual.
- Destaque `NUTS` em HUD dourado quando nenhuma dupla privada possível supera a mão no board atual.
- `Shift` sozinho inicia uma nova mão em Analisar.
- PWA local com ícone geométrico, manifest e inicialização no navegador instalado.
- Tela de acesso preparada para Google e Apple; provedores permanecem desativados até a conexão segura com Supabase.

## Executar pelo código

Requer Node.js 22.13 ou superior.

```powershell
cd codigo-fonte
npm install
npm test
npm run desktop
# ou, sem Electron/Chromium empacotado:
npm run webapp
```

O motor e os dados permanecem locais. Ollama é opcional e serve apenas para selecionar e explicar fatos já calculados; não calcula equity nem altera EV.

## Segurança e privacidade

- O aplicativo abre somente um servidor local em `127.0.0.1`.
- Não inclui credenciais, tokens, histórico pessoal ou modelos do Ollama.
- Dados e rascunhos do usuário não fazem parte deste repositório.
- Os pacotes Windows são distribuídos em **Releases**, fora do histórico Git.

## Limites atuais

O motor não é um solver GTO. No Multiway, EV exige que seja a vez do herói e premissas suficientes para respostas ainda desconhecidas. All-ins, potes laterais e distribuição de potes no showdown são registrados ou bloqueados conforme o caso, mas não recebem uma recomendação inventada.

Consulte [HISTORICO_VERSOES.md](HISTORICO_VERSOES.md) e [METODO-VALIDACAO-E-APRENDIZAGEM.md](METODO-VALIDACAO-E-APRENDIZAGEM.md).
