import { Clock, Effect } from "effect"
import { CLINE_AUTH_REGISTER_URL, CLINE_REFRESH_URL, WORKOS_AUTHENTICATE_URL, WORKOS_CLIENT_ID, WORKOS_DEVICE_AUTH_URL } from "./config.js"
import { CLINEPASS_DISPLAY_NAME, CLINEPASS_PROVIDER_ID } from "./constants.js"
import { AuthError } from "./errors.js"
import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./pi-types.js"

const DEFAULT_EXPIRES_IN_SECONDS = 300
const DEFAULT_POLL_INTERVAL_SECONDS = 5
const REFRESH_FALLBACK_EXPIRES_MS = 60 * 60 * 1000

type DeviceAuthResponse = {
  device_code?: string
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
  error?: string
  error_description?: string
}

type WorkOsTokenResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  error?: string
  error_description?: string
}

type ClineTokenResponse = {
  success?: boolean
  data?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: string
    userInfo?: {
      clineUserId?: string | null
      email?: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
}

function expiresAtMs(value: string | undefined, nowMs: number): number {
  if (!value) return nowMs + REFRESH_FALLBACK_EXPIRES_MS
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : nowMs + REFRESH_FALLBACK_EXPIRES_MS
}

function withoutWorkosPrefix(token: string): string {
  return token.startsWith("workos:") ? token.slice("workos:".length) : token
}

export function withWorkosPrefix(token: string): string {
  return token.startsWith("workos:") ? token : `workos:${token}`
}

function credentialsFromClineResponse(payload: ClineTokenResponse, fallbackRefresh?: string): Effect.Effect<OAuthCredentials, AuthError> {
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    const access = payload.data?.accessToken
    const refresh = payload.data?.refreshToken ?? fallbackRefresh
    if (!payload.success || !access || !refresh) {
      return yield* Effect.fail(new AuthError({ message: "Cline OAuth response missing tokens" }))
    }
    return {
      access: withoutWorkosPrefix(access),
      refresh,
      expires: expiresAtMs(payload.data?.expiresAt, nowMs),
      accountId: payload.data?.userInfo?.clineUserId ?? undefined,
      email: payload.data?.userInfo?.email ?? undefined,
    }
  })
}

function decodeJson<T>(response: Response, label: string) {
  return Effect.tryPromise({
    try: () => response.json() as Promise<T>,
    catch: (cause) => new AuthError({ message: `${label} returned invalid JSON`, status: response.status, cause }),
  })
}

function postForm<T>(url: string, body: URLSearchParams, fetcher: typeof fetch) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetcher(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }),
      catch: (cause) => new AuthError({ message: "OAuth network request failed", cause }),
    })
    const payload = yield* decodeJson<T & { error?: string; error_description?: string }>(response, "OAuth request")
    if (!response.ok) {
      return yield* Effect.fail(new AuthError({ message: payload.error_description || payload.error || `OAuth request failed with HTTP ${response.status}`, status: response.status }))
    }
    return payload
  })
}

function postJson<T>(url: string, value: unknown, fetcher: typeof fetch) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }),
      catch: (cause) => new AuthError({ message: "Cline OAuth request failed", cause }),
    })
    const payload = yield* decodeJson<T>(response, "Cline OAuth request")
    if (!response.ok) {
      return yield* Effect.fail(new AuthError({ message: `Cline OAuth request failed with HTTP ${response.status}`, status: response.status }))
    }
    return payload
  })
}

export function startClineDeviceAuth(fetcher: typeof fetch = fetch) {
  return Effect.gen(function* () {
    const payload = yield* postForm<DeviceAuthResponse>(WORKOS_DEVICE_AUTH_URL, new URLSearchParams({ client_id: WORKOS_CLIENT_ID }), fetcher)
    if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
      return yield* Effect.fail(new AuthError({ message: "WorkOS device auth response missing required fields" }))
    }
    return {
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      verificationUriComplete: payload.verification_uri_complete ?? payload.verification_uri,
      expiresInSeconds: payload.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS,
      intervalSeconds: payload.interval ?? DEFAULT_POLL_INTERVAL_SECONDS,
    }
  })
}

function sleepSeconds(seconds: number) {
  return Effect.sleep(`${seconds} seconds`)
}

export function pollWorkOsDeviceToken(input: { deviceCode: string; expiresInSeconds: number; intervalSeconds: number; callbacks?: OAuthLoginCallbacks; fetcher?: typeof fetch }) {
  return Effect.gen(function* () {
    const fetcher = input.fetcher ?? fetch
    const startedAt = yield* Clock.currentTimeMillis
    const deadline = startedAt + input.expiresInSeconds * 1000
    let intervalSeconds = Math.max(1, input.intervalSeconds || DEFAULT_POLL_INTERVAL_SECONDS)

    while ((yield* Clock.currentTimeMillis) < deadline) {
      if (input.callbacks?.signal?.aborted) return yield* Effect.fail(new AuthError({ message: "ClinePass login cancelled" }))
      const response = yield* Effect.tryPromise({
        try: () => fetcher(WORKOS_AUTHENTICATE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: input.deviceCode,
            client_id: WORKOS_CLIENT_ID,
          }),
        }),
        catch: (cause) => new AuthError({ message: "WorkOS polling failed", cause }),
      })
      const payload = yield* decodeJson<WorkOsTokenResponse>(response, "WorkOS polling")
      if (response.ok) {
        if (!payload.access_token || !payload.refresh_token) {
          return yield* Effect.fail(new AuthError({ message: "WorkOS token response missing tokens", status: response.status }))
        }
        return payload
      }
      if (payload.error === "authorization_pending") {
        yield* sleepSeconds(intervalSeconds)
        continue
      }
      if (payload.error === "slow_down") {
        intervalSeconds += 5
        yield* sleepSeconds(intervalSeconds)
        continue
      }
      return yield* Effect.fail(new AuthError({ message: payload.error_description || payload.error || `WorkOS polling failed with HTTP ${response.status}`, status: response.status }))
    }

    return yield* Effect.fail(new AuthError({ message: "WorkOS device authorization expired" }))
  })
}

export function registerWorkOsTokens(tokens: WorkOsTokenResponse, fetcher: typeof fetch = fetch) {
  return postJson<ClineTokenResponse>(CLINE_AUTH_REGISTER_URL, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token }, fetcher).pipe(
    Effect.flatMap((payload) => credentialsFromClineResponse(payload)),
  )
}

export function refreshClinePassCredentials(credentials: OAuthCredentials, fetcher: typeof fetch = fetch) {
  return postJson<ClineTokenResponse>(CLINE_REFRESH_URL, { refreshToken: credentials.refresh, grantType: "refresh_token" }, fetcher).pipe(
    Effect.flatMap((payload) => credentialsFromClineResponse(payload, credentials.refresh)),
  )
}

export function loginClinePass(callbacks: OAuthLoginCallbacks, fetcher: typeof fetch = fetch) {
  return Effect.gen(function* () {
    const device = yield* startClineDeviceAuth(fetcher)
    callbacks.onDeviceCode({
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      intervalSeconds: device.intervalSeconds,
      expiresInSeconds: device.expiresInSeconds,
    })
    callbacks.onAuth({
      url: device.verificationUriComplete,
      instructions: `Open the Cline auth page and enter code ${device.userCode}`,
    })
    callbacks.onProgress?.("Waiting for ClinePass browser authorization...")
    const workos = yield* pollWorkOsDeviceToken({ ...device, callbacks, fetcher })
    return yield* registerWorkOsTokens(workos, fetcher)
  })
}

export function createClinePassOAuthProvider(options?: { modifyModels?: (models: Model<Api>[]) => Model<Api>[]; fetcher?: typeof fetch }): OAuthProviderInterface {
  const fetcher = options?.fetcher ?? fetch
  const modifyModels = options?.modifyModels
  return {
    id: CLINEPASS_PROVIDER_ID,
    name: CLINEPASS_DISPLAY_NAME,
    login: (callbacks) => Effect.runPromise(loginClinePass(callbacks, fetcher)),
    refreshToken: (credentials) => Effect.runPromise(refreshClinePassCredentials(credentials, fetcher)),
    getApiKey(credentials) {
      if (!credentials.access?.trim()) throw new AuthError({ message: "Stored ClinePass credentials are missing access token. Run /login again." })
      return withWorkosPrefix(credentials.access.trim())
    },
    ...(modifyModels
      ? {
          modifyModels(models: Model<Api>[]) {
            return modifyModels(models)
          },
        }
      : {}),
  }
}
