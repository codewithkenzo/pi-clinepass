# pi-clinepass Quality Hardening Spec

**Status:** draft  
**Branch:** `upgrade/quality-hardening` (from `main`)  
**Repo:** `~/dev/pi-clinepass` on WSL  
**Scope:** main branch only — does NOT touch `private/multi-account-rotation`

## Problem

pi-clinepass has the correct auth flow (WorkOS device-code, standalone, no Cline CLI needed) and the best streaming/compat approach of the three ClinePass extensions, but lacks:

1. Error surface — no `message_end` handler, users see raw Effect errors
2. Test coverage — 232 LOC tests vs provider's 1,928. No OAuth error paths, no edge cases
3. TypeScript 6.0.3 installed — TS 7.0.2 is GA with 10x compiler speed, LSP, parallel type-checking
4. No oxc toolchain — oxlint has type-aware linting via tsgo, oxfmt passes 100% Prettier conformance
5. Tests use plain `bun:test` with manual `globalThis.fetch` mocks — no TestClock, no Effect testing patterns
6. Effect version stale — `^4.0.0-beta.66` in package.json but `4.0.0-beta.92` installed
7. No CI — tests exist but nothing runs them
8. Fragile reasoning heuristic — regex `/glm|qwen|minimax|mimo|kimi|deepseek/` for reasoning detection
9. README mismatches — install example points at `./src/index.ts` but package.json `main` is `./dist/index.js` (stale from removed build step)
10. No npm publish config — package is `private: true`, no publish workflow

## Non-goals

- Do NOT touch the multi-account branch or its features
- Do NOT add Cline CLI credential reuse (that's provider's approach, wrong for this use case)
- Do NOT add API key auth (ClinePass subs use OAuth only)
- Do NOT add context shaping / Cline envelope wrapping (different concern, separate ticket)
- Do NOT rewrite the OAuth flow — it's correct, just needs error paths tested
- Do NOT remove Effect-TS — it is the stack standard, tagged errors and catchTag are better than plain classes

## Changes

### 1. Error handler module (`src/error-handler.ts` + `src/errors.ts`)

**errors.ts — expand from 3 tagged errors to include classification:**

```typescript
// Keep existing: AuthError, UpstreamError, TokenFileError
// Add:
export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly message: string
  readonly status?: number
  readonly type: "not_subscribed" | "auth_expired" | "rate_limited" | "unknown"
}> {}
```

**error-handler.ts — new file:**

Filters `message_end` events for clinepass provider, classifies the error, surfaces user-friendly message via `ctx.ui.notify`.

Classification logic (port from provider's `errors.ts`, adapt to Effect):
- 403/forbidden/subscription → not_subscribed → "ClinePass subscription required. Run /login to authenticate."
- 401/unauthorized/invalid_api_key → auth_expired → "ClinePass auth expired. Run /login to refresh."
- 429/rate_limit/too many requests → rate_limited → "ClinePass rate limit reached. Wait or upgrade at app.cline.bot."
- fallback → unknown → "ClinePass request failed. Run /login or check subscription."

Wire in `index.ts`:
```typescript
pi.on("message_end", (event, ctx) => handleClinePassError(event, ctx))
```

### 2. Fix reasoning heuristic + per-model thinkingLevelMap

**Current (discovery.ts:166-169):**
```typescript
function isReasoningModel(id: string): boolean {
  const normalized = id.toLowerCase()
  return /glm|qwen|minimax|mimo|kimi|deepseek/.test(normalized)
}
```

**Replace with:** explicit per-model `reasoning` flag + `thinkingLevelMap` in `CLINEPASS_MODEL_SPECS`.

Update `constants.ts`:
```typescript
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
export type ThinkingLevelMap = Readonly<Record<ThinkingLevel, string | null>>

export type ClinePassModelSpec = {
  readonly contextWindow: number
  readonly maxTokens: number
  readonly reasoning: boolean
  readonly thinkingLevelMap: ThinkingLevelMap
}

export const CLINEPASS_MODEL_SPECS: Readonly<Record<string, ClinePassModelSpec>> = {
  "cline-pass/glm-5.2": {
    contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true,
    thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
  },
  "cline-pass/kimi-k2.7-code": {
    contextWindow: 262_144, maxTokens: 16_384, reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null },
  },
  "cline-pass/deepseek-v4-pro": {
    contextWindow: 1_048_576, maxTokens: 384_000, reasoning: true,
    thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: "high" },
  },
  // ... all models
}
```

Update `discovery.ts`:
- `isReasoningModel()` → lookup from specs table, fallback `false`
- `toClinePassModelConfig()` → read `thinkingLevelMap` from specs instead of hardcoded map
- Default for unknown models: `DEFAULT_THINKING_LEVEL_MAP` with `off: "none", low: "low", medium: "medium", high: "high"`, rest `null`

### 3. Upgrade to TypeScript 7 + oxc toolchain

**TypeScript 7:**
- Update `devDependencies.typescript` from `"latest"` (resolves to 6.0.3) to `"^7.0.2"`
- TS 7 is a faithful Go port — same type semantics, 10x faster builds, LSP, parallel checking
- `tsconfig.json` stays the same — `tsc --noEmit` just gets faster
- `bun test` and `bun run typecheck` should work unchanged

**oxc stack (oxlint + oxfmt):**
- Add to devDependencies: `oxlint@^1.73.0`, `oxfmt@^0.58.0`
- Add scripts:
```json
"lint": "oxlint --config .oxlintrc.json src/ test/",
"format": "oxfmt --write src/ test/",
"format:check": "oxfmt --check src/ test/"
```
- Add `.oxlintrc.json` — start with type-aware rules (oxlint now supports 59/61 type-aware rules from typescript-eslint via tsgo integration)
- Add `.oxfmtrc.json` — minimal config, oxfmt matches Prettier 100%

**Why oxc over eslint+prettier:**
- oxlint uses tsgo (TypeScript Go) for type-aware linting — same speed as TS7 compiler
- oxfmt passes 100% of Prettier JS/TS conformance tests
- Single Rust-based toolchain, no plugin ecosystem to maintain
- Already used by provider's repo (we can reference their config)

### 4. Add TestClock-based Effect tests (bun:test, no new test runner)

**Current state:** tests use `bun:test` with manual `globalThis.fetch` overrides and `Effect.runPromise`. Works, but no time control for OAuth polling/timeout tests.

**Target:** keep `bun:test` as the only test runner. Use `TestClock` from `effect` directly for time-dependent tests. No `@effect/vitest` dependency.

**Pattern for new time-dependent tests:**

```typescript
import { describe, it, expect } from "bun:test"
import { Effect, TestClock, Fiber } from "effect"

it("polls WorkOS device token with controlled time", async () => {
  const fiber = await Effect.runPromise(Effect.fork(pollWorkOsDeviceToken({ ... })))
  await Effect.runPromise(TestClock.adjust("5 seconds"))
  await Effect.runPromise(TestClock.adjust("5 seconds"))
  const result = await Effect.runPromise(Fiber.join(fiber))
  expect(result).toBeDefined()
})
```

**What this unlocks:**
- Device-code poll timeout tests without waiting 300 real seconds
- Token refresh margin timing tests (5 min before expiry) — adjust clock, verify refresh fires
- `authorization_pending` → `slow_down` → success sequence tests with controlled time
- No flaky tests, no real timers, no second test runner

**Test expansion targets:**

| File | Current | Target | What to add |
|------|---------|--------|-------------|
| `test/oauth.test.ts` | 95 | 300 | Error paths: device auth failure, poll timeout (TestClock), token exchange failure, abort signal, refresh failure, `slow_down` handling, `authorization_pending` sequence |
| `test/provider-extension.test.ts` | 137 | 250 | Error handler integration, model discovery failure → fallback, OpenRouter enrichment with stale cache |
| `test/discovery.test.ts` | 0 (new) | 150 | `parseClinePassModelEntries` edge cases, `parseOpenRouterModelSpecs` with malformed data, `buildClinePassModels` dedup, `fallbackClinePassModels` shape, unknown model defaults |
| `test/error-handler.test.ts` | 0 (new) | 100 | Classification for each error type, non-clinepass errors ignored, UI notify vs console fallback |

Rules:
- `bun:test` is the only test runner — no `@effect/vitest`
- Use `TestClock` from `effect` for time-dependent tests via `Effect.runPromise(TestClock.adjust(...))`
- Existing tests stay as-is — don't rewrite what works
- Mock `fetch` via injectable fetcher parameter (already pattern in pi-oauth.ts)
- No network calls in tests
- Every test must be deterministic

### 5. Pin Effect version

**Current:** `"effect": "^4.0.0-beta.66"` but `4.0.0-beta.92` installed. Caret on beta is misleading.

**Target:** `"effect": "^4.0.0-beta.93"` — latest stable beta, matches TabGrip's verified version. Caret lets bun resolve to .97 if compatible.

### 6. CI workflow (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  push:
    branches: [main, upgrade/*]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck
      - run: bun run lint
      - run: bun test
```

### 7. README fixes

- Remove `./dist/index.js` references (no build step)
- Remove `bun run build` from install instructions
- Update install example to use `./src/index.ts` (already correct in `pi.extensions`)
- Add badges (npm version, license, CI status)
- Add models table with context windows
- Add "How it works" section explaining device-code flow
- Clarify: "No Cline CLI needed. No API key needed. OAuth device-code flow works standalone."

### 8. Package.json fixes

- Remove `"private": true` (prep for publish)
- Add `"license": "MIT"`
- Add publish config:
```json
"publishConfig": {
  "access": "public"
}
```
- Remove `dist` from `files` (no build step, pi loads .ts directly)
- Set `"main": "./src/index.ts"` (already correct in `pi.extensions`)
- Pin `"effect": "^4.0.0-beta.93"` (latest stable beta, matches TabGrip verified version, caret resolves to .97 if compatible)
- Set `"typescript": "^7.0.2"`
- Add `oxlint`, `oxfmt` to devDependencies

### 9. npm publish workflow (`.github/workflows/publish.yml`)

```yaml
name: Publish
on:
  release:
    types: [published]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck
      - run: bun run lint
      - run: bun test
      - uses: JS-DevTools/npm-publish@v3
        with:
          token: ${{ secrets.NPM_TOKEN }}
```

## Verification

After all changes:
```bash
bun install          # effect@^4.0.0-beta.93, typescript@7.0.2, oxlint, oxfmt
bun run typecheck    # tsgo — 10x faster, same semantics
bun run lint         # oxlint type-aware
bun run format:check # oxfmt
bun test             # all tests pass, ~800 LOC, TestClock for time-dependent
```

## Order

1. Pin Effect version + upgrade TS7 + add oxc deps
2. Add error handler + classification
3. Fix reasoning heuristic + thinkingLevelMap
4. Add @effect/vitest + expand tests with TestClock
5. Fix README + package.json
6. Add CI
7. Add publish workflow