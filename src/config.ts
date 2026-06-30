import { homedir } from "node:os"
import { join } from "node:path"

const HTTPS_PROTOCOL = "https"
const CLINE_API_HOST = process.env.CLINE_API_HOST?.trim() || "api.cline.bot"
const OPENROUTER_API_HOST = process.env.OPENROUTER_API_HOST?.trim() || "openrouter.ai"
const WORKOS_API_HOST = process.env.WORKOS_API_HOST?.trim() || "api.workos.com"

export const CLINE_API_BASE_URL = `${HTTPS_PROTOCOL}://${CLINE_API_HOST}`
export const CLINEPASS_BASE_URL = `${CLINE_API_BASE_URL}/api/v1`
export const CLINE_CHAT_URL = `${CLINEPASS_BASE_URL}/chat/completions`
export const CLINE_REFRESH_URL = `${CLINEPASS_BASE_URL}/auth/refresh`
export const CLINE_AUTH_REGISTER_URL = `${CLINEPASS_BASE_URL}/auth/register`
export const CLINE_MODELS_URL = `${CLINEPASS_BASE_URL}/ai/cline/recommended-models`
export const OPENROUTER_MODELS_URL = `${HTTPS_PROTOCOL}://${OPENROUTER_API_HOST}/api/v1/models`

export const WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR"
export const WORKOS_DEVICE_AUTH_URL = `${HTTPS_PROTOCOL}://${WORKOS_API_HOST}/user_management/authorize/device`
export const WORKOS_AUTHENTICATE_URL = `${HTTPS_PROTOCOL}://${WORKOS_API_HOST}/user_management/authenticate`

export function defaultProviderSettingsPath(): string {
  return process.env.CLINE_PROVIDER_SETTINGS_PATH?.trim() || join(homedir(), ".cline", "data", "settings", "providers.json")
}
