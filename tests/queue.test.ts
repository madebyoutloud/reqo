import { describe, expect, it, vi } from 'vitest'
import { createClient, errors } from '../src/index.js'
import type { Plugin } from '../src/index.js'
import { catchError } from './helpers.js'

/** Holds every request in the `request` hook until `release()`, rejects a waiting request when it's aborted */
function queuePlugin() {
  const waiting: (() => void)[] = []

  const plugin: Plugin = (client) => {
    client.on('request', (_config, state) => new Promise<void>((resolve, reject) => {
      state.signal.throwIfAborted()

      const onAbort = () => reject(state.signal.reason)

      state.signal.addEventListener('abort', onAbort, { once: true })
      waiting.push(() => {
        state.signal.removeEventListener('abort', onAbort)
        resolve()
      })
    }))
  }

  return { plugin, waiting, release: () => waiting.shift()?.() }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('queue plugins', () => {
  it('does not count the wait in a request hook against timeout', async () => {
    const queue = queuePlugin()
    const fetch = vi.fn(async () => Response.json({ ok: true }))
    const client = createClient({ url: 'http://localhost', fetch, timeout: 50, plugins: [queue.plugin] })

    const request = client.$get('/x')

    await sleep(100)
    queue.release()

    await expect(request).resolves.toEqual({ ok: true })
    expect(fetch).toBeCalledTimes(1)
  })

  it('still counts the wait against totalTimeout', async () => {
    const queue = queuePlugin()
    const fetch = vi.fn(async () => Response.json({}))
    const client = createClient({ url: 'http://localhost', fetch, totalTimeout: 50, plugins: [queue.plugin] })

    const [, error] = await catchError(client.$get('/x'))

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(fetch).not.toBeCalled()
    expect(queue.waiting).toHaveLength(1)
  })

  it('rejects a canceled request while it waits, with CanceledError', async () => {
    const queue = queuePlugin()
    const fetch = vi.fn(async () => Response.json({}))
    const client = createClient({ url: 'http://localhost', fetch, plugins: [queue.plugin] })

    const request = client.$get('/x')

    await sleep(10)
    request.cancel()

    const [, error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect((error as errors['RequestError']).attempts).toBe(1)
    expect(fetch).not.toBeCalled()
  })

  it('maps an abort by the request signal while waiting to CanceledError', async () => {
    const queue = queuePlugin()
    const controller = new AbortController()
    const client = createClient({ url: 'http://localhost', fetch: async () => Response.json({}), plugins: [queue.plugin] })

    const request = client.$get('/x', { signal: controller.signal })

    await sleep(10)
    controller.abort()

    const [, error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect((error as errors['RequestError']).kind).toBe('canceled')
  })

  it('keeps errors of a hook that fails for another reason', async () => {
    const client = createClient({ url: 'http://localhost', fetch: async () => Response.json({}) })
    const failure = new Error('no token')

    client.on('request', () => {
      throw failure
    })

    const [, error] = await catchError(client.$get('/x'))

    expect(error).toBe(failure)
  })
})

// same as the rate limit plugin in docs/content/2.guide/4.hooks.md
function rateLimit({ limit, interval }: { limit: number, interval: number }): Plugin {
  const started: number[] = []
  let queue = Promise.resolve()

  const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
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

  const acquire = async (signal: AbortSignal) => {
    while (true) {
      signal.throwIfAborted()

      const now = Date.now()

      while (started.length > 0 && started[0]! <= now - interval) started.shift()

      if (started.length < limit) {
        started.push(now)
        return
      }

      await wait(started[0]! + interval - now, signal)
    }
  }

  return (client) => {
    client.on('request', (_config, state) => {
      const turn = queue.then(() => acquire(state.signal))
      queue = turn.catch(() => undefined)

      return turn
    })
  }
}

describe('rate limit plugin from the docs', () => {
  it('starts at most limit requests per interval, in order', async () => {
    const sentAt: [string, number][] = []
    const start = Date.now()
    const client = createClient({
      url: 'http://localhost',
      fetch: async (input) => {
        sentAt.push([new URL(input as URL).pathname, Date.now() - start])
        return Response.json({})
      },
      plugins: [rateLimit({ limit: 2, interval: 100 })],
    })

    await Promise.all(['/1', '/2', '/3', '/4', '/5'].map((path) => client.$get(path)))

    expect(sentAt.map(([path]) => path)).toEqual(['/1', '/2', '/3', '/4', '/5'])
    expect(sentAt[1]![1]).toBeLessThan(50)
    expect(sentAt[2]![1]).toBeGreaterThanOrEqual(95)
    expect(sentAt[4]![1]).toBeGreaterThanOrEqual(195)
  })

  it('drops a canceled request without blocking the queue', async () => {
    const fetch = vi.fn(async () => Response.json({}))
    const client = createClient({ url: 'http://localhost', fetch, plugins: [rateLimit({ limit: 1, interval: 100 })] })

    const first = client.$get('/1')
    const second = client.$get('/2')
    const third = client.$get('/3')

    await sleep(10)
    second.cancel()

    const [, error] = await catchError(second)

    expect(error).toBeInstanceOf(errors.CanceledError)
    await Promise.all([first, third])
    expect(fetch).toBeCalledTimes(2)
  })
})
