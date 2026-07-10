import { streamSimple as streamOpenAICompletionsSimple } from "@codewithkenzo/pi-ai-runtime/api/openai-completions"
import type { Api, Context, Model, SimpleStreamOptions } from "@codewithkenzo/pi-ai-runtime"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Effect } from "effect"
import { CLINEPASS_BASE_URL } from "./config.js"
import { CLINEPASS_API_ID, CLINEPASS_PROVIDER_ID } from "./constants.js"
import {
  discoverClinePassModels,
  fallbackClinePassModels,
  toClinePassUpstreamModelId,
} from "./discovery.js"
import { createClinePassOAuthProvider } from "./pi-oauth.js"
import { handleClinePassError } from "./error-handler.js"

export const LIVE_MODEL_DISCOVERY_TIMEOUT = "5 seconds"

function withUpstreamModelId(model: Model<Api>): Model<"openai-completions"> {
  return { ...model, api: "openai-completions", id: toClinePassUpstreamModelId(model.id) }
}

function fallbackAfterDiscoveryFailure(detail: string) {
  process.stderr.write(
    `[pi-clinepass] Failed to fetch live ClinePass models; using fallback list. ${detail}\n`,
  )
  return Effect.succeed(fallbackClinePassModels())
}

export function loadClinePassModels(fetcher: typeof fetch = fetch) {
  return discoverClinePassModels(fetcher).pipe(
    Effect.timeout(LIVE_MODEL_DISCOVERY_TIMEOUT),
    Effect.catchTags({
      UpstreamError: (error) => fallbackAfterDiscoveryFailure(error.message),
      TimeoutError: () =>
        fallbackAfterDiscoveryFailure(`Discovery timed out after ${LIVE_MODEL_DISCOVERY_TIMEOUT}.`),
    }),
  )
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const models = await Effect.runPromise(loadClinePassModels())

  pi.registerProvider(CLINEPASS_PROVIDER_ID, {
    api: CLINEPASS_API_ID,
    baseUrl: CLINEPASS_BASE_URL,
    models,
    streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
      return streamOpenAICompletionsSimple(withUpstreamModelId(model), context, options)
    },
    oauth: createClinePassOAuthProvider(),
  })

  pi.on("message_end", (event, ctx) => handleClinePassError(event, ctx))
}
