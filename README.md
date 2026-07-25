# omp-statusline-titanium

Status line extension for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi).

It repaints the built-in status line segments while the target theme is active, and adds
two readouts the stock bar does not have: **git divergence from the remote** and the
**MiniMax Token Plan quota**.

## What it changes

![Status line before and after the extension](assets/status-line.png)

| Segment | Stock omp | With this extension |
|---|---|---|
| `path` | Full path (`~/www/ai/omp-statusline-titanium`) | Current directory only, highlighted |
| `git` | Branch name | Branch plus dirty marker and ahead/behind against the remote (`main* ↑2 ↓1`) |
| `context_pct` | `1.1%/1M` | `1% /1M`, colored by band — warning at 40%, error at 60% |
| `usage` | Not rendered for MiniMax | `5h: 15% 25m │ 7d: 23% 1d25m` — plan quota with time to reset |

Each patch keeps the original renderer behind a `Symbol.for`, so reloading the extension
never stacks layers on top of itself.

## Install

```bash
git clone https://github.com/everton-dgn/omp-statusline-titanium.git
omp plugin link ./omp-statusline-titanium
```

Remove it with `omp plugin uninstall omp-statusline-titanium`.

## Configuration

The patches only apply while the active theme matches the target, which defaults to
`titanium-dracula`. Point it at your own theme with:

```bash
export OMP_STATUSLINE_THEME="your-theme"
```

The `titanium-dracula` theme itself is proposed as a built-in omp theme in
[PR #6651](https://github.com/can1357/oh-my-pi/pull/6651). Until it lands, drop the JSON
into `~/.omp/agent/themes/`.

### MiniMax quota

The quota readout calls `GET /v1/token_plan/remains` with `MINIMAX_API_KEY` (falling back
to `ANTHROPIC_AUTH_TOKEN`) and caches the answer in
`~/.cache/claude-statusline/minimax-quota.json` for 60 seconds. With neither variable set,
the usage segment is left untouched.

> A pull request teaching `omp usage` to report the same quota natively is open upstream
> ([PR #6650](https://github.com/can1357/oh-my-pi/pull/6650)). Even once it lands, this
> extension keeps the number in the status line instead of behind a separate command.

## Thresholds

Declared at the top of `src/status-line-style.js`:

| Constant | Default |
|---|---|
| `BRANCH_MAX_LENGTH` | 18 characters |
| `CONTEXT_WARNING_THRESHOLD` / `CONTEXT_ERROR_THRESHOLD` | 40% / 60% |
| `USAGE_WARNING_THRESHOLD` / `USAGE_ERROR_THRESHOLD` | 70% / 85% |
| `MINIMAX_REFRESH_TTL_MS` | 60 s |
| `GIT_DIVERGENCE_REFRESH_INTERVAL_MS` | 30 s |

## License

MIT
