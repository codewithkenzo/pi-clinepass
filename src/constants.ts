export const CLINEPASS_PROVIDER_ID = "clinepass"
export const CLINEPASS_DISPLAY_NAME = "ClinePass"
export const CLINEPASS_DEFAULT_CONTEXT_WINDOW = 128_000
export const CLINEPASS_DEFAULT_MAX_TOKENS = 8_192

export type ClinePassModelSpec = {
  readonly contextWindow: number
  readonly maxTokens: number
  readonly reasoning: boolean
}

/**
 * Static vendor-backed specs. Discovery also enriches future ClinePass models
 * from OpenRouter's public model catalog by slug, matching Cline's source pattern.
 * These entries win when OpenRouter omits max output tokens.
 *
 * Sources: z.ai/blog/glm-5.2, qwencloud.com, api-docs.deepseek.com,
 * platform.kimi.ai, minimax.io, openrouter.ai/api/v1/models
 */
export const CLINEPASS_MODEL_SPECS: Readonly<Record<string, ClinePassModelSpec>> = {
  "cline-pass/glm-5.2": { contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true },
  "cline-pass/qwen3.7-max": { contextWindow: 1_000_000, maxTokens: 65_536, reasoning: true },
  "cline-pass/qwen3.7-plus": { contextWindow: 1_000_000, maxTokens: 65_536, reasoning: true },
  "cline-pass/deepseek-v4-pro": { contextWindow: 1_048_576, maxTokens: 384_000, reasoning: true },
  "cline-pass/deepseek-v4-flash": {
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    reasoning: true,
  },
  "cline-pass/kimi-k2.7-code": { contextWindow: 262_144, maxTokens: 16_384, reasoning: true },
  "cline-pass/minimax-m3": { contextWindow: 1_048_576, maxTokens: 512_000, reasoning: true },
}

export function modelSpecsFor(id: string): ClinePassModelSpec {
  return (
    CLINEPASS_MODEL_SPECS[id] ?? {
      contextWindow: CLINEPASS_DEFAULT_CONTEXT_WINDOW,
      maxTokens: CLINEPASS_DEFAULT_MAX_TOKENS,
      reasoning: false,
    }
  )
}

export const CLINE_CLIENT_HEADERS = {
  "User-Agent": "Cline/4.0.0",
  "X-PLATFORM": "linux",
  "X-PLATFORM-VERSION": "unknown",
  "X-CLIENT-TYPE": "vscode",
  "X-CLIENT-VERSION": "4.0.0",
  "X-CORE-VERSION": "4.0.0",
} as const

export const CLINEPASS_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const
