import { Effect } from "effect"
import { CLINE_CHAT_URL, CLINE_MODELS_URL, CLINE_REFRESH_URL } from "./config.ts"
import { AuthError, UpstreamError } from "./errors.ts"
import { TokenStore } from "./token-store.ts"
import type { RecommendedModelsResponse, RefreshResponse, SelectedCredentials } from "./types.ts"

const REFRESH_BUFFER_MS = 5 * 60 * 1000

function parseExpiresAt(value?: string): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function withWorkosPrefix(token: string): string {
  return token.startsWith("workos:") ? token : `workos:${token}`
}

function needsRefresh(credentials: SelectedCredentials, force: boolean): boolean {
  if (force) return true
  if (!credentials.accessToken) return true
  if (typeof credentials.expiresAt !== "number") return true
  return credentials.expiresAt - Date.now() <= REFRESH_BUFFER_MS
}

function cloneHeaders(headers: Headers): Headers {
  const next = new Headers(headers)
  next.delete("host")
  next.delete("content-length")
  next.delete("authorization")
  return next
}

function parseJson<T>(text: string, error: AuthError | UpstreamError): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw error
  }
}

function toAuthError(cause: unknown, message: string): AuthError {
  return cause instanceof AuthError ? cause : new AuthError({ message, cause })
}

function toUpstreamError(cause: unknown, message: string): UpstreamError {
  return cause instanceof UpstreamError ? cause : new UpstreamError({ message, cause })
}

export class ClineClient {
  constructor(readonly tokenStore = new TokenStore()) {}

  async refreshAsync(credentials: SelectedCredentials): Promise<SelectedCredentials> {
    const response = await fetch(CLINE_REFRESH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: credentials.refreshToken, grantType: "refresh_token" }),
    })
    const text = await response.text()
    if (!response.ok) throw new AuthError({ message: `Cline refresh failed with HTTP ${response.status}`, status: response.status })

    const payload = parseJson<RefreshResponse>(
      text,
      new AuthError({ message: "Cline refresh returned invalid JSON", status: response.status }),
    )
    const accessToken = payload.data?.accessToken
    const refreshToken = payload.data?.refreshToken ?? credentials.refreshToken
    if (!payload.success || !accessToken || !refreshToken) {
      throw new AuthError({ message: "Cline refresh response did not include tokens", status: response.status })
    }
    return await this.tokenStore.updateCredentialsAsync(credentials.providerId, {
      accessToken,
      refreshToken,
      expiresAt: parseExpiresAt(payload.data?.expiresAt),
      accountId: payload.data?.userInfo?.clineUserId ?? credentials.accountId,
    })
  }

  refresh(credentials: SelectedCredentials) {
    return Effect.tryPromise({
      try: () => this.refreshAsync(credentials),
      catch: (cause) => toAuthError(cause, "Failed to refresh Cline token"),
    })
  }

  async getValidTokenAsync(options?: { forceRefresh?: boolean }): Promise<string> {
    const credentials = await this.tokenStore.readCredentialsAsync()
    const valid = needsRefresh(credentials, options?.forceRefresh === true) ? await this.refreshAsync(credentials) : credentials
    if (!valid.accessToken) throw new AuthError({ message: "Missing Cline access token after refresh" })
    return withWorkosPrefix(valid.accessToken)
  }

  getValidToken(options?: { forceRefresh?: boolean }) {
    return Effect.tryPromise({
      try: () => this.getValidTokenAsync(options),
      catch: (cause) => toAuthError(cause, "Failed to resolve Cline token"),
    })
  }

  async listModelsAsync(): Promise<string[]> {
    const response = await fetch(CLINE_MODELS_URL)
    const text = await response.text()
    if (!response.ok) {
      throw new UpstreamError({ message: `ClinePass models failed with HTTP ${response.status}`, status: response.status, body: text.slice(0, 500) })
    }
    const payload = parseJson<RecommendedModelsResponse>(
      text,
      new UpstreamError({ message: "ClinePass models returned invalid JSON", status: response.status }),
    )
    return (payload.clinePass ?? []).map((model) => model.id).filter((id) => id.startsWith("cline-pass/"))
  }

  listModels() {
    return Effect.tryPromise({
      try: () => this.listModelsAsync(),
      catch: (cause) => toUpstreamError(cause, "Failed to fetch ClinePass models"),
    })
  }

  async forwardChatAsync(body: unknown, headers: Headers): Promise<Response> {
    const token = await this.getValidTokenAsync()
    const upstreamHeaders = cloneHeaders(headers)
    upstreamHeaders.set("content-type", "application/json")
    const makeRequest = (bearer: string) => {
      const requestHeaders = new Headers(upstreamHeaders)
      requestHeaders.set("authorization", `Bearer ${bearer}`)
      return fetch(CLINE_CHAT_URL, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) })
    }
    let response = await makeRequest(token)
    if (response.status === 401) {
      const fresh = await this.getValidTokenAsync({ forceRefresh: true })
      response = await makeRequest(fresh)
    }
    return response
  }

  forwardChat(body: unknown, headers: Headers) {
    return Effect.tryPromise({
      try: () => this.forwardChatAsync(body, headers),
      catch: (cause) => toUpstreamError(cause, "Failed to forward chat request to Cline"),
    })
  }

  async nonStreamTestAsync(model: string): Promise<{ status: number; body: string }> {
    const token = await this.getValidTokenAsync({ forceRefresh: true })
    const response = await fetch(CLINE_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply exactly CLINEPASS_OK" }],
        stream: false,
        max_tokens: 20,
        reasoning: { enabled: false },
      }),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new UpstreamError({ message: `Cline test failed with HTTP ${response.status}`, status: response.status, body: text.slice(0, 500) })
    }
    return { status: response.status, body: text }
  }

  nonStreamTest(model: string) {
    return Effect.tryPromise({
      try: () => this.nonStreamTestAsync(model),
      catch: (cause) => toUpstreamError(cause, "Failed to call Cline test completion"),
    })
  }
}
