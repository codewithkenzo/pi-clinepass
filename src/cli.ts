#!/usr/bin/env bun
import { Effect } from "effect"
import { ClineClient } from "./cline-client.ts"
import { serveProxy } from "./proxy.ts"
import { TokenStore } from "./token-store.ts"

function getArgValue(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}

function printHelp(): void {
  console.log(`clinepass-proxy commands:
  status
  models
  test --model cline-pass/glm-5.2
  serve --port 48752`)
}

function conciseError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

async function runStatus(store: TokenStore): Promise<void> {
  const status = await Effect.runPromise(store.status())
  console.log(JSON.stringify(status, null, 2))
}

async function runModels(client: ClineClient): Promise<void> {
  const models = await Effect.runPromise(client.listModels())
  for (const model of models) console.log(model)
}

async function runTest(client: ClineClient, args: string[]): Promise<void> {
  const model = getArgValue(args, "--model", "cline-pass/glm-5.2") ?? "cline-pass/glm-5.2"
  const result = await Effect.runPromise(client.nonStreamTest(model))
  const parsed = JSON.parse(result.body) as { data?: { choices?: Array<{ message?: { content?: string } }> } }
  const content = parsed.data?.choices?.[0]?.message?.content ?? ""
  console.log(JSON.stringify({ ok: true, status: result.status, model, content }, null, 2))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]
  const store = new TokenStore()
  const client = new ClineClient(store)

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp()
      return
    }
    if (command === "status") {
      await runStatus(store)
      return
    }
    if (command === "models") {
      await runModels(client)
      return
    }
    if (command === "test") {
      await runTest(client, args)
      return
    }
    if (command === "serve") {
      const portText = getArgValue(args, "--port", "48752") ?? "48752"
      const port = Number(portText)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${portText}`)
      }
      const server = serveProxy(port, client)
      console.log(`pi-clinepass proxy listening on ${server.url}`)
      await new Promise(() => undefined)
      return
    }
    throw new Error(`Unknown command: ${command}`)
  } catch (error) {
    console.error(`clinepass-proxy error: ${conciseError(error)}`)
    process.exitCode = 1
  }
}

await main()
