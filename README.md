# pi-clinepass

[![npm version](https://img.shields.io/npm/v/%40codewithkenzo%2Fpi-clinepass)](https://www.npmjs.com/package/@codewithkenzo/pi-clinepass)
[![license](https://img.shields.io/github/license/codewithkenzo/pi-clinepass)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/codewithkenzo/pi-clinepass/ci.yml?branch=main&label=CI)](https://github.com/codewithkenzo/pi-clinepass/actions/workflows/ci.yml)

![pi-clinepass](assets/pi-clinepass-hero.png)

Use ClinePass models (GLM-5.2, Kimi K2.7, DeepSeek V4, Qwen3.7, MiniMax M3) in Pi. Log in with a browser device code, pick a model, start coding.

## Capabilities

- WorkOS device-code OAuth with Cline token registration and refresh
- Live ClinePass model discovery with static fallback metadata
- Per-model context windows, output limits, reasoning settings, and thinking maps
- Prompt-cache and reasoning compatibility for the ClinePass gateway
- Provider id `clinepass`; transport `openai-completions` at `https://api.cline.bot/api/v1`
- Credentials stored by Pi; requests use `Authorization: Bearer workos:<access>`

Primary model: `glm-5.2`.

## Install locally

From a checkout:

```bash
bun install
bun run typecheck
bun test
pi install .
```

From npm:

```bash
pi install npm:@codewithkenzo/pi-clinepass
```

From GitHub:

```bash
pi install git:github.com/codewithkenzo/pi-clinepass
```

Or add a local checkout manually to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["../../dev/pi-clinepass"]
}
```

Then restart Pi or run `/reload`.

## Login + use

In Pi:

1. Run `/login`
2. Choose **ClinePass**
3. Open the browser/device URL and enter the shown code
4. Run `/model`
5. Pick `clinepass/glm-5.2`

Exact model string for CLI/non-interactive runs:

```bash
pi --model clinepass/glm-5.2 "Say OK"
```

## How it works

1. `/login` starts a WorkOS OAuth device authorization request.
2. Pi shows a verification URL and one-time device code.
3. Open the URL, enter the code, approve access.
4. The extension polls WorkOS until authorization completes.
5. WorkOS tokens register with Cline auth; Pi receives OAuth credentials.
6. Later requests use refreshed Cline access tokens.

Wire-level detail:

1. WorkOS device auth with Cline's production client id
2. Poll WorkOS until approved
3. `POST /api/v1/auth/register` with WorkOS tokens
4. `POST /api/v1/auth/refresh` when access is near expiry
5. Requests use `Authorization: Bearer workos:<access>`

Access and refresh tokens are never logged.

## Model discovery

The extension fetches:

```text
https://api.cline.bot/api/v1/ai/cline/recommended-models
```

It reads `clinePass[]`, dedupes model ids, then enriches context/output limits from OpenRouter's public model catalog by model slug. A static table covers known ClinePass models when OpenRouter omits fields. If the live list fails, the extension falls back to the static set and writes a stderr notice.

Known models:

| Model               | Context window | Max output tokens | Reasoning |
| ------------------- | -------------: | ----------------: | :-------: |
| `glm-5.2`           |      1,048,576 |           131,072 |    Yes    |
| `qwen3.7-max`       |      1,000,000 |            65,536 |    Yes    |
| `qwen3.7-plus`      |      1,000,000 |            65,536 |    Yes    |
| `kimi-k2.7-code`    |        262,144 |            16,384 |    Yes    |
| `deepseek-v4-pro`   |      1,048,576 |           384,000 |    Yes    |
| `deepseek-v4-flash` |      1,048,576 |            65,536 |    Yes    |
| `minimax-m3`        |      1,048,576 |           512,000 |    Yes    |

## ClinePass compatibility

Each model is registered with:

```ts
{
  api: "openai-completions",
  input: ["text"],
  contextWindow: 1_000_000, // per-model from vendor docs
  maxTokens: 131_072,       // per-model from vendor docs
  reasoning: true,
  compat: {
    thinkingFormat: "together",
    cacheControlFormat: "anthropic",
    supportsUsageInStreaming: true,
    supportsReasoningEffort: true,
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: "max_tokens"
  }
}
```

Why `thinkingFormat: "together"`:

- ClinePass accepts top-level `reasoning` objects.
- ClinePass honors `{ reasoning: { enabled: false } }`.
- It does not treat `{ reasoning: { effort: "none" } }` as disabled.
- z.ai-native `thinking: { type: "disabled" }` is also ignored by ClinePass.

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run format:check
bun test
```

Useful smoke test after local install:

```bash
pi --model clinepass/glm-5.2 -p "Reply exactly OK"
```

If it says `No API key found for clinepass`, the extension loaded; run `/login`.

## Package surface

Pi loads this package through:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Runtime entrypoint: `src/index.ts`.
