import { describe, expect, it } from "bun:test"
import { withDefaultReasoningSuppression } from "../src/proxy.ts"
import { redactToken, selectCredentials } from "../src/token-store.ts"

describe("withDefaultReasoningSuppression", () => {
  it("adds reasoning exclusion for cline-pass models", () => {
    expect(withDefaultReasoningSuppression({ model: "cline-pass/glm-5.2", messages: [] })).toEqual({
      model: "cline-pass/glm-5.2",
      messages: [],
      reasoning: { exclude: true },
    })
  })

  it("preserves explicit reasoning", () => {
    expect(withDefaultReasoningSuppression({ model: "cline-pass/glm-5.2", reasoning: { enabled: true } })).toEqual({
      model: "cline-pass/glm-5.2",
      reasoning: { enabled: true },
    })
  })

  it("does not mutate non ClinePass models", () => {
    expect(withDefaultReasoningSuppression({ model: "openai/gpt", messages: [] })).toEqual({ model: "openai/gpt", messages: [] })
  })
})

describe("token helpers", () => {
  it("selects cline before cline-pass", () => {
    const selected = selectCredentials({
      providers: {
        "cline-pass": { settings: { auth: { refreshToken: "pass-refresh" } } },
        cline: { settings: { auth: { refreshToken: "cline-refresh", accessToken: "cline-access" } } },
      },
    })
    expect(selected.providerId).toBe("cline")
    expect(selected.refreshToken).toBe("cline-refresh")
  })

  it("redacts tokens", () => {
    expect(redactToken("workos:abcdefghijklmnopqrstuvwxyz")).toBe("abcd…wxyz")
  })
})
