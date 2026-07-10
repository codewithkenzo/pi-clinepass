import { describe, expect, it, mock } from "bun:test"
import { Cause, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import {
  createClinePassOAuthProvider,
  loginClinePass,
  pollWorkOsDeviceToken,
  refreshClinePassCredentials,
  registerWorkOsTokens,
  startClineDeviceAuth,
  withWorkosPrefix,
} from "../src/pi-oauth.ts"

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function loginCallbacks(signal?: AbortSignal) {
  return {
    onDeviceCode: mock(() => undefined),
    onAuth: mock(() => undefined),
    onPrompt: async () => "",
    onSelect: async () => undefined,
    onProgress: mock(() => undefined),
    ...(signal ? { signal } : {}),
  }
}

async function testClockRun<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())))
}

function failureMessage<E>(exit: Exit.Exit<unknown, E>): string {
  expect(Exit.isFailure(exit)).toBe(true)
  return Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
}

describe("ClinePass Pi OAuth", () => {
  it("prefixes API key for Pi provider auth", () => {
    const oauth = createClinePassOAuthProvider()
    expect(withWorkosPrefix("abc")).toBe("workos:abc")
    expect(withWorkosPrefix("workos:abc")).toBe("workos:abc")
    expect(
      oauth.getApiKey({
        access: "access-token",
        refresh: "refresh-token",
        expires: Date.now() + 1000,
      }),
    ).toBe("workos:access-token")
    expect(() => oauth.getApiKey({ access: " ", refresh: "refresh-token", expires: 1 })).toThrow(
      "Stored ClinePass credentials are missing access token",
    )
  })

  it("fails device auth for HTTP errors and malformed success payloads", async () => {
    const denied = mock(async () =>
      jsonResponse({ error: "access_denied", error_description: "Device flow disabled" }, 403),
    ) as unknown as typeof fetch
    await expect(Effect.runPromise(startClineDeviceAuth(denied))).rejects.toMatchObject({
      _tag: "AuthError",
      message: "OAuth request failed with HTTP 403",
      status: 403,
    })

    const malformed = mock(async () =>
      jsonResponse({ device_code: "device" }),
    ) as unknown as typeof fetch
    await expect(Effect.runPromise(startClineDeviceAuth(malformed))).rejects.toMatchObject({
      _tag: "AuthError",
      message: "WorkOS device auth response missing required fields",
    })
  })

  for (const status of [401, 403, 429, 500, 503]) {
    it(`sanitizes OAuth HTTP ${status} failures across every endpoint`, async () => {
      const sentinel = `TOKEN_SENTINEL_${status}`
      const response = async () =>
        jsonResponse({ error: sentinel, error_description: `${sentinel}_description` }, status)
      const device = Effect.exit(startClineDeviceAuth(mock(response) as unknown as typeof fetch))
      const poll = Effect.exit(
        pollWorkOsDeviceToken({
          deviceCode: sentinel,
          expiresInSeconds: 30,
          intervalSeconds: 1,
          fetcher: mock(response) as unknown as typeof fetch,
        }),
      )
      const register = Effect.exit(
        registerWorkOsTokens(
          { access_token: sentinel, refresh_token: `${sentinel}_refresh` },
          mock(response) as unknown as typeof fetch,
        ),
      )
      const refresh = Effect.exit(
        refreshClinePassCredentials(
          { access: sentinel, refresh: `${sentinel}_refresh`, expires: 1 },
          mock(response) as unknown as typeof fetch,
        ),
      )

      const exits = await Promise.all([
        Effect.runPromise(device),
        Effect.runPromise(poll),
        Effect.runPromise(register),
        Effect.runPromise(refresh),
      ])
      for (const exit of exits) {
        const text = failureMessage(exit)
        expect(text).toContain(String(status))
        expect(text).not.toContain(sentinel)
      }
    })
  }

  it("sanitizes malformed JSON failures across every OAuth endpoint", async () => {
    const sentinel = "MALFORMED_TOKEN_SENTINEL"
    const malformed = mock(
      async () => new Response(`{${sentinel}`, { status: 200 }),
    ) as unknown as typeof fetch
    const exits = await Promise.all([
      Effect.runPromise(Effect.exit(startClineDeviceAuth(malformed))),
      Effect.runPromise(
        Effect.exit(
          pollWorkOsDeviceToken({
            deviceCode: sentinel,
            expiresInSeconds: 30,
            intervalSeconds: 1,
            fetcher: malformed,
          }),
        ),
      ),
      Effect.runPromise(
        Effect.exit(
          registerWorkOsTokens(
            { access_token: sentinel, refresh_token: `${sentinel}_refresh` },
            malformed,
          ),
        ),
      ),
      Effect.runPromise(
        Effect.exit(
          refreshClinePassCredentials(
            { access: sentinel, refresh: `${sentinel}_refresh`, expires: 1 },
            malformed,
          ),
        ),
      ),
    ])

    for (const exit of exits) {
      const text = failureMessage(exit)
      expect(text).toContain("invalid JSON")
      expect(text).not.toContain(sentinel)
    }
  })

  it("sanitizes rejected fetch causes across every OAuth endpoint", async () => {
    const sentinel = "REJECTED_TOKEN_SENTINEL"
    const rejected = mock(() => Promise.reject(new Error(sentinel))) as unknown as typeof fetch
    const exits = await Promise.all([
      Effect.runPromise(Effect.exit(startClineDeviceAuth(rejected))),
      Effect.runPromise(
        Effect.exit(
          pollWorkOsDeviceToken({
            deviceCode: sentinel,
            expiresInSeconds: 30,
            intervalSeconds: 1,
            fetcher: rejected,
          }),
        ),
      ),
      Effect.runPromise(
        Effect.exit(
          registerWorkOsTokens(
            { access_token: sentinel, refresh_token: `${sentinel}_refresh` },
            rejected,
          ),
        ),
      ),
      Effect.runPromise(
        Effect.exit(
          refreshClinePassCredentials(
            { access: sentinel, refresh: `${sentinel}_refresh`, expires: 1 },
            rejected,
          ),
        ),
      ),
    ])

    for (const exit of exits) {
      const text = failureMessage(exit)
      expect(text).not.toContain(sentinel)
    }
  })

  it("polls authorization_pending then succeeds using TestClock", async () => {
    let attempts = 0
    const fetcher = mock(async () => {
      attempts += 1
      return attempts === 1
        ? jsonResponse({ error: "authorization_pending" }, 400)
        : jsonResponse({ access_token: "access", refresh_token: "refresh" })
    }) as unknown as typeof fetch

    const tokens = await testClockRun(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          pollWorkOsDeviceToken({
            deviceCode: "device",
            expiresInSeconds: 30,
            intervalSeconds: 5,
            fetcher,
          }),
        )
        yield* Effect.yieldNow
        expect(attempts).toBe(1)
        yield* TestClock.adjust("5 seconds")
        return yield* Fiber.join(fiber)
      }),
    )

    expect(tokens).toMatchObject({ access_token: "access", refresh_token: "refresh" })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("increases polling interval by five seconds for slow_down", async () => {
    let attempts = 0
    const fetcher = mock(async () => {
      attempts += 1
      return attempts === 1
        ? jsonResponse({ error: "slow_down" }, 400)
        : jsonResponse({ access_token: "access", refresh_token: "refresh" })
    }) as unknown as typeof fetch

    const tokens = await testClockRun(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          pollWorkOsDeviceToken({
            deviceCode: "device",
            expiresInSeconds: 30,
            intervalSeconds: 1,
            fetcher,
          }),
        )
        yield* Effect.yieldNow
        yield* TestClock.adjust("5 seconds")
        expect(attempts).toBe(1)
        yield* TestClock.adjust("1 second")
        return yield* Fiber.join(fiber)
      }),
    )

    expect(tokens.access_token).toBe("access")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("expires polling without wall-clock delay via TestClock", async () => {
    const fetcher = mock(async () =>
      jsonResponse({ error: "authorization_pending" }, 400),
    ) as unknown as typeof fetch

    const exit = await testClockRun(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.exit(
            pollWorkOsDeviceToken({
              deviceCode: "device",
              expiresInSeconds: 2,
              intervalSeconds: 1,
              fetcher,
            }),
          ),
        )
        yield* Effect.yieldNow
        yield* TestClock.adjust("2 seconds")
        return yield* Fiber.join(fiber)
      }),
    )

    expect(failureMessage(exit)).toContain("WorkOS device authorization expired")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("cancels polling from an abort signal", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = mock(async () =>
      jsonResponse({ error: "unexpected" }, 500),
    ) as unknown as typeof fetch

    await expect(
      Effect.runPromise(
        pollWorkOsDeviceToken({
          deviceCode: "device",
          expiresInSeconds: 30,
          intervalSeconds: 1,
          callbacks: loginCallbacks(controller.signal),
          fetcher,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "AuthError", message: "ClinePass login cancelled" })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("fails WorkOS token registration on HTTP and token payload errors", async () => {
    const httpFailure = mock(async () => jsonResponse({}, 403)) as unknown as typeof fetch
    await expect(
      Effect.runPromise(
        registerWorkOsTokens(
          { access_token: "workos-access", refresh_token: "workos-refresh" },
          httpFailure,
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "AuthError",
      message: "Cline OAuth request failed with HTTP 403",
      status: 403,
    })

    const missingTokens = mock(async () =>
      jsonResponse({ success: true, data: { accessToken: "access" } }),
    ) as unknown as typeof fetch
    await expect(
      Effect.runPromise(
        registerWorkOsTokens(
          { access_token: "workos-access", refresh_token: "workos-refresh" },
          missingTokens,
        ),
      ),
    ).rejects.toMatchObject({ message: "Cline OAuth response missing tokens" })
  })

  it("refreshes Cline OAuth credentials", async () => {
    const fetcher = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toBe(
        JSON.stringify({ refreshToken: "old-refresh", grantType: "refresh_token" }),
      )
      return jsonResponse({
        success: true,
        data: {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresAt: "2030-01-01T00:00:00.000Z",
          userInfo: { clineUserId: "acct_1", email: "kenzo@example.com" },
        },
      })
    }) as unknown as typeof fetch

    const refreshed = await Effect.runPromise(
      refreshClinePassCredentials({ access: "old", refresh: "old-refresh", expires: 1 }, fetcher),
    )
    expect(refreshed).toMatchObject({
      access: "new-access",
      refresh: "new-refresh",
      accountId: "acct_1",
      email: "kenzo@example.com",
    })
    expect(refreshed.expires).toBeGreaterThan(Date.now())
  })

  it("fails credential refresh", async () => {
    const fetcher = mock(async () => jsonResponse({}, 401)) as unknown as typeof fetch
    await expect(
      Effect.runPromise(
        refreshClinePassCredentials({ access: "old", refresh: "old-refresh", expires: 1 }, fetcher),
      ),
    ).rejects.toMatchObject({
      _tag: "AuthError",
      message: "Cline OAuth request failed with HTTP 401",
      status: 401,
    })
  })

  it("runs device login through WorkOS then Cline register without exposing tokens", async () => {
    const calls: string[] = []
    const fetcher = mock(async (url: string | URL | Request) => {
      const text = url.toString()
      calls.push(text)
      if (text.includes("authorize/device")) {
        return jsonResponse({
          device_code: "device-code",
          user_code: "USER-CODE",
          verification_uri: "https://authkit.cline.bot/device",
          verification_uri_complete: "https://authkit.cline.bot/device?user_code=USER-CODE",
          expires_in: 300,
          interval: 1,
        })
      }
      if (text.includes("authenticate")) {
        return jsonResponse({ access_token: "workos-access", refresh_token: "workos-refresh" })
      }
      if (text.includes("auth/register")) {
        return jsonResponse({
          success: true,
          data: {
            accessToken: "cline-access",
            refreshToken: "cline-refresh",
            expiresAt: "2030-01-01T00:00:00.000Z",
            userInfo: { clineUserId: "acct_2" },
          },
        })
      }
      return jsonResponse({ error: "unexpected" }, 500)
    }) as unknown as typeof fetch
    const callbacks = loginCallbacks()

    const credentials = await Effect.runPromise(loginClinePass(callbacks, fetcher))

    expect(credentials).toMatchObject({
      access: "cline-access",
      refresh: "cline-refresh",
      accountId: "acct_2",
    })
    expect(callbacks.onDeviceCode).toHaveBeenCalledWith({
      userCode: "USER-CODE",
      verificationUri: "https://authkit.cline.bot/device",
      intervalSeconds: 1,
      expiresInSeconds: 300,
    })
    const authCalls = callbacks.onAuth.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(authCalls[0]?.[0]).toMatchObject({
      url: "https://authkit.cline.bot/device?user_code=USER-CODE",
    })
    expect(callbacks.onProgress).toHaveBeenCalledWith(
      "Waiting for ClinePass browser authorization...",
    )
    expect(calls).toHaveLength(3)
  })

  it("propagates registration failure after login callback delivery", async () => {
    const callbacks = loginCallbacks()
    let call = 0
    const fetcher = mock(async () => {
      call += 1
      if (call === 1) {
        return jsonResponse({
          device_code: "device",
          user_code: "CODE",
          verification_uri: "https://example.test/device",
        })
      }
      if (call === 2) return jsonResponse({ access_token: "access", refresh_token: "refresh" })
      return jsonResponse({}, 500)
    }) as unknown as typeof fetch

    await expect(Effect.runPromise(loginClinePass(callbacks, fetcher))).rejects.toMatchObject({
      status: 500,
      message: "Cline OAuth request failed with HTTP 500",
    })
    expect(callbacks.onDeviceCode).toHaveBeenCalledTimes(1)
    expect(callbacks.onAuth).toHaveBeenCalledTimes(1)
  })
})
