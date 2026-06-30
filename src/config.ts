import { homedir } from "node:os"
import { join } from "node:path"

export const CLINE_API_BASE_URL = "https://api.cline.bot"
export const CLINE_CHAT_URL = `${CLINE_API_BASE_URL}/api/v1/chat/completions`
export const CLINE_REFRESH_URL = `${CLINE_API_BASE_URL}/api/v1/auth/refresh`
export const CLINE_AUTH_REGISTER_URL = `${CLINE_API_BASE_URL}/api/v1/auth/register`
export const CLINE_MODELS_URL = `${CLINE_API_BASE_URL}/api/v1/ai/cline/recommended-models`
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

export const WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR"
export const WORKOS_DEVICE_AUTH_URL = "https://api.workos.com/user_management/authorize/device"
export const WORKOS_AUTHENTICATE_URL = "https://api.workos.com/user_management/authenticate"

export function defaultProviderSettingsPath(): string {
  return process.env.CLINE_PROVIDER_SETTINGS_PATH?.trim() || join(homedir(), ".cline", "data", "settings", "providers.json")
}
