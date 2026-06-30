import { Effect } from "effect"
import { CLINEPASS_BASE_URL } from "./config.js"
import { CLINEPASS_PROVIDER_ID } from "./constants.js"
import { discoverClinePassModels, fallbackClinePassModels, toClinePassUpstreamModelId } from "./discovery.js"
import { createClinePassOAuthProvider } from "./pi-oauth.js"
import type { Api, Context, ExtensionAPI, Model, SimpleStreamOptions, StreamSimpleFunction } from "./pi-types.js"

const PI_AI_COMPAT_MODULE = "@earendil-works/pi-ai" + "/compat"

type PiAiCompatModule = {
  readonly streamSimple: StreamSimpleFunction
}

function withUpstreamModelId(model: Model<Api>): Model<Api> {
  return { ...model, id: toClinePassUpstreamModelId(model.id) }
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const { streamSimple } = await import(PI_AI_COMPAT_MODULE) as PiAiCompatModule
  const models = await Effect.runPromise(
    discoverClinePassModels().pipe(
      Effect.catchTag("UpstreamError", (error) => {
        process.stderr.write(`[pi-clinepass] Failed to fetch live ClinePass models; using fallback list. ${error.message}\n`)
        return Effect.succeed(fallbackClinePassModels())
      }),
    ),
  )

  pi.registerProvider(CLINEPASS_PROVIDER_ID, {
    baseUrl: CLINEPASS_BASE_URL,
    models,
    streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
      return streamSimple(withUpstreamModelId(model), context, options)
    },
    oauth: createClinePassOAuthProvider(),
  })
}
