import type { Plugin } from '../client.js'

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
 * The state lives in the returned plugin: pass the same one to several clients to share the limit.
 * It's per process, use a shared store (e.g. Redis) to limit several instances of an app.
 *
 * ```ts
 * const api = createClient({ url, plugins: [rateLimit({ limit: 100, interval: 60_000 })] })
 * ```
 */
export function rateLimit(options: RateLimitOptions): Plugin {
  const { limit, interval } = options

  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError(`rateLimit: limit must be a positive integer, got ${limit}.`)
  }

  if (!(interval > 0)) {
    throw new TypeError(`rateLimit: interval must be a positive number, got ${interval}.`)
  }

  /** Start times of the attempts in the current window, oldest first, at most `limit` */
  const started: number[] = []
  let queue = Promise.resolve()

  const acquire = async (signal: AbortSignal) => {
    while (true) {
      signal.throwIfAborted()

      const now = Date.now()

      while (started.length > 0 && started[0]! <= now - interval) {
        started.shift()
      }

      if (started.length < limit) {
        started.push(now)
        return
      }

      await wait(started[0]! + interval - now, signal)
    }
  }

  return (client) => {
    client.on('request', (_config, state) => {
      // one request decides at a time, so the order is kept, a rejected one doesn't stop the queue
      const turn = queue.then(() => acquire(state.signal))
      queue = turn.catch(() => undefined)

      return turn
    })
  }
}
