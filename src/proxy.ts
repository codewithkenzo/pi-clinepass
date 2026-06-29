import { Effect } from "effect"
import { ClineClient } from "./cline-client.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function withDefaultReasoningSuppression(body: unknown): unknown {
  if (!isRecord(body)) return body
  const model = body.model
  if (typeof model !== "string" || !model.startsWith("cline-pass/")) return body
  if (Object.prototype.hasOwnProperty.call(body, "reasoning")) return body
  return { ...body, reasoning: { exclude: true } }
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, { status })
}

function modelListResponse(models: string[]): Response {
  return jsonResponse({
    object: "list",
    data: models.map((id) => ({ id, object: "model", created: 0, owned_by: "clinepass" })),
  })
}

function toProxyResponse(upstream: Response): Response {
  const headers = new Headers(upstream.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
}

export function createProxyHandler(client = new ClineClient()) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse({ ok: true, service: "pi-clinepass" })
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      const models = await Effect.runPromise(client.listModels())
      return modelListResponse(models)
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      let parsed: unknown
      try {
        parsed = await request.json()
      } catch {
        return errorResponse("Invalid JSON body", 400)
      }
      const body = withDefaultReasoningSuppression(parsed)
      const upstream = await Effect.runPromise(client.forwardChat(body, request.headers))
      return toProxyResponse(upstream)
    }

    return errorResponse("Not found", 404)
  }
}

export function serveProxy(port: number, client = new ClineClient()) {
  const handler = createProxyHandler(client)
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: handler,
  })
}
