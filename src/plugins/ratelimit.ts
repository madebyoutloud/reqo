import type { Client, PluginObject } from '../client.js'

export interface RateLimitOptions {
  /** Most attempts that may start per `interval` */
  limit: number
  /** Length of the window in milliseconds, e.g. `60_000` for a limit per minute */
  interval: number
}

/** An attempt waiting for its turn */
interface Waiter {
  resolve: () => void
  signal: AbortSignal
  onAbort: () => void
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
  /** Attempts waiting for their turn, in order */
  #waiters: Waiter[] = []
  /** Wakes the waiters when the oldest attempt leaves the window */
  #timer?: ReturnType<typeof setTimeout>

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
    return this.#waiters.length
  }

  install(client: Client<any>): void {
    client.on('request', (_config, state) => this.acquire(state.signal))
  }

  /** Waits until an attempt may start, in order, rejects with the signal's reason as soon as it aborts */
  private acquire(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }

      const waiter: Waiter = {
        resolve,
        signal,
        // leaves the queue right away, wherever it is in it
        onAbort: () => {
          this.#waiters.splice(this.#waiters.indexOf(waiter), 1)
          reject(signal.reason)

          if (this.#waiters.length === 0) {
            clearTimeout(this.#timer)
          }
        },
      }

      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.#waiters.push(waiter)
      this.drain()
    })
  }

  /** Starts as many waiters as the window allows, then waits for the oldest attempt to leave it */
  private drain() {
    clearTimeout(this.#timer)

    const now = Date.now()

    while (this.#started.length > 0 && this.#started[0]! <= now - this.interval) {
      this.#started.shift()
    }

    while (this.#waiters.length > 0 && this.#started.length < this.limit) {
      const waiter = this.#waiters.shift()!

      waiter.signal.removeEventListener('abort', waiter.onAbort)
      this.#started.push(now)
      waiter.resolve()
    }

    if (this.#waiters.length > 0) {
      this.#timer = setTimeout(() => this.drain(), this.#started[0]! + this.interval - now)
    }
  }
}

/** Creates a `RateLimit` plugin, see `RateLimit` */
export function rateLimit(options: RateLimitOptions): RateLimit {
  return new RateLimit(options)
}
