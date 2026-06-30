import { openAICompletionsApi } from "@earendil-works/pi-ai/compat"
import { Effect } from "effect"
import { CLINEPASS_BASE_URL } from "./config.js"
import { CLINEPASS_PROVIDER_ID } from "./constants.js"
import { discoverClinePassModels, fallbackClinePassModels, toClinePassUpstreamModelId } from "./discovery.js"
import { createClinePassOAuthProvider } from "./pi-oauth.js"
import type { Api, Context, ExtensionAPI, Model, SimpleStreamOptions } from "./pi-types.js"

function withUpstreamModelId(model: Model<Api>): Model<"openai-completions"> {
  return { ...model, api: "openai-completions", id: toClinePassUpstreamModelId(model.id) }
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const { streamSimple: streamOpenAICompletionsSimple } = openAICompletionsApi()
  const models = await Effect.runPromise(
    discoverClinePassModels().pipe(
      Effect.catchTag("UpstreamError", (error) => {
        process.stderr.write(`[pi-clinepass] Failed to fetch live ClinePass models; using fallback list. ${error.message}\n`)
        return Effect.succeed(fallbackClinePassModels())
      }),
    ),
  )

  pi.registerProvider(CLINEPASS_PROVIDER_ID, {
    api: "openai-completions",
    baseUrl: CLINEPASS_BASE_URL,
    models,
    streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
      return streamOpenAICompletionsSimple(withUpstreamModelId(model) as never, context as never, options as never)
    },
    oauth: createClinePassOAuthProvider(),
  })
}
