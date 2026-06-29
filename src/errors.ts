import { Data } from "effect"

export class TokenFileError extends Data.TaggedError("TokenFileError")<{
  readonly message: string
  readonly path?: string
  readonly cause?: unknown
}> {}

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string
  readonly status?: number
  readonly cause?: unknown
}> {}

export class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly message: string
  readonly status?: number
  readonly body?: string
  readonly cause?: unknown
}> {}
