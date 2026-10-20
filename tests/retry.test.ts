/* eslint-disable max-lines-per-function */
import { setTimeout } from 'node:timers/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { type Client, createClient, errors } from '../src/index.js'
import type { RequestError } from '../src/errors.js'
import type { ErrorRequestState } from '../src/types.js'
import { catchError } from './helpers.js'
import { server } from './mocks/api.js'

let client: Client

describe('retry', () => {
  beforeEach(() => {
    client = createClient({
      url: 'http://localhost',
    })
  })

  it('retries x times', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return HttpResponse.json({}, { status: 500 })
      }),
    )

    const retries = 2

    const [,error] = await catchError(client.get('/retry', {
      retry: { limit: retries, delay: () => 10 },
    }))

    expect(error).toBeInstanceOf(errors.RequestError)

    expect(fn).toBeCalledTimes(retries + 1)
  })

  it('applies timeout to each attempt, not to retry waits', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return fn.mock.calls.length === 1
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json({ ok: true })
      }),
    )

    const data = await client.$get('/retry', {
      retry: { delay: () => 300 },
      timeout: 100,
    })

    expect(data).toEqual({ ok: true })
    expect(fn).toBeCalledTimes(2)
  })

  it('times out a hanging attempt after timeout', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', async () => {
        fn()

        if (fn.mock.calls.length === 1) {
          return HttpResponse.json({}, { status: 503 })
        }

        await setTimeout(1000)

        return HttpResponse.json({ ok: true })
      }),
    )

    const startAt = Date.now()
    const [,error] = await catchError(client.get('/retry', {
      retry: { delay: () => 50 },
      timeout: 100,
    }))
    const elapsed = Date.now() - startAt

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(fn).toBeCalledTimes(2)
    // 50 ms wait + 100 ms for the second attempt
    expect(elapsed).toBeGreaterThanOrEqual(140)
    expect(elapsed).toBeLessThan(500)
  })

  it('derives delay from Retry-After header', async () => {
    const fn = vi.fn()
    const delay = vi.fn((state: ErrorRequestState) => {
      return Number(state.error.response?.headers.get('retry-after')) * 1000
    })

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return fn.mock.calls.length === 1
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json({ ok: true })
      }),
    )

    const startAt = Date.now()
    const data = await client.$get('/retry', { retry: { delay } })

    expect(data).toEqual({ ok: true })
    expect(delay).toHaveReturnedWith(1000)
    expect(Date.now() - startAt).toBeGreaterThanOrEqual(1000)
  })

  it('gives up when delay exceeds maxDelay', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return HttpResponse.json({}, { status: 429 })
      }),
    )

    const startAt = Date.now()
    const [,error] = await catchError(client.get('/retry', {
      retry: { delay: () => 5000, maxDelay: 1000 },
    }))

    expect(error).toBeInstanceOf(errors.RequestError)
    expect((error as RequestError).status).toBe(429)
    expect(fn).toBeCalledTimes(1)
    expect(Date.now() - startAt).toBeLessThan(100)
  })

  it('stops waiting when signal is aborted', async () => {
    server.use(
      http.get('http://localhost/retry', () => HttpResponse.json({}, { status: 429 })),
    )

    const controller = new AbortController()
    const request = client.get('/retry', {
      retry: { delay: () => 5000 },
      signal: controller.signal,
    })

    let abortedAt = 0
    globalThis.setTimeout(() => {
      abortedAt = Date.now()
      controller.abort()
    }, 50)

    const [,error] = await catchError(request)

    expect(Date.now() - abortedAt).toBeLessThan(100)
    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error?.cause).toBe(controller.signal.reason)
  })

  it('stops waiting when request is canceled', async () => {
    server.use(
      http.get('http://localhost/retry', () => HttpResponse.json({}, { status: 429 })),
    )

    const request = client.get('/retry', {
      retry: { delay: () => 5000 },
    })

    let canceledAt = 0
    globalThis.setTimeout(() => {
      canceledAt = Date.now()
      request.cancel()
    }, 50)

    const [,error] = await catchError(request)

    expect(Date.now() - canceledAt).toBeLessThan(100)
    expect(error).toBeInstanceOf(errors.CanceledError)
  })

  it('does not keep response of previous attempt', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return fn.mock.calls.length === 1
          ? HttpResponse.json({}, { status: 500 })
          : HttpResponse.error()
      }),
    )

    const [,error] = await catchError(client.get('/retry', {
      retry: { delay: () => 10 },
    }))

    expect(fn).toBeCalledTimes(2)
    expect(error).toBeInstanceOf(errors.RequestError)
    expect((error as RequestError).status).toBe(-1)
    expect((error as RequestError).response).toBeUndefined()
  })
})
