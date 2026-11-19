import type { Client, PluginObject } from '../client.js'

export interface RateLimitOptions {
  /** Most attempts that may start per `interval` */
  limit: number
  /** Length of the window in milliseconds, e.g. `60_000` for a limit per minute */
  interval: number
}

/** Resolves after `ms`, rejects with the signal's reason as soon as it aborts */
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Lets at most `limit` attempts start per `interval` (a sliding window), the rest wait in order.
 * Retries count, as every attempt runs the `request` hooks. The wait counts against `totalTimeout`, not `timeout`,
 * and a canceled request leaves the queue right away.
 *
 * The state lives in the instance: install the same one on several clients to share the limit.
 * It's per process, use a shared store (e.g. Redis) to limit several instances of an app.
 *
 * ```ts
 * const limiter = new RateLimit({ limit: 100, interval: 60_000 })
 * const api = createClient({ url, plugins: [limiter] })
 * ```
 */
export class RateLimit implements PluginObject {
  readonly limit: number
  readonly interval: number

  /** Start times of the attempts in the current window, oldest first, at most `limit` */
  #started: number[] = []
  #queue = Promise.resolve()
  #pending = 0

  constructor(options: RateLimitOptions) {
    const { limit, interval } = options

    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError(`rateLimit: limit must be a positive integer, got ${limit}.`)
    }

    if (!(interval > 0)) {
      throw new TypeError(`rateLimit: interval must be a positive number, got ${interval}.`)
    }

    this.limit = limit
    this.interval = interval
  }

  /** Number of attempts waiting for their turn */
  get pending(): number {
    return this.#pending
  }

  install(client: Client<any>): void {
    client.on('request', (_config, state) => this.acquire(state.signal))
  }

  /** Waits until an attempt may start, in order, rejects with the signal's reason when it aborts */
  private acquire(signal: AbortSignal): Promise<void> {
    this.#pending++

    // one attempt decides at a time, so the order is kept, a rejected one doesn't stop the queue
    const turn = this.#queue
      .then(() => this.take(signal))
      .finally(() => this.#pending--)

    this.#queue = turn.catch(() => undefined)

    return turn
  }

  private async take(signal: AbortSignal) {
    while (true) {
      signal.throwIfAborted()

      const now = Date.now()

      while (this.#started.length > 0 && this.#started[0]! <= now - this.interval) {
        this.#started.shift()
      }

      if (this.#started.length < this.limit) {
        this.#started.push(now)
        return
      }

      await wait(this.#started[0]! + this.interval - now, signal)
    }
  }
}

/** Creates a `RateLimit` plugin, see `RateLimit` */
export function rateLimit(options: RateLimitOptions): RateLimit {
  return new RateLimit(options)
}
