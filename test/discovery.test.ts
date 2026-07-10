import { describe, expect, it, mock } from "bun:test"
import { Cache, Effect } from "effect"
import {
  buildClinePassModels,
  makeOpenRouterModelsCache,
  fallbackClinePassModels,
  fetchOpenRouterModelSpecs,
  parseClinePassModelEntries,
  parseOpenRouterModelSpecs,
  toClinePassModelConfig,
  type RecommendedModelsResponse,
} from "../src/discovery.ts"
import {
  CLINEPASS_MODEL_SPECS,
  CLINEPASS_API_ID,
  CLINEPASS_PROVIDER_ID,
  DEFAULT_THINKING_LEVEL_MAP,
} from "../src/constants.ts"

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("ClinePass discovery edge cases", () => {
  it("returns no entries when clinePass is missing or not an array", () => {
    expect(parseClinePassModelEntries({})).toEqual([])
    expect(
      parseClinePassModelEntries({ clinePass: "invalid" } as unknown as RecommendedModelsResponse),
    ).toEqual([])
  })

  it("drops malformed, foreign, and blank model entries", () => {
    const payload = {
      clinePass: [
        null,
        {},
        { id: 42 },
        { id: "" },
        { id: "openai/gpt-5" },
        { id: "   " },
        { id: "cline-pass/glm-5.2", name: "  GLM 5.2  ", description: "code" },
      ],
    } as unknown as RecommendedModelsResponse

    expect(parseClinePassModelEntries(payload)).toEqual([
      {
        id: "glm-5.2",
        upstreamId: "cline-pass/glm-5.2",
        name: "GLM 5.2",
        description: "code",
      },
    ])
  })

  it("deduplicates entries by short model id and keeps first metadata", () => {
    expect(
      parseClinePassModelEntries({
        clinePass: [
          { id: "cline-pass/glm-5.2", name: "First" },
          { id: "cline-pass/glm-5.2", name: "Second" },
        ],
      }),
    ).toEqual([{ id: "glm-5.2", upstreamId: "cline-pass/glm-5.2", name: "First" }])
  })

  it("rejects malformed OpenRouter envelopes and specs", () => {
    const entries = [{ id: "future", upstreamId: "cline-pass/future" }]
    expect(parseOpenRouterModelSpecs(null, entries)).toEqual({})
    expect(parseOpenRouterModelSpecs({ data: "invalid" }, entries)).toEqual({})
    expect(
      parseOpenRouterModelSpecs(
        {
          data: [
            null,
            { id: 7, context_length: 10 },
            { id: "vendor/future", context_length: -1 },
            { id: "vendor/other", context_length: 64_000 },
          ],
        },
        entries,
      ),
    ).toEqual({})
  })

  it("builds deduplicated models with static reasoning and thinking maps", () => {
    const models = buildClinePassModels([
      { id: "glm-5.2", upstreamId: "cline-pass/glm-5.2" },
      { id: "glm-5.2", upstreamId: "cline-pass/glm-5.2" },
      { id: "kimi-k2.7-code", upstreamId: "cline-pass/kimi-k2.7-code" },
    ])

    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({
      reasoning: true,
      thinkingLevelMap: CLINEPASS_MODEL_SPECS["cline-pass/glm-5.2"]?.thinkingLevelMap,
    })
    expect(models[1]?.thinkingLevelMap).toEqual(
      CLINEPASS_MODEL_SPECS["cline-pass/kimi-k2.7-code"]?.thinkingLevelMap,
    )
  })

  it("uses conservative defaults for unknown models", () => {
    const model = toClinePassModelConfig({
      id: "future-model",
      upstreamId: "cline-pass/future-model",
    })

    expect(model).toMatchObject({
      id: "future-model",
      name: "future-model",
      provider: CLINEPASS_PROVIDER_ID,
      reasoning: false,
      contextWindow: 128_000,
      maxTokens: 8_192,
      thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    })
  })

  it("returns stable fallback model shapes", () => {
    const models = fallbackClinePassModels()
    expect(models.map((model) => model.id)).toEqual([
      "glm-5.2",
      "qwen3.7-max",
      "qwen3.7-plus",
      "kimi-k2.7-code",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "minimax-m3",
    ])
    for (const model of models) {
      expect(model.provider).toBe(CLINEPASS_PROVIDER_ID)
      expect(model.api).toBe(CLINEPASS_API_ID)
      expect(model.reasoning).toBe(true)
      expect(model.thinkingLevelMap).toBeDefined()
      expect(model.input).toEqual(["text"])
    }
  })

  it("keeps cached OpenRouter enrichment until its explicit cache is invalidated", async () => {
    const entries = [{ id: "future", upstreamId: "cline-pass/future" }]
    let contextWindow = 100_000
    const fetcher = mock(async () =>
      jsonResponse({ data: [{ id: "vendor/future", context_length: contextWindow }] }),
    ) as unknown as typeof fetch
    const cache = await Effect.runPromise(makeOpenRouterModelsCache(fetcher))

    const first = await Effect.runPromise(fetchOpenRouterModelSpecs(entries, cache))
    contextWindow = 200_000
    const stale = await Effect.runPromise(fetchOpenRouterModelSpecs(entries, cache))
    expect(first.future?.contextWindow).toBe(100_000)
    expect(stale).toEqual(first)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await Effect.runPromise(Cache.invalidate(cache, "models"))
    const fresh = await Effect.runPromise(fetchOpenRouterModelSpecs(entries, cache))
    expect(fresh.future?.contextWindow).toBe(200_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("shares one OpenRouter lookup across concurrent gets on the same cache", async () => {
    const entries = [{ id: "future", upstreamId: "cline-pass/future" }]
    const fetcher = mock(async () => {
      await Promise.resolve()
      return jsonResponse({ data: [{ id: "vendor/future", context_length: 100_000 }] })
    }) as unknown as typeof fetch
    const cache = await Effect.runPromise(makeOpenRouterModelsCache(fetcher))

    const [first, second] = await Effect.runPromise(
      Effect.all(
        [fetchOpenRouterModelSpecs(entries, cache), fetchOpenRouterModelSpecs(entries, cache)],
        { concurrency: "unbounded" },
      ),
    )

    expect(first).toEqual(second)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
