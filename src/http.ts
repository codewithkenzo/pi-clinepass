import { Effect } from "effect"

export interface JsonDecodeFailure {
  readonly message: string
  readonly status: number
}

/** Decode provider JSON without retaining response bodies or parser details. */
export function decodeJson<A, E>(
  response: Response,
  label: string,
  onFailure: (failure: JsonDecodeFailure) => E,
): Effect.Effect<A, E> {
  return Effect.tryPromise({
    try: () => response.json() as Promise<A>,
    catch: () =>
      onFailure({
        message: `${label} returned invalid JSON`,
        status: response.status,
      }),
  })
}
