import type { ExtensionContext, ExtensionEvent } from "@earendil-works/pi-coding-agent"
import { CLINEPASS_PROVIDER_ID } from "./constants.js"
import { ProviderError } from "./errors.js"

type MessageEndEvent = Extract<ExtensionEvent, { type: "message_end" }>

const USER_MESSAGES = {
  not_subscribed: "ClinePass subscription required. Run /login to authenticate.",
  auth_expired: "ClinePass auth expired. Run /login to refresh.",
  rate_limited: "ClinePass rate limit reached. Wait or upgrade at app.cline.bot.",
  unknown: "ClinePass request failed. Run /login or check subscription.",
} as const

type ErrorRecord = Record<string, unknown>

function asRecord(value: unknown): ErrorRecord | undefined {
  return typeof value === "object" && value !== null ? (value as ErrorRecord) : undefined
}

function statusFromValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value)
  return undefined
}

function statusFromError(error: unknown, text: string): number | undefined {
  const record = asRecord(error)
  const directStatus = statusFromValue(record?.status)
  if (directStatus !== undefined) return directStatus

  const responseStatus = statusFromValue(asRecord(record?.response)?.status)
  if (responseStatus !== undefined) return responseStatus

  const match = text.match(/\b(401|403|429)\b/)
  return match ? Number(match[1]) : undefined
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return `${error.name} ${error.message}`

  const record = asRecord(error)
  if (!record) return String(error)

  const fields = [record.message, record.errorMessage, record.body, record.code]
    .filter(
      (value): value is string | number => typeof value === "string" || typeof value === "number",
    )
    .join(" ")

  try {
    return `${fields} ${JSON.stringify(error)}`
  } catch {
    return fields
  }
}

/** Classify provider failures without exposing upstream error text to users. */
export function classifyClinePassError(error: unknown): ProviderError {
  const text = errorText(error)
  const normalized = text.toLowerCase()
  const status = statusFromError(error, text)

  if (status === 403 || /\bforbidden\b|\bsubscription\b/.test(normalized)) {
    return new ProviderError({
      message: USER_MESSAGES.not_subscribed,
      status,
      type: "not_subscribed",
    })
  }

  if (status === 401 || /\bunauthorized\b|invalid[_ -]?api[_ -]?key/.test(normalized)) {
    return new ProviderError({
      message: USER_MESSAGES.auth_expired,
      status,
      type: "auth_expired",
    })
  }

  if (status === 429 || /rate[_ -]?limit|too many requests/.test(normalized)) {
    return new ProviderError({
      message: USER_MESSAGES.rate_limited,
      status,
      type: "rate_limited",
    })
  }

  return new ProviderError({ message: USER_MESSAGES.unknown, status, type: "unknown" })
}

function reportError(message: string, ctx?: ExtensionContext): void {
  try {
    if (ctx?.ui?.notify) {
      ctx.ui.notify(message)
      return
    }
  } catch {
    // Fall through to stderr when UI notification is unavailable or fails.
  }

  try {
    console.error(message)
  } catch {
    try {
      process.stderr.write(`${message}\n`)
    } catch {
      // Error reporting must never interrupt message lifecycle handling.
    }
  }
}

/** Surface ClinePass request errors from Pi's finalized assistant messages. */
export function handleClinePassError(event: MessageEndEvent, ctx?: ExtensionContext): void {
  try {
    const message = event?.message
    if (
      event?.type !== "message_end" ||
      message?.role !== "assistant" ||
      message.provider !== CLINEPASS_PROVIDER_ID ||
      message?.stopReason !== "error" ||
      !message.errorMessage
    ) {
      return
    }

    reportError(classifyClinePassError(message.errorMessage).message, ctx)
  } catch {
    // Do not throw from lifecycle handlers, even when malformed event data arrives.
  }
}
