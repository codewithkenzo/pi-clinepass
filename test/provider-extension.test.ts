import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type ProviderStreams,
} from "@codewithkenzo/pi-ai-runtime"
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
} from "@earendil-works/pi-coding-agent"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import extension, {
  LIVE_MODEL_DISCOVERY_TIMEOUT,
  loadClinePassModels,
  registerClinePassExtension,
} from "../src/index.ts"
import {
  buildClinePassModels,
  clearOpenRouterModelsCache,
  fetchOpenRouterModelSpecs,
  parseClinePassModelEntries,
  parseOpenRouterModelSpecs,
  toClinePassModelConfig,
  toClinePassUpstreamModelId,
} from "../src/discovery.ts"
import { CLINEPASS_BASE_URL } from "../src/config.ts"
import { CLINEPASS_API_ID, CLINEPASS_PROVIDER_ID } from "../src/constants.ts"

type MessageEndEvent = Extract<ExtensionEvent, { type: "message_end" }>

const originalFetch = globalThis.fetch
const originalStderrWrite = process.stderr.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stderr.write = originalStderrWrite
  clearOpenRouterModelsCache()
})

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json" },
  })
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: CLINEPASS_API_ID,
    provider: CLINEPASS_PROVIDER_ID,
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    timestamp: 0,
    ...overrides,
  }
}

function extensionContext(notify: (message: string) => void): ExtensionContext {
  return { ui: { notify } } as unknown as ExtensionContext
}

function extensionApi(
  registerProvider: unknown,
  on: unknown = mock(() => undefined),
): ExtensionAPI {
  return { registerProvider, on } as unknown as ExtensionAPI
}

describe("ClinePass model discovery/config", () => {
  it("parses clinePass model entries only", () => {
    expect(
      parseClinePassModelEntries({
        clinePass: [{ id: "cline-pass/glm-5.2" }, { id: "openai/gpt" }],
      }),
    ).toEqual([{ id: "glm-5.2", upstreamId: "cline-pass/glm-5.2" }])
  })

  it("issue #2: builds model config with provider-isolated API", () => {
    const model = toClinePassModelConfig({ id: "glm-5.2", upstreamId: "cline-pass/glm-5.2" })
    expect(model).toMatchObject({
      id: "glm-5.2",
      provider: CLINEPASS_PROVIDER_ID,
      baseUrl: CLINEPASS_BASE_URL,
      api: CLINEPASS_API_ID,
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
    expect(
      buildClinePassModels([
        { id: "glm-5.2", upstreamId: "cline-pass/glm-5.2" },
        { id: "glm-5.2", upstreamId: "cline-pass/glm-5.2" },
      ]),
    ).toHaveLength(1)
  })

  it("maps short Pi ids to upstream ClinePass ids", () => {
    expect(toClinePassUpstreamModelId("glm-5.2")).toBe("cline-pass/glm-5.2")
    expect(toClinePassUpstreamModelId("cline-pass/glm-5.2")).toBe("cline-pass/glm-5.2")
  })

  it("uses per-model context window and max tokens from specs table", () => {
    const glm = toClinePassModelConfig({ id: "glm-5.2", upstreamId: "cline-pass/glm-5.2" })
    expect(glm.contextWindow).toBe(1_048_576)
    expect(glm.maxTokens).toBe(131_072)

    const kimi = toClinePassModelConfig({
      id: "kimi-k2.7-code",
      upstreamId: "cline-pass/kimi-k2.7-code",
    })
    expect(kimi.contextWindow).toBe(262_144)
    expect(kimi.maxTokens).toBe(16_384)

    const unknown = toClinePassModelConfig({
      id: "some-new-model",
      upstreamId: "cline-pass/some-new-model",
    })
    expect(unknown.contextWindow).toBe(128_000)
    expect(unknown.maxTokens).toBe(8_192)
  })

  it("enriches future ClinePass models from OpenRouter by model slug", () => {
    const entries = [
      { id: "future-code-1", upstreamId: "cline-pass/future-code-1", name: "Future Code" },
    ]
    const specs = parseOpenRouterModelSpecs(
      {
        data: [
          {
            id: "future/future-code-1",
            context_length: 1_048_576,
            top_provider: { max_completion_tokens: 32_768 },
          },
        ],
      },
      entries,
    )

    const model = toClinePassModelConfig(entries[0], specs)
    expect(model.contextWindow).toBe(1_048_576)
    expect(model.maxTokens).toBe(32_768)
  })

  it("caches OpenRouter model specs during the process TTL", async () => {
    const entries = [
      { id: "future-code-1", upstreamId: "cline-pass/future-code-1", name: "Future Code" },
    ]
    const fetcher = mock(async () =>
      jsonResponse({
        data: [
          {
            id: "future/future-code-1",
            context_length: 1_048_576,
            top_provider: { max_completion_tokens: 32_768 },
          },
        ],
      }),
    ) as unknown as typeof fetch

    const first = await Effect.runPromise(fetchOpenRouterModelSpecs(entries, fetcher))
    const second = await Effect.runPromise(fetchOpenRouterModelSpecs(entries, fetcher))

    expect(first).toEqual(second)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe("Pi provider extension", () => {
  it("issue #1: uses direct stable pi-ai runtime subpath", async () => {
    const providerApi = await import("@codewithkenzo/pi-ai-runtime/api/openai-completions")
    const source = await Bun.file(new URL("../src/index.ts", import.meta.url)).text()
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).text()

    expect(typeof providerApi.streamSimple).toBe("function")
    expect(source).toContain('from "@codewithkenzo/pi-ai-runtime/api/openai-completions"')
    expect(source).not.toContain("@earendil-works/pi-ai")
    expect(source).not.toContain(["@codewithkenzo/pi-ai-runtime", "compat"].join("/"))
    expect(packageJson).toContain(
      '"@codewithkenzo/pi-ai-runtime": "npm:@earendil-works/pi-ai@latest"',
    )
  })

  it("bounds hung live discovery and falls back using Effect timeout", async () => {
    const stderrWrite = mock((_chunk: string | Uint8Array) => true)
    process.stderr.write = stderrWrite as unknown as typeof process.stderr.write
    const fetcher = mock(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch

    const models = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(loadClinePassModels(fetcher))
        yield* Effect.yieldNow
        yield* TestClock.adjust(LIVE_MODEL_DISCOVERY_TIMEOUT)
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestClock.layer())),
    )

    expect(models.map((model) => model.id)).toEqual([
      "glm-5.2",
      "qwen3.7-max",
      "qwen3.7-plus",
      "kimi-k2.7-code",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "minimax-m3",
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(stderrWrite).toHaveBeenCalledTimes(1)
    expect(String(stderrWrite.mock.calls[0]?.[0])).toContain("Discovery timed out after 5 seconds")
  })

  const discoveryFailures: ReadonlyArray<{
    name: string
    fetcher: () => Promise<Response>
    expected: string
  }> = [
    {
      name: "rejected fetch",
      fetcher: () => Promise.reject(new Error("DISCOVERY_SECRET")),
      expected: "Failed to fetch ClinePass model list",
    },
    {
      name: "HTTP error",
      fetcher: async () => jsonResponse({ error: "DISCOVERY_SECRET" }, { status: 503 }),
      expected: "HTTP 503",
    },
    {
      name: "malformed JSON",
      fetcher: async () => new Response("{DISCOVERY_SECRET", { status: 200 }),
      expected: "invalid JSON",
    },
    {
      name: "malformed payload",
      fetcher: async () => jsonResponse({ clinePass: "DISCOVERY_SECRET" }),
      expected: "malformed payload",
    },
    {
      name: "empty payload",
      fetcher: async () => jsonResponse({ clinePass: [] }),
      expected: "no usable models",
    },
  ]

  for (const scenario of discoveryFailures) {
    it(`falls back once for ${scenario.name} without leaking response data`, async () => {
      const stderrWrite = mock((_chunk: string | Uint8Array) => true)
      process.stderr.write = stderrWrite as unknown as typeof process.stderr.write
      const fetcher = mock(scenario.fetcher) as unknown as typeof fetch

      const models = await Effect.runPromise(loadClinePassModels(fetcher))

      expect(models).toEqual(expect.arrayContaining([expect.objectContaining({ id: "glm-5.2" })]))
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(stderrWrite).toHaveBeenCalledTimes(1)
      const notice = String(stderrWrite.mock.calls[0]?.[0])
      expect(notice).toContain(scenario.expected)
      expect(notice).not.toContain("DISCOVERY_SECRET")
    })
  }

  it("wires message_end errors through the extension handler", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ clinePass: [{ id: "cline-pass/glm-5.2" }] }),
    ) as unknown as typeof fetch
    const registerProvider = mock(() => undefined)
    const on = mock(() => undefined)

    await extension(extensionApi(registerProvider, on))

    const [eventName, handler] = on.mock.calls[0] as unknown as [
      string,
      (event: MessageEndEvent, ctx: ExtensionContext) => void,
    ]
    const notify = mock(() => undefined)
    handler(
      {
        type: "message_end",
        message: assistantMessage({ errorMessage: "HTTP 401 unauthorized" }),
      },
      extensionContext(notify),
    )

    expect(eventName).toBe("message_end")
    expect(notify).toHaveBeenCalledWith("ClinePass auth expired. Run /login to refresh.")
  })

  it("issue #2: installs private API in registry without replacing builtin handler", async () => {
    const fetcher = mock(async () =>
      jsonResponse({
        clinePass: [
          { id: "cline-pass/glm-5.2", name: "GLM 5.2" },
          { id: "cline-pass/qwen3.7-max" },
        ],
      }),
    ) as unknown as typeof fetch
    let capturedModel: Model<Api> | undefined
    const controlHandler: ProviderStreams["streamSimple"] = (model) => {
      capturedModel = model
      return createAssistantMessageEventStream()
    }
    const privateHandler: ProviderStreams["streamSimple"] = (model) => {
      capturedModel = model
      return createAssistantMessageEventStream()
    }
    const registry = new Map<string, ProviderStreams["streamSimple"]>([
      ["openai-completions", controlHandler],
    ])
    const registerProvider: ExtensionAPI["registerProvider"] = (_providerId, config) => {
      if (config.api && config.streamSimple) registry.set(config.api, config.streamSimple)
    }

    await registerClinePassExtension(extensionApi(registerProvider), {
      fetcher,
      streamSimple: privateHandler,
    })

    expect(registry.get("openai-completions")).toBe(controlHandler)
    const installed = registry.get(CLINEPASS_API_ID)
    expect(installed).toBeDefined()
    const model = toClinePassModelConfig({
      id: "glm-5.2",
      upstreamId: "cline-pass/glm-5.2",
    })
    installed?.(model, { messages: [] })
    expect(capturedModel).toMatchObject({
      api: "openai-completions",
      id: "cline-pass/glm-5.2",
    })
  })
})
