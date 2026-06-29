import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Effect } from "effect"
import { defaultProviderSettingsPath } from "./config.ts"
import { TokenFileError } from "./errors.ts"
import type { ProviderAuth, SelectedCredentials, StoredProviders } from "./types.ts"

const PROVIDER_ORDER = ["cline", "cline-pass"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseStoredProviders(raw: string, path: string): StoredProviders {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) throw new Error("providers.json root is not object")
    return parsed as StoredProviders
  } catch (cause) {
    throw new TokenFileError({ message: "Failed to parse Cline providers.json", path, cause })
  }
}

function getProviderAuth(state: StoredProviders, providerId: "cline" | "cline-pass"): ProviderAuth | undefined {
  return state.providers?.[providerId]?.settings?.auth
}

export function redactToken(value?: string): string {
  if (!value) return "missing"
  const normalized = value.startsWith("workos:") ? value.slice("workos:".length) : value
  if (normalized.length <= 10) return "present:redacted"
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`
}

export function selectCredentials(state: StoredProviders): SelectedCredentials {
  for (const providerId of PROVIDER_ORDER) {
    const auth = getProviderAuth(state, providerId)
    if (auth?.refreshToken) {
      return {
        providerId,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: auth.expiresAt,
        accountId: auth.accountId,
      }
    }
  }
  throw new TokenFileError({ message: "No Cline OAuth refresh token found in providers.json" })
}

export interface TokenStoreStatus {
  path: string
  providerId?: string
  hasAccessToken: boolean
  hasRefreshToken: boolean
  expiresAt?: number
  isExpired: boolean
  accessTokenRedacted: string
}

export class TokenStore {
  constructor(readonly path = defaultProviderSettingsPath()) {}

  async readStateAsync(): Promise<StoredProviders> {
    try {
      return parseStoredProviders(await readFile(this.path, "utf8"), this.path)
    } catch (cause) {
      if (cause instanceof TokenFileError) throw cause
      throw new TokenFileError({ message: "Failed to read Cline providers.json", path: this.path, cause })
    }
  }

  readState() {
    return Effect.tryPromise({
      try: () => this.readStateAsync(),
      catch: (cause) => (cause instanceof TokenFileError ? cause : new TokenFileError({ message: "Failed to read Cline providers.json", path: this.path, cause })),
    })
  }

  async writeStateAsync(state: StoredProviders): Promise<void> {
    const body = `${JSON.stringify(state, null, 2)}\n`
    const dir = dirname(this.path)
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(tmp, body, { mode: 0o600 })
      await chmod(tmp, 0o600)
      await rename(tmp, this.path)
      await chmod(this.path, 0o600)
    } catch (cause) {
      throw new TokenFileError({ message: "Failed to write Cline providers.json", path: this.path, cause })
    }
  }

  writeState(state: StoredProviders) {
    return Effect.tryPromise({
      try: () => this.writeStateAsync(state),
      catch: (cause) => (cause instanceof TokenFileError ? cause : new TokenFileError({ message: "Failed to write Cline providers.json", path: this.path, cause })),
    })
  }

  async readCredentialsAsync(): Promise<SelectedCredentials> {
    return selectCredentials(await this.readStateAsync())
  }

  readCredentials() {
    return Effect.tryPromise({
      try: () => this.readCredentialsAsync(),
      catch: (cause) => (cause instanceof TokenFileError ? cause : new TokenFileError({ message: "Failed to read Cline credentials", path: this.path, cause })),
    })
  }

  async statusAsync(): Promise<TokenStoreStatus> {
    const state = await this.readStateAsync()
    try {
      const selected = selectCredentials(state)
      const expiresAt = selected.expiresAt
      return {
        path: this.path,
        providerId: selected.providerId,
        hasAccessToken: Boolean(selected.accessToken),
        hasRefreshToken: Boolean(selected.refreshToken),
        expiresAt,
        isExpired: typeof expiresAt === "number" ? Date.now() >= expiresAt : true,
        accessTokenRedacted: redactToken(selected.accessToken),
      }
    } catch {
      return {
        path: this.path,
        hasAccessToken: false,
        hasRefreshToken: false,
        isExpired: true,
        accessTokenRedacted: "missing",
      }
    }
  }

  status() {
    return Effect.tryPromise({
      try: () => this.statusAsync(),
      catch: (cause) => (cause instanceof TokenFileError ? cause : new TokenFileError({ message: "Failed to read Cline credential status", path: this.path, cause })),
    })
  }

  async updateCredentialsAsync(
    providerId: "cline" | "cline-pass",
    auth: Required<Pick<ProviderAuth, "accessToken" | "refreshToken">> & Pick<ProviderAuth, "expiresAt" | "accountId">,
  ): Promise<SelectedCredentials> {
    const state = await this.readStateAsync()
    const providers = state.providers ?? {}
    const existingEntry = providers[providerId] ?? {}
    const existingSettings = existingEntry.settings ?? { provider: providerId }
    const existingAuth = existingSettings.auth ?? {}
    const nextState: StoredProviders = {
      ...state,
      providers: {
        ...providers,
        [providerId]: {
          ...existingEntry,
          settings: {
            ...existingSettings,
            provider: providerId,
            auth: {
              ...existingAuth,
              accessToken: auth.accessToken,
              refreshToken: auth.refreshToken,
              ...(auth.expiresAt !== undefined ? { expiresAt: auth.expiresAt } : {}),
              ...(auth.accountId ? { accountId: auth.accountId } : {}),
            },
          },
          updatedAt: new Date().toISOString(),
          tokenSource: existingEntry.tokenSource ?? "oauth",
        },
      },
    }
    await this.writeStateAsync(nextState)
    return selectCredentials(nextState)
  }

  updateCredentials(
    providerId: "cline" | "cline-pass",
    auth: Required<Pick<ProviderAuth, "accessToken" | "refreshToken">> & Pick<ProviderAuth, "expiresAt" | "accountId">,
  ) {
    return Effect.tryPromise({
      try: () => this.updateCredentialsAsync(providerId, auth),
      catch: (cause) => (cause instanceof TokenFileError ? cause : new TokenFileError({ message: "Failed to update Cline credentials", path: this.path, cause })),
    })
  }
}
