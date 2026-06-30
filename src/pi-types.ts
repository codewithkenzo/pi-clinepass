export type Api = "openai-completions" | (string & {})

export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh"
export type ModelThinkingLevel = "off" | ThinkingLevel

export type TextContent = { readonly type: "text"; readonly text: string }
export type ImageContent = { readonly type: "image"; readonly data: string; readonly mimeType: string }
export type ThinkingContent = { readonly type: "thinking"; readonly thinking: string; readonly thinkingSignature?: string }
export type ToolCall = { readonly type: "toolCall"; readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> }
export type Message = { readonly role: string; readonly content?: unknown; readonly [key: string]: unknown }
export type Tool = { readonly name: string; readonly description: string; readonly parameters: unknown }

export type Context = {
  readonly systemPrompt?: string
  readonly messages: Message[]
  readonly tools?: Tool[]
}

export type SimpleStreamOptions = Record<string, unknown>
export type AssistantMessageEventStream = unknown

export type Model<TApi extends Api = Api> = {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly baseUrl: string
  readonly api: TApi
  readonly reasoning?: boolean
  readonly thinkingLevelMap?: Partial<Record<ModelThinkingLevel, string | null>>
  readonly input?: readonly string[]
  readonly cost?: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number }
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly headers?: Record<string, string>
  readonly compat?: Record<string, unknown>
}

export type StreamSimpleFunction = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream

export type OAuthCredentials = {
  readonly refresh: string
  readonly access: string
  readonly expires: number
  readonly [key: string]: unknown
}

export type OAuthDeviceCodeInfo = {
  readonly userCode: string
  readonly verificationUri: string
  readonly intervalSeconds?: number
  readonly expiresInSeconds?: number
}

export type OAuthAuthInfo = {
  readonly url: string
  readonly instructions?: string
}

export type OAuthPrompt = {
  readonly message: string
  readonly placeholder?: string
  readonly allowEmpty?: boolean
}

export type OAuthSelectPrompt = {
  readonly message: string
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>
}

export type OAuthLoginCallbacks = {
  readonly onAuth: (info: OAuthAuthInfo) => void
  readonly onDeviceCode: (info: OAuthDeviceCodeInfo) => void
  readonly onPrompt: (prompt: OAuthPrompt) => Promise<string>
  readonly onProgress?: (message: string) => void
  readonly onManualCodeInput?: () => Promise<string>
  readonly onSelect: (prompt: OAuthSelectPrompt) => Promise<string | undefined>
  readonly signal?: AbortSignal
}

export type OAuthProviderInterface = {
  readonly id: string
  readonly name: string
  readonly login: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>
  readonly usesCallbackServer?: boolean
  readonly refreshToken: (credentials: OAuthCredentials) => Promise<OAuthCredentials>
  readonly getApiKey: (credentials: OAuthCredentials) => string
  readonly modifyModels?: (models: Model<Api>[], credentials: OAuthCredentials) => Model<Api>[]
}

export type ProviderConfig = {
  readonly baseUrl: string
  readonly models: Model<Api>[]
  readonly streamSimple?: StreamSimpleFunction
  readonly oauth?: OAuthProviderInterface
}

export type ExtensionAPI = {
  readonly registerProvider: (providerId: string, config: ProviderConfig) => void
}
