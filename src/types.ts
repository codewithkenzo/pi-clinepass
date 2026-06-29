export interface ProviderAuth {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
}

export interface ProviderSettings {
  provider?: string
  auth?: ProviderAuth
  [key: string]: unknown
}

export interface ProviderEntry {
  settings?: ProviderSettings
  updatedAt?: string
  tokenSource?: string
  [key: string]: unknown
}

export interface StoredProviders {
  version?: number
  lastUsedProvider?: string
  providers?: Record<string, ProviderEntry>
  [key: string]: unknown
}

export interface SelectedCredentials {
  providerId: "cline" | "cline-pass"
  accessToken?: string
  refreshToken: string
  expiresAt?: number
  accountId?: string
}

export interface RefreshResponse {
  success: boolean
  data?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: string
    userInfo?: {
      clineUserId?: string | null
      email?: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
}

export interface RecommendedModelsResponse {
  clinePass?: Array<{ id: string; name?: string; description?: string }>
  [key: string]: unknown
}
