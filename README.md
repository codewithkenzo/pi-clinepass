# pi-clinepass

Local ClinePass OpenAI-compatible proxy for Pi.

Uses existing Cline OAuth credentials from:

```text
~/.cline/data/settings/providers.json
```

No tokens are printed. Token refresh uses Cline's refresh endpoint, then writes same `providers.json` with mode `0600`.

## Install

```bash
bun install
```

## Commands

```bash
bun run src/cli.ts status
bun run src/cli.ts models
bun run src/cli.ts test --model cline-pass/glm-5.2
bun run src/cli.ts serve --port 48752
```

If linked/installed as bin:

```bash
clinepass-proxy serve --port 48752
```

## Pi config

Configure Pi as OpenAI-compatible:

- Base URL: `http://127.0.0.1:48752/v1`
- API key: any dummy value, e.g. `dummy`
- Model: `cline-pass/glm-5.2`

Proxy endpoints:

- `GET /v1/models` returns ClinePass model IDs.
- `POST /v1/chat/completions` forwards to Cline with OAuth auth.

For `cline-pass/*` models, proxy defaults to:

```json
{"reasoning":{"exclude":true}}
```

unless caller already supplied top-level `reasoning`.

## Notes

- Cline chat endpoint: `https://api.cline.bot/api/v1/chat/completions`
- ClinePass models endpoint: `https://api.cline.bot/api/v1/ai/cline/recommended-models`
- Auth header sent upstream: `Authorization: Bearer workos:<accessToken>`
