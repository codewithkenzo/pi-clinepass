import { afterEach, describe, expect, it, mock } from "bun:test"
import extension from "../src/index.ts"
import { Effect } from "effect"
import { buildClinePassModels, clearOpenRouterModelsCache, fetchOpenRouterModelSpecs, parseClinePassModelEntries, parseOpenRouterModelSpecs, toClinePassModelConfig } from "../src/discovery.ts"
import { CLINEPASS_BASE_URL } from "../src/config.ts"
import { CLINEPASS_PROVIDER_ID } from "../src/constants.ts"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  clearOpenRouterModelsCache()
})

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), { status: 200, ...init, headers: { "content-type": "application/json" } })
}

describe("ClinePass model discovery/config", () => {
  it("parses clinePass model entries only", () => {
    expect(parseClinePassModelEntries({ clinePass: [{ id: "cline-pass/glm-5.2" }, { id: "openai/gpt" }] })).toEqual([
      { id: "cline-pass/glm-5.2" },
    ])
  })

  it("builds OpenAI completions model config with Cline gateway compat", () => {
    const model = toClinePassModelConfig({ id: "cline-pass/glm-5.2" })
    expect(model).toMatchObject({
      id: "cline-pass/glm-5.2",
      provider: CLINEPASS_PROVIDER_ID,
      baseUrl: CLINEPASS_BASE_URL,
      api: "openai-completions",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1048576,
      maxTokens: 131072,
      headers: {
        "User-Agent": "Cline/4.0.0",
        "X-CLIENT-TYPE": "vscode",
      },
      compat: {
        thinkingFormat: "together",
        cacheControlFormat: "anthropic",
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens",
        supportsReasoningEffort: true,
      },
    })
    expect(model.compat?.thinkingFormat).not.toBe("zai")
    expect(model.compat?.thinkingFormat).not.toBe("openrouter")
  })

  it("dedupes discovered models", () => {
    expect(buildClinePassModels([{ id: "cline-pass/glm-5.2" }, { id: "cline-pass/glm-5.2" }])).toHaveLength(1)
  })

  it("uses per-model context window and max tokens from specs table", () => {
    const glm = toClinePassModelConfig({ id: "cline-pass/glm-5.2" })
    expect(glm.contextWindow).toBe(1_048_576)
    expect(glm.maxTokens).toBe(131_072)

    const kimi = toClinePassModelConfig({ id: "cline-pass/kimi-k2.7-code" })
    expect(kimi.contextWindow).toBe(262_144)
    expect(kimi.maxTokens).toBe(16_384)

    const unknown = toClinePassModelConfig({ id: "cline-pass/some-new-model" })
    expect(unknown.contextWindow).toBe(128_000)
    expect(unknown.maxTokens).toBe(8_192)
  })

  it("enriches future ClinePass models from OpenRouter by model slug", () => {
    const entries = [{ id: "cline-pass/future-code-1", name: "Future Code" }]
    const specs = parseOpenRouterModelSpecs({
      data: [
        {
          id: "future/future-code-1",
          context_length: 1_048_576,
          top_provider: { max_completion_tokens: 32_768 },
        },
      ],
    }, entries)

    const model = toClinePassModelConfig(entries[0], specs)
    expect(model.contextWindow).toBe(1_048_576)
    expect(model.maxTokens).toBe(32_768)
  })

  it("caches OpenRouter model specs during the process TTL", async () => {
    const entries = [{ id: "cline-pass/future-code-1", name: "Future Code" }]
    const fetcher = mock(async () => jsonResponse({
      data: [
        {
          id: "future/future-code-1",
          context_length: 1_048_576,
          top_provider: { max_completion_tokens: 32_768 },
        },
      ],
    })) as unknown as typeof fetch

    const first = await Effect.runPromise(fetchOpenRouterModelSpecs(entries, fetcher))
    const second = await Effect.runPromise(fetchOpenRouterModelSpecs(entries, fetcher))

    expect(first).toEqual(second)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe("Pi provider extension", () => {
  it("registers ClinePass provider with models and OAuth object", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ clinePass: [{ id: "cline-pass/glm-5.2", name: "GLM 5.2" }, { id: "cline-pass/qwen3.7-max" }] }),
    ) as unknown as typeof fetch
    const registerProvider = mock(() => undefined)

    await extension({ registerProvider } as never)

    expect(registerProvider).toHaveBeenCalledTimes(1)
    const [providerId, config] = registerProvider.mock.calls[0] as unknown as [string, { baseUrl: string; models: Array<Record<string, unknown>>; oauth: Record<string, unknown> }]
    expect(providerId).toBe(CLINEPASS_PROVIDER_ID)
    expect(config.baseUrl).toBe(CLINEPASS_BASE_URL)
    expect(config.models.map((model) => model.id)).toEqual(["cline-pass/glm-5.2", "cline-pass/qwen3.7-max"])
    expect(config.models[0]).toMatchObject({
      api: "openai-completions",
      headers: { "X-CORE-VERSION": "4.0.0" },
      compat: { thinkingFormat: "together", cacheControlFormat: "anthropic" },
    })
    expect(typeof config.oauth.login).toBe("function")
    expect(typeof config.oauth.refreshToken).toBe("function")
    expect(typeof config.oauth.getApiKey).toBe("function")
  })
})
