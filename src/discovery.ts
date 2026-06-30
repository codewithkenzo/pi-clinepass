import { Clock, Effect } from "effect"
import { CLINE_MODELS_URL, CLINEPASS_BASE_URL, OPENROUTER_MODELS_URL } from "./config.js"
import {
  CLINE_CLIENT_HEADERS,
  CLINEPASS_COST,
  CLINEPASS_PROVIDER_ID,
  type ClinePassModelSpec,
  modelSpecsFor,
} from "./constants.js"
import { UpstreamError } from "./errors.js"
import type { Api, Model } from "./pi-types.js"

export interface RecommendedModelsResponse {
  clinePass?: Array<{ id: string; name?: string; description?: string }>
  [key: string]: unknown
}

export interface ClinePassModelEntry {
  readonly id: string
  readonly upstreamId: string
  readonly name?: string
  readonly description?: string
}

type PartialModelSpec = Partial<ClinePassModelSpec>
type ModelSpecsById = Readonly<Record<string, PartialModelSpec>>

const OPENROUTER_MODELS_CACHE_TTL_MS = 60 * 60 * 1000
let openRouterModelsCache: { readonly expiresAt: number; readonly payload: unknown } | undefined

const FALLBACK_MODELS: readonly ClinePassModelEntry[] = [
  { id: "glm-5.2", upstreamId: "cline-pass/glm-5.2", name: "GLM 5.2" },
  { id: "qwen3.7-max", upstreamId: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max" },
  { id: "qwen3.7-plus", upstreamId: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus" },
  { id: "kimi-k2.7-code", upstreamId: "cline-pass/kimi-k2.7-code", name: "Kimi K2.7 Code" },
  { id: "deepseek-v4-pro", upstreamId: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "deepseek-v4-flash", upstreamId: "cline-pass/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "minimax-m3", upstreamId: "cline-pass/minimax-m3", name: "MiniMax M3" },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function modelSlug(id: string): string {
  return id.split("/").at(-1) ?? id
}

export function toClinePassUpstreamModelId(id: string): string {
  return id.startsWith("cline-pass/") ? id : `cline-pass/${id}`
}

function normalizeEntry(value: unknown): ClinePassModelEntry | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined
  const upstreamId = value.id.trim()
  if (!upstreamId.startsWith("cline-pass/")) return undefined
  return {
    id: modelSlug(upstreamId),
    upstreamId,
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
  }
}

function uniqueModels(entries: readonly ClinePassModelEntry[]): ClinePassModelEntry[] {
  const seen = new Set<string>()
  const result: ClinePassModelEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    result.push(entry)
  }
  return result
}

function decodeJson<T>(response: Response, label: string) {
  return Effect.tryPromise({
    try: () => response.json() as Promise<T>,
    catch: (cause) => new UpstreamError({ message: `${label} returned invalid JSON`, status: response.status, cause }),
  })
}

export function parseClinePassModelEntries(payload: RecommendedModelsResponse): ClinePassModelEntry[] {
  const entries = Array.isArray(payload.clinePass) ? payload.clinePass : []
  return uniqueModels(entries.flatMap((entry) => {
    const normalized = normalizeEntry(entry)
    return normalized ? [normalized] : []
  }))
}

export function fetchClinePassModelEntries(fetcher: typeof fetch = fetch) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetcher(CLINE_MODELS_URL, { headers: { accept: "application/json" } }),
      catch: (cause) => new UpstreamError({ message: "Failed to fetch ClinePass model list", cause }),
    })
    const payload = yield* decodeJson<RecommendedModelsResponse>(response, "ClinePass model list")
    if (!response.ok) {
      return yield* Effect.fail(new UpstreamError({ message: `ClinePass model list failed with HTTP ${response.status}`, status: response.status }))
    }
    const models = parseClinePassModelEntries(payload)
    return models.length > 0 ? models : [...FALLBACK_MODELS]
  })
}

function openRouterSpecBySlug(value: unknown): readonly [string, PartialModelSpec] | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined
  const topProvider = isRecord(value.top_provider) ? value.top_provider : undefined
  const contextWindow = positiveNumber(value.context_length) ?? positiveNumber(topProvider?.context_length)
  const maxTokens = positiveNumber(topProvider?.max_completion_tokens)
  if (!contextWindow && !maxTokens) return undefined
  return [modelSlug(value.id), { ...(contextWindow ? { contextWindow } : {}), ...(maxTokens ? { maxTokens } : {}) }]
}

export function parseOpenRouterModelSpecs(payload: unknown, entries: readonly ClinePassModelEntry[]): ModelSpecsById {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return {}
  const bySlug = new Map<string, PartialModelSpec>()
  for (const value of payload.data) {
    const pair = openRouterSpecBySlug(value)
    if (pair) bySlug.set(pair[0], pair[1])
  }

  const specs: Record<string, PartialModelSpec> = {}
  for (const entry of entries) {
    const spec = bySlug.get(modelSlug(entry.upstreamId))
    if (spec) specs[entry.id] = spec
  }
  return specs
}

export function clearOpenRouterModelsCache(): void {
  openRouterModelsCache = undefined
}

function fetchOpenRouterModelsPayload(fetcher: typeof fetch) {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    if (openRouterModelsCache && openRouterModelsCache.expiresAt > now) {
      return openRouterModelsCache.payload
    }

    const response = yield* Effect.tryPromise({
      try: () => fetcher(OPENROUTER_MODELS_URL, { headers: { accept: "application/json" } }),
      catch: (cause) => new UpstreamError({ message: "Failed to fetch OpenRouter model list", cause }),
    })
    const payload = yield* decodeJson<unknown>(response, "OpenRouter model list")
    if (!response.ok) {
      return yield* Effect.fail(new UpstreamError({ message: `OpenRouter model list failed with HTTP ${response.status}`, status: response.status }))
    }

    openRouterModelsCache = { expiresAt: now + OPENROUTER_MODELS_CACHE_TTL_MS, payload }
    return payload
  })
}

export function fetchOpenRouterModelSpecs(entries: readonly ClinePassModelEntry[], fetcher: typeof fetch = fetch) {
  return fetchOpenRouterModelsPayload(fetcher).pipe(
    Effect.map((payload) => parseOpenRouterModelSpecs(payload, entries)),
  )
}

function isReasoningModel(id: string): boolean {
  const normalized = id.toLowerCase()
  return /glm|qwen|minimax|mimo|kimi|deepseek/.test(normalized)
}

function displayName(entry: ClinePassModelEntry): string {
  return entry.name?.trim() || entry.id
}

function mergeSpecs(entry: ClinePassModelEntry, discoveredSpecs: ModelSpecsById): ClinePassModelSpec {
  const staticSpecs = modelSpecsFor(entry.upstreamId)
  const discovered = discoveredSpecs[entry.id]
  return {
    contextWindow: discovered?.contextWindow ?? staticSpecs.contextWindow,
    maxTokens: discovered?.maxTokens ?? staticSpecs.maxTokens,
  }
}

export function toClinePassModelConfig(entry: ClinePassModelEntry, discoveredSpecs: ModelSpecsById = {}): Model<"openai-completions"> {
  const specs = mergeSpecs(entry, discoveredSpecs)
  return {
    id: entry.id,
    name: displayName(entry),
    provider: CLINEPASS_PROVIDER_ID,
    baseUrl: CLINEPASS_BASE_URL,
    api: "openai-completions",
    reasoning: isReasoningModel(entry.id),
    thinkingLevelMap: {
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "high",
    },
    input: ["text"],
    cost: { ...CLINEPASS_COST },
    contextWindow: specs.contextWindow,
    maxTokens: specs.maxTokens,
    headers: { ...CLINE_CLIENT_HEADERS },
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
      requiresToolResultName: false,
      supportsStrictMode: true,
      thinkingFormat: "together",
      cacheControlFormat: "anthropic",
      supportsLongCacheRetention: true,
    },
  }
}

export function buildClinePassModels(entries: readonly ClinePassModelEntry[], discoveredSpecs: ModelSpecsById = {}): Model<Api>[] {
  return uniqueModels(entries).map((entry) => toClinePassModelConfig(entry, discoveredSpecs))
}

export function discoverClinePassModels(fetcher: typeof fetch = fetch) {
  return Effect.gen(function* () {
    const entries = yield* fetchClinePassModelEntries(fetcher)
    const discoveredSpecs = yield* fetchOpenRouterModelSpecs(entries, fetcher).pipe(
      Effect.catchTag("UpstreamError", () => Effect.succeed({} satisfies ModelSpecsById)),
    )
    return buildClinePassModels(entries, discoveredSpecs)
  })
}

export function fallbackClinePassModels(): Model<Api>[] {
  return buildClinePassModels(FALLBACK_MODELS)
}
