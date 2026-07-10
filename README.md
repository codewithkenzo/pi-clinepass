# pi-clinepass

[![npm version](https://img.shields.io/npm/v/%40codewithkenzo%2Fpi-clinepass)](https://www.npmjs.com/package/@codewithkenzo/pi-clinepass)
[![license](https://img.shields.io/github/license/codewithkenzo/pi-clinepass)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/codewithkenzo/pi-clinepass/ci.yml?branch=main&label=CI)](https://github.com/codewithkenzo/pi-clinepass/actions/workflows/ci.yml)

![pi-clinepass](assets/pi-clinepass-hero.png)

Use ClinePass models (GLM-5.2, Kimi K2.7, DeepSeek V4, Qwen3.7, MiniMax M3) in Pi. Log in with a browser device code, pick a model, start coding.

## What works

- Provider id: `clinepass`
- Primary model: `glm-5.2`
- Auth: Pi `/login` OAuth device-code flow
- Model list: live Cline recommended-models endpoint, filtered to `clinePass[]`
- Transport: `openai-completions` against `https://api.cline.bot/api/v1`
- Token handling: Pi stores OAuth credentials; this package returns `workos:<access>` only to Pi's provider auth path
- Reasoning: Pi thinking levels map to ClinePass-compatible `reasoning` params
- Prompt caching: Pi emits Anthropic-style cache-control markers where supported

Log in through your browser. That is the full auth path.

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
3. Open URL on any browser, enter code, then approve ClinePass access.
4. Extension polls WorkOS until authorization completes.
5. Extension exchanges WorkOS tokens with Cline's auth API and returns OAuth credentials to Pi.
6. Pi uses refreshed Cline access tokens for model requests.

## Model discovery

The extension fetches:

```text
https://api.cline.bot/api/v1/ai/cline/recommended-models
```

It reads `clinePass[]`, dedupes model ids, then enriches context/output limits from OpenRouter's public model catalog by model slug. A static table covers known ClinePass models when OpenRouter omits fields.

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

## OAuth behavior

Flow:

1. Start WorkOS device auth with Cline's production client id.
2. Show Pi device-code/browser callbacks.
3. Poll WorkOS until approved.
4. Register WorkOS tokens with Cline `/api/v1/auth/register`.
5. Return Pi `OAuthCredentials` with Cline access/refresh/expires metadata.
6. Refresh through Cline `/api/v1/auth/refresh` when needed.
7. Send requests with `Authorization: Bearer workos:<access>`.

Token rule: this repo never logs access or refresh tokens.

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
- `{ reasoning: { enabled: false } }` suppresses GLM reasoning.
- Pi's OpenRouter-style off state emits `{ reasoning: { effort: "none" } }`, which ClinePass does not suppress.
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

If it says `No API key found for clinepass`, the extension loaded correctly; run `/login`.

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
