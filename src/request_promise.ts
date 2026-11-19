/** Result of `RequestPromise.safe()`: the value, or the error the request rejected with */
export type SafeResult<T> = [value: T, error: null] | [value: null, error: Error]

/** Ends a pending request */
interface Controls {
  /** Rejects the request with a `CanceledError`, the reason becomes its `cause` */
  cancel: (reason?: unknown) => void
  /** Rejects the request with a `TimeoutError` */
  timeout: () => void
}

/**
 * Promise of a request that can be canceled: `request.cancel()`.
 * `then`, `catch` and `finally` return a plain `Promise`, keep the request promise to cancel it.
 */
export class RequestPromise<T> extends Promise<T> {
  /** Ends the request until it settles */
  #controls?: Controls

  // derived promises are plain promises, they can't cancel the request
  static override get [Symbol.species]() {
    return Promise
  }

  /**
   * Creates a request promise of `promise`, ended by `controls` until it settles.
   * @internal
   */
  static create<T>(promise: PromiseLike<T>, controls: Controls): RequestPromise<T> {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void

    const result = new RequestPromise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    result.#controls = controls

    promise.then(
      (value) => {
        result.#controls = undefined
        resolve(value)
      },
      (error: unknown) => {
        result.#controls = undefined
        reject(error)
      },
    )

    return result
  }

  /**
   * Maps the value of a request promise, the result still ends the request.
   * @internal
   */
  static map<T, U>(source: RequestPromise<T>, fn: (value: T) => U): RequestPromise<U> {
    return RequestPromise.create(source.then(fn), {
      cancel: (reason) => source.cancel(reason),
      timeout: () => source.#controls?.timeout(),
    })
  }

  /** Cancels the request, it rejects with a `CanceledError`, whose `cause` is the reason. No-op once settled. */
  cancel(reason?: unknown): void {
    this.#controls?.cancel(reason)
  }

  /**
   * Rejects the request with a `TimeoutError` if it doesn't settle within `ms`, like `totalTimeout`.
   * Returns the same promise, so it can still be canceled.
   */
  timeout(ms: number): this {
    const timer = setTimeout(() => this.#controls?.timeout(), ms)
    const clear = () => clearTimeout(timer)

    this.then(clear, clear)

    return this
  }

  /**
   * Resolves to `[value, null]`, or `[null, error]` instead of rejecting.
   * The error is usually a `RequestError`, narrow it with `client.isError(error)`, an `error` hook may replace it.
   */
  safe(): Promise<SafeResult<T>> {
    return this.then(
      (value): SafeResult<T> => [value, null],
      (error: unknown): SafeResult<T> => [null, error as Error],
    )
  }

  /** @deprecated Use `safe()`. */
  result(): Promise<SafeResult<T>> {
    return this.safe()
  }
}
