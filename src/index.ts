import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Effect } from "effect"
import { CLINEPASS_BASE_URL } from "./config.js"
import { CLINEPASS_PROVIDER_ID } from "./constants.js"
import { discoverClinePassModels, fallbackClinePassModels } from "./discovery.js"
import { createClinePassOAuthProvider } from "./pi-oauth.js"

export default async function (pi: ExtensionAPI): Promise<void> {
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
    oauth: createClinePassOAuthProvider(),
  })
}
