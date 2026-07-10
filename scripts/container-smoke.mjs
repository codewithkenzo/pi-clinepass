import { spawn } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

const piBin = process.env.PI_BIN
const extensionEntry = process.env.EXTENSION_ENTRY
if (!piBin || !extensionEntry) throw new Error("PI_BIN and EXTENSION_ENTRY are required")

const home = await mkdtemp(join(tmpdir(), "pi-clinepass-smoke-home-"))
const baseEnv = {
  ...process.env,
  HOME: home,
  NO_COLOR: "1",
  TERM: "dumb",
  CLINE_API_HOST: "127.0.0.1:9",
  OPENROUTER_API_HOST: "127.0.0.1:9",
  WORKOS_API_HOST: "127.0.0.1:9",
}

function runPi(args, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(piBin, args, { env: baseEnv, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`Pi smoke timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, output: `${stdout}\n${stderr}` })
    })
  })
}

const commonArgs = ["--no-session", "--no-extensions", "-e", extensionEntry]
const noAuth = await runPi([
  ...commonArgs,
  "--model",
  "clinepass/glm-5.2",
  "-p",
  "Reply exactly NO_AUTH_SHOULD_NOT_STREAM",
])
if (!noAuth.output.includes("No API key found for clinepass")) {
  throw new Error(`No-auth smoke returned wrong failure (${noAuth.code}):\n${noAuth.output}`)
}
for (const forbidden of [
  "Unknown provider",
  "Unknown API",
  "Unknown model",
  "Cannot find module",
  "ERR_MODULE_NOT_FOUND",
  "Failed to load extension",
]) {
  if (noAuth.output.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`No-auth smoke hit forbidden failure ${forbidden}:\n${noAuth.output}`)
  }
}
process.stdout.write("No-auth ClinePass registration smoke passed.\n")

if (process.env.SMOKE_MODE === "noauth") process.exit(0)

let capturedModel
const server = createServer((request, response) => {
  let body = ""
  request.setEncoding("utf8")
  request.on("data", (chunk) => {
    body += chunk
  })
  request.on("end", () => {
    try {
      const payload = JSON.parse(body)
      capturedModel = payload.model
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      response.write(
        `data: ${JSON.stringify({
          id: "control-stream",
          object: "chat.completion.chunk",
          created: 1,
          model: "sentinel-control-model",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "CONTROL_SENTINEL" },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({
          id: "control-stream",
          object: "chat.completion.chunk",
          created: 1,
          model: "sentinel-control-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })}\n\n`,
      )
      response.end("data: [DONE]\n\n")
    } catch (error) {
      response.writeHead(500).end(String(error))
    }
  })
})
await new Promise((resolve, reject) => {
  server.once("error", reject)
  server.listen(0, "127.0.0.1", resolve)
})
const address = server.address()
if (!address || typeof address === "string") throw new Error("Loopback server address unavailable")
const controlExtension = join(home, "control-extension.mjs")
await writeFile(
  controlExtension,
  `export default function (pi) {
  pi.registerProvider("control", {
    api: "openai-completions",
    apiKey: "control-key",
    baseUrl: "http://127.0.0.1:${address.port}/v1",
    models: [{
      id: "sentinel-control-model",
      name: "Sentinel Control",
      api: "openai-completions",
      provider: "control",
      baseUrl: "http://127.0.0.1:${address.port}/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 256
    }]
  })
}
`,
)

try {
  const control = await runPi([
    ...commonArgs,
    "-e",
    controlExtension,
    "--model",
    "control/sentinel-control-model",
    "--api-key",
    "control-key",
    "-p",
    "Reply with control sentinel",
  ])
  if (control.code !== 0 || !control.output.includes("CONTROL_SENTINEL")) {
    throw new Error(`Control SSE smoke failed (${control.code}):\n${control.output}`)
  }
  if (capturedModel !== "sentinel-control-model") {
    throw new Error(`Control model mutated: ${JSON.stringify(capturedModel)}`)
  }
  if (String(capturedModel).includes("cline-pass/")) {
    throw new Error(`Control model received ClinePass prefix: ${String(capturedModel)}`)
  }
  process.stdout.write("Loopback openai-completions control smoke passed.\n")
} finally {
  await new Promise((resolve) => server.close(resolve))
}
