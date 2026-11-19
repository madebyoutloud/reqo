import { describe, expect, it, vi } from 'vitest'
import { createClient, errors } from '../../src/index.js'
import { RateLimit, rateLimit } from '../../src/plugins/ratelimit.js'
import { catchError } from '../helpers.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Records the path and time of every sent request */
function recorder() {
  const start = Date.now()
  const sent: [string, number][] = []

  const fetch = vi.fn(async (input: string | URL | Request) => {
    sent.push([new URL(input as URL).pathname, Date.now() - start])
    return Response.json({})
  })

  return { fetch, sent }
}

describe('rateLimit', () => {
  it('starts at most limit requests per interval, in order', async () => {
    const { fetch, sent } = recorder()
    const client = createClient({ url: 'http://localhost', fetch, plugins: [rateLimit({ limit: 2, interval: 100 })] })

    await Promise.all(['/1', '/2', '/3', '/4', '/5'].map((path) => client.$get(path)))

    expect(sent.map(([path]) => path)).toEqual(['/1', '/2', '/3', '/4', '/5'])
    expect(sent[1]![1]).toBeLessThan(50)
    expect(sent[2]![1]).toBeGreaterThanOrEqual(95)
    expect(sent[4]![1]).toBeGreaterThanOrEqual(195)
  })

  it('shares the limit between clients using the same plugin', async () => {
    const { fetch, sent } = recorder()
    const limit = rateLimit({ limit: 1, interval: 100 })
    const a = createClient({ url: 'http://localhost', fetch, plugins: [limit] })
    const b = createClient({ url: 'http://localhost', fetch, plugins: [limit] })

    await Promise.all([a.$get('/a'), b.$get('/b')])

    expect(sent[1]![1]).toBeGreaterThanOrEqual(95)
  })

  it('counts retries', async () => {
    let calls = 0
    const fetch = vi.fn(async () => (++calls === 1 ? Response.json({}, { status: 503 }) : Response.json({})))
    const client = createClient({ url: 'http://localhost', fetch, plugins: [rateLimit({ limit: 1, interval: 100 })] })
    const start = Date.now()

    await client.$get('/x', { retry: { delay: () => 0 } })

    expect(fetch).toBeCalledTimes(2)
    expect(Date.now() - start).toBeGreaterThanOrEqual(95)
  })

  it('does not count the wait against timeout', async () => {
    const { fetch } = recorder()
    const client = createClient({
      url: 'http://localhost',
      fetch,
      timeout: 30,
      plugins: [rateLimit({ limit: 1, interval: 80 })],
    })

    await expect(Promise.all([client.$get('/1'), client.$get('/2')])).resolves.toHaveLength(2)
  })

  it('drops a canceled request without blocking the queue', async () => {
    const { fetch, sent } = recorder()
    const client = createClient({ url: 'http://localhost', fetch, plugins: [rateLimit({ limit: 1, interval: 100 })] })

    const first = client.$get('/1')
    const second = client.$get('/2')
    const third = client.$get('/3')

    await sleep(10)
    second.cancel()

    const [, error] = await catchError(second)

    expect(error).toBeInstanceOf(errors.CanceledError)
    await Promise.all([first, third])
    expect(sent.map(([path]) => path)).toEqual(['/1', '/3'])
  })

  it('rejects when totalTimeout passes while waiting', async () => {
    const { fetch } = recorder()
    const client = createClient({ url: 'http://localhost', fetch, plugins: [rateLimit({ limit: 1, interval: 1000 })] })

    await client.$get('/1')
    const [, error] = await catchError(client.$get('/2', { totalTimeout: 50 }))

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(fetch).toBeCalledTimes(1)
  })

  it.each([
    { limit: 0, interval: 1000 },
    { limit: 1.5, interval: 1000 },
    { limit: 1, interval: 0 },
    { limit: 1, interval: Number.NaN },
  ])('rejects invalid options %o', (options) => {
    expect(() => rateLimit(options)).toThrow(TypeError)
    expect(() => new RateLimit(options)).toThrow(TypeError)
  })
})

describe('RateLimit', () => {
  it('is a class instance that counts waiting requests', async () => {
    const { fetch } = recorder()
    const limiter = rateLimit({ limit: 1, interval: 100 })
    const client = createClient({ url: 'http://localhost', fetch, plugins: [limiter] })

    expect(limiter).toBeInstanceOf(RateLimit)
    expect(limiter.pending).toBe(0)

    const requests = Promise.all([client.$get('/1'), client.$get('/2'), client.$get('/3')])

    await sleep(10)
    expect(limiter.pending).toBe(2)

    await requests
    expect(limiter.pending).toBe(0)
  })
})
