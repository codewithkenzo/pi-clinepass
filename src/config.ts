import { homedir } from "node:os"
import { join } from "node:path"

export const CLINE_API_BASE_URL = "https://api.cline.bot"
export const CLINE_CHAT_URL = `${CLINE_API_BASE_URL}/api/v1/chat/completions`
export const CLINE_REFRESH_URL = `${CLINE_API_BASE_URL}/api/v1/auth/refresh`
export const CLINE_MODELS_URL = `${CLINE_API_BASE_URL}/api/v1/ai/cline/recommended-models`

export function defaultProviderSettingsPath(): string {
  return process.env.CLINE_PROVIDER_SETTINGS_PATH?.trim() || join(homedir(), ".cline", "data", "settings", "providers.json")
}
