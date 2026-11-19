import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createClient, errors, RequestPromise } from '../src/index.js'
import type { SafeResult } from '../src/index.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** fetch that answers after `ms`, or rejects when its signal aborts */
function slowFetch(ms: number) {
  return vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json({ ok: true })), ms)

    init?.signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(init.signal!.reason)
    })
  }))
}

describe('RequestPromise', () => {
  it('is returned by every method', () => {
    const client = createClient({ url: 'http://localhost', fetch: slowFetch(0) })

    expect(client.get('/x')).toBeInstanceOf(RequestPromise)
    expect(client.$get('/x')).toBeInstanceOf(RequestPromise)
    expect(client.request({ url: '/x' })).toBeInstanceOf(RequestPromise)
    expectTypeOf(client.$get<{ ok: boolean }>('/x')).toEqualTypeOf<RequestPromise<{ ok: boolean }>>()
  })

  it('cancels the request of a $ method', async () => {
    const fetch = slowFetch(1000)
    const request = createClient({ url: 'http://localhost', fetch }).$get('/x')

    await sleep(10)
    request.cancel()

    await expect(request).rejects.toBeInstanceOf(errors.CanceledError)
    expect((fetch.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true)
  })

  it('keeps the cancel reason as cause', async () => {
    const request = createClient({ url: 'http://localhost', fetch: slowFetch(1000) }).$get('/x')
    const reason = new Error('page left')

    request.cancel(reason)

    const error = await request.catch((error_: unknown) => error_) as errors['RequestError']

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error.kind).toBe('canceled')
    expect(error.cause).toBe(reason)
  })

  it('ignores cancel once settled', async () => {
    const request = createClient({ url: 'http://localhost', fetch: slowFetch(0) }).$get('/x')

    await expect(request).resolves.toEqual({ ok: true })
    expect(() => request.cancel()).not.toThrow()
    await expect(request).resolves.toEqual({ ok: true })
  })

  it('returns plain promises from then, catch and finally', () => {
    const request = createClient({ url: 'http://localhost', fetch: slowFetch(0) }).$get('/x')

    expect(request.then()).not.toBeInstanceOf(RequestPromise)
    expect(request.catch(() => undefined)).not.toBeInstanceOf(RequestPromise)
    expect(request.finally()).not.toBeInstanceOf(RequestPromise)
  })

  it('times out with a TimeoutError and aborts the request', async () => {
    const fetch = slowFetch(1000)
    const request = createClient({ url: 'http://localhost', fetch }).$get('/x')

    expect(request.timeout(20)).toBe(request)

    const error = await request.catch((error_: unknown) => error_) as errors['RequestError']

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(error.kind).toBe('timeout')
    expect((fetch.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true)
  })

  it('does not time out a request that settles in time', async () => {
    const request = createClient({ url: 'http://localhost', fetch: slowFetch(0) }).$get('/x')
      .timeout(50)

    await expect(request).resolves.toEqual({ ok: true })
    await sleep(80)
  })

  it('resolves to a tuple with safe()', async () => {
    const client = createClient({ url: 'http://localhost' })

    const [data, error] = await client.$get<{ text: string }>('/json').safe()

    expect(data).toEqual({ text: 'Hello World!' })
    expect(error).toBeNull()

    const [failed, failure] = await client.$get('/error').safe()

    expect(failed).toBeNull()
    expect(client.isError(failure)).toBe(true)
    expect(failure).toMatchObject({ kind: 'http', status: 502 })
  })

  it('types safe() as a tuple', () => {
    const request = createClient({ url: 'http://localhost', fetch: slowFetch(0) }).$get<{ ok: boolean }>('/x')

    expectTypeOf(request.safe()).toEqualTypeOf<Promise<SafeResult<{ ok: boolean }>>>()
  })

  it('keeps result() as an alias of safe()', async () => {
    const [data, error] = await createClient({ url: 'http://localhost', fetch: slowFetch(0) }).$get('/x')
      .result()

    expect(data).toEqual({ ok: true })
    expect(error).toBeNull()
  })
})
