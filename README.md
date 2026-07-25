# omp-statusline-titanium

Extensão de status line para o [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi).

Reescreve os renderizadores dos segmentos nativos quando o tema ativo é o alvo, sem
tocar no restante da TUI. Cada patch guarda o renderizador original em um `Symbol.for`,
então recarregar a extensão não empilha camadas.

## O que ela adiciona

| Segmento | Comportamento |
|---|---|
| `git` | Mostra divergência com o remoto (`↑ahead` / `↓behind`), com cache de 5 s e refresh a cada 30 s |
| `usage` | Consulta a cota do MiniMax Token Plan em `GET /v1/token_plan/remains` e colore por faixa de consumo |
| `path` | Caminho compacto com destaque do diretório atual |
| `context_pct` | Cor por faixa: alerta a partir de 40% e erro a partir de 60% de contexto usado |

A leitura de cota usa `MINIMAX_API_KEY` (ou `ANTHROPIC_AUTH_TOKEN`) do ambiente e mantém
um cache em `~/.cache/claude-statusline/minimax-quota.json`, com TTL de 60 s. Sem a
variável definida, o segmento simplesmente não é alterado.

> A partir do omp 17.2 a cota do MiniMax Token Plan também aparece em `omp usage`
> de forma nativa ([PR #6650](https://github.com/can1357/oh-my-pi/pull/6650)). Este
> plugin continua útil por manter o número dentro da status line.

## Instalação

```bash
git clone https://github.com/everton-dgn/omp-statusline-titanium.git
omp plugin link ./omp-statusline-titanium
```

Para desinstalar: `omp plugin uninstall omp-statusline-titanium`.

## Configuração

Os patches só são aplicados quando o tema ativo corresponde ao alvo, que por padrão é
o `titanium-dracula`. Para usar com outro tema:

```bash
export OMP_STATUSLINE_THEME="seu-tema"
```

O tema `titanium-dracula` está sendo proposto como tema embutido do omp em
[PR #6651](https://github.com/can1357/oh-my-pi/pull/6651). Até ser aceito, ele pode
ser instalado copiando o JSON para `~/.omp/agent/themes/`.

## Limiares

Definidos no topo de `src/status-line-style.js`:

| Constante | Padrão |
|---|---|
| `BRANCH_MAX_LENGTH` | 18 caracteres |
| `CONTEXT_WARNING_THRESHOLD` / `CONTEXT_ERROR_THRESHOLD` | 40% / 60% |
| `USAGE_WARNING_THRESHOLD` / `USAGE_ERROR_THRESHOLD` | 70% / 85% |
| `MINIMAX_REFRESH_TTL_MS` | 60 s |

## Licença

MIT
