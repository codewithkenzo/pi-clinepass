import type { AssistantMessage } from "@codewithkenzo/pi-ai-runtime"
import type { ExtensionContext, ExtensionEvent } from "@earendil-works/pi-coding-agent"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { classifyClinePassError, handleClinePassError } from "../src/error-handler.ts"

type MessageEndEvent = Extract<ExtensionEvent, { type: "message_end" }>

const originalConsoleError = console.error

afterEach(() => {
  console.error = originalConsoleError
})

function errorEvent(overrides: Partial<AssistantMessage> = {}): MessageEndEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      api: "clinepass:openai-completions",
      provider: "clinepass",
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
      errorMessage: "upstream failed",
      timestamp: 0,
      ...overrides,
    },
  }
}

function extensionContext(notify: (message: string) => void): ExtensionContext {
  return { ui: { notify } } as unknown as ExtensionContext
}

describe("classifyClinePassError", () => {
  it("classifies forbidden and subscription errors as not subscribed", () => {
    expect(classifyClinePassError({ status: 403, message: "denied" })).toMatchObject({
      _tag: "ProviderError",
      type: "not_subscribed",
      status: 403,
      message: "ClinePass subscription required. Run /login to authenticate.",
    })
    expect(classifyClinePassError("subscription required").type).toBe("not_subscribed")
    expect(classifyClinePassError(new Error("Forbidden")).type).toBe("not_subscribed")
  })

  it("classifies unauthorized and invalid API key errors as auth expired", () => {
    expect(classifyClinePassError({ response: { status: "401" } })).toMatchObject({
      type: "auth_expired",
      status: 401,
      message: "ClinePass auth expired. Run /login to refresh.",
    })
    expect(classifyClinePassError("unauthorized").type).toBe("auth_expired")
    expect(classifyClinePassError({ code: "invalid_api_key" }).type).toBe("auth_expired")
  })

  it("classifies rate limit errors", () => {
    expect(classifyClinePassError({ status: 429 })).toMatchObject({
      type: "rate_limited",
      status: 429,
      message: "ClinePass rate limit reached. Wait or upgrade at app.cline.bot.",
    })
    expect(classifyClinePassError("rate_limit exceeded").type).toBe("rate_limited")
    expect(classifyClinePassError("Too Many Requests").type).toBe("rate_limited")
  })

  it("falls back to unknown without leaking upstream text", () => {
    expect(classifyClinePassError(new Error("secret upstream detail"))).toMatchObject({
      type: "unknown",
      message: "ClinePass request failed. Run /login or check subscription.",
    })
  })

  it("ignores unknown nested object fields instead of serializing them", () => {
    const error = {
      payload: { error: "invalid_api_key", token: "OBJECT_TOKEN_SENTINEL" },
      toJSON() {
        throw new Error("JSON serialization must not run")
      },
    }

    expect(classifyClinePassError(error)).toMatchObject({
      type: "unknown",
      message: "ClinePass request failed. Run /login or check subscription.",
    })
  })
})

describe("handleClinePassError", () => {
  it("prefers UI notification for ClinePass error messages", () => {
    const notify = mock(() => undefined)
    const consoleError = mock(() => undefined)
    console.error = consoleError

    handleClinePassError(
      errorEvent({ errorMessage: "HTTP 403 forbidden" }),
      extensionContext(notify),
    )

    expect(notify).toHaveBeenCalledWith(
      "ClinePass subscription required. Run /login to authenticate.",
    )
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("falls back to console.error without UI", () => {
    const consoleError = mock(() => undefined)
    console.error = consoleError

    handleClinePassError(errorEvent({ errorMessage: "HTTP 429 rate_limit" }))

    expect(consoleError).toHaveBeenCalledWith(
      "ClinePass rate limit reached. Wait or upgrade at app.cline.bot.",
    )
  })

  it("falls back to console.error when UI notification throws", () => {
    const consoleError = mock(() => undefined)
    console.error = consoleError

    handleClinePassError(
      errorEvent({ errorMessage: "HTTP 401" }),
      extensionContext(() => {
        throw new Error("UI unavailable")
      }),
    )

    expect(consoleError).toHaveBeenCalledWith("ClinePass auth expired. Run /login to refresh.")
  })

  it("ignores non-ClinePass providers and non-error stop reasons", () => {
    const notify = mock(() => undefined)
    const ctx = extensionContext(notify)

    handleClinePassError(errorEvent({ provider: "other" }), ctx)
    handleClinePassError(errorEvent({ stopReason: "stop" }), ctx)
    handleClinePassError(errorEvent({ errorMessage: undefined }), ctx)

    expect(notify).not.toHaveBeenCalled()
  })
})
