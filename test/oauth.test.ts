import { afterEach, describe, expect, it, mock } from "bun:test"
import { Effect } from "effect"
import {
  createClinePassOAuthProvider,
  loginClinePass,
  refreshClinePassCredentials,
  withWorkosPrefix,
} from "../src/pi-oauth.ts"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
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
  })

  it("refreshes Cline OAuth credentials", async () => {
    const fetcher = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        refreshToken: "old-refresh",
        grantType: "refresh_token",
      })
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
    const onDeviceCode = mock(() => undefined)
    const onAuth = mock(() => undefined)

    const credentials = await Effect.runPromise(
      loginClinePass(
        {
          onDeviceCode,
          onAuth,
          onPrompt: async () => "",
          onSelect: async () => undefined,
          onProgress: mock(() => undefined),
        },
        fetcher,
      ),
    )

    expect(credentials).toMatchObject({
      access: "cline-access",
      refresh: "cline-refresh",
      accountId: "acct_2",
    })
    expect(onDeviceCode).toHaveBeenCalledWith({
      userCode: "USER-CODE",
      verificationUri: "https://authkit.cline.bot/device",
      intervalSeconds: 1,
      expiresInSeconds: 300,
    })
    const authCalls = onAuth.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(authCalls[0]?.[0]).toMatchObject({
      url: "https://authkit.cline.bot/device?user_code=USER-CODE",
    })
    expect(calls).toHaveLength(3)
  })
})
