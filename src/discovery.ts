import type { Api, Model } from "@earendil-works/pi-ai"
import { Effect } from "effect"
import { CLINE_MODELS_URL } from "./config.js"
import {
  CLINE_CLIENT_HEADERS,
  CLINEPASS_BASE_URL,
  CLINEPASS_COST,
  CLINEPASS_DEFAULT_CONTEXT_WINDOW,
  CLINEPASS_DEFAULT_MAX_TOKENS,
  CLINEPASS_PROVIDER_ID,
} from "./constants.js"
import { UpstreamError } from "./errors.js"

export interface RecommendedModelsResponse {
  clinePass?: Array<{ id: string; name?: string; description?: string }>
  [key: string]: unknown
}

export interface ClinePassModelEntry {
  readonly id: string
  readonly name?: string
  readonly description?: string
}

const FALLBACK_MODELS: readonly ClinePassModelEntry[] = [
  { id: "cline-pass/glm-5.2", name: "cline-pass/glm-5.2" },
  { id: "cline-pass/qwen3.7-max", name: "cline-pass/qwen3.7-max" },
  { id: "cline-pass/qwen3.7-plus", name: "cline-pass/qwen3.7-plus" },
  { id: "cline-pass/kimi-k2.7-code", name: "cline-pass/kimi-k2.7-code" },
  { id: "cline-pass/deepseek-v4-pro", name: "cline-pass/deepseek-v4-pro" },
  { id: "cline-pass/deepseek-v4-flash", name: "cline-pass/deepseek-v4-flash" },
  { id: "cline-pass/minimax-m3", name: "cline-pass/minimax-m3" },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeEntry(value: unknown): ClinePassModelEntry | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined
  const id = value.id.trim()
  if (!id.startsWith("cline-pass/")) return undefined
  return {
    id,
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
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => new UpstreamError({ message: "Failed to read ClinePass model response", status: response.status, cause }),
    })
    if (!response.ok) {
      return yield* Effect.fail(new UpstreamError({ message: `ClinePass model list failed with HTTP ${response.status}`, status: response.status, body: text.slice(0, 500) }))
    }
    const payload = yield* Effect.try({
      try: () => JSON.parse(text) as RecommendedModelsResponse,
      catch: (cause) => new UpstreamError({ message: "ClinePass model list returned invalid JSON", status: response.status, cause }),
    })
    const models = parseClinePassModelEntries(payload)
    return models.length > 0 ? models : [...FALLBACK_MODELS]
  })
}

function isReasoningModel(id: string): boolean {
  const normalized = id.toLowerCase()
  return /glm|qwen|minimax|mimo|kimi|deepseek/.test(normalized)
}

function displayName(entry: ClinePassModelEntry): string {
  return entry.name?.trim() || entry.id
}

export function toClinePassModelConfig(entry: ClinePassModelEntry): Model<"openai-completions"> {
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
    contextWindow: CLINEPASS_DEFAULT_CONTEXT_WINDOW,
    maxTokens: CLINEPASS_DEFAULT_MAX_TOKENS,
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

export function buildClinePassModels(entries: readonly ClinePassModelEntry[]): Model<Api>[] {
  return uniqueModels(entries).map((entry) => toClinePassModelConfig(entry))
}

export function discoverClinePassModels(fetcher: typeof fetch = fetch) {
  return fetchClinePassModelEntries(fetcher).pipe(Effect.map(buildClinePassModels))
}

export function fallbackClinePassModels(): Model<Api>[] {
  return buildClinePassModels(FALLBACK_MODELS)
}
