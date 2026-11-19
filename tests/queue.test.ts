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
