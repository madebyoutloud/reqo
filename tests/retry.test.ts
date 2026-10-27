/* eslint-disable max-lines-per-function */
import { setTimeout } from 'node:timers/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { type Client, createClient, errors } from '../src/index.js'
import { parseRetryAfter } from '../src/retry.js'
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

  it('stops waiting when client signal is aborted', async () => {
    server.use(
      http.get('http://localhost/retry', () => HttpResponse.json({}, { status: 429 })),
    )

    const controller = new AbortController()
    const signalClient = createClient({
      url: 'http://localhost',
      retry: { delay: () => 5000 },
      signal: controller.signal,
    })
    const request = signalClient.get('/retry')

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

  it('times out after totalTimeout across attempts', async () => {
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
      timeout: 1000,
      totalTimeout: 200,
    }))
    const elapsed = Date.now() - startAt

    expect(fn).toBeCalledTimes(2)
    expect(error).toBeInstanceOf(errors.TimeoutError)
    // keeps the error of the previous attempt
    expect(error?.cause).toBeInstanceOf(errors.RequestError)
    expect((error?.cause as RequestError).status).toBe(503)
    expect(elapsed).toBeGreaterThanOrEqual(190)
    expect(elapsed).toBeLessThan(400)
  })

  it('does not wait for a retry that would end after totalTimeout', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return HttpResponse.json({}, { status: 429 })
      }),
    )

    // client option is kept when the request passes its own retry options
    const startAt = Date.now()
    const [,error] = await catchError(createClient({ url: 'http://localhost', totalTimeout: 1000 })
      .get('/retry', { retry: { delay: () => 5000 } }))

    expect(fn).toBeCalledTimes(1)
    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error).not.toBeInstanceOf(errors.TimeoutError)
    expect((error as RequestError).status).toBe(429)
    expect(Date.now() - startAt).toBeLessThan(100)
  })

  it('stays within totalTimeout when retries succeed', async () => {
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
      retry: { delay: () => 50 },
      totalTimeout: 1000,
    })

    expect(data).toEqual({ ok: true })
    expect(fn).toBeCalledTimes(2)
  })

  it('passes Retry-After to delay and validate as retryAfter', async () => {
    const fn = vi.fn()
    const delay = vi.fn((state: ErrorRequestState) => state.retryAfter ?? 0)
    const validate = vi.fn((state: ErrorRequestState) => state.retryAfter !== undefined)

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return fn.mock.calls.length === 1
          ? HttpResponse.json({}, { status: 500, headers: { 'Retry-After': '0' } })
          : HttpResponse.json({}, { status: 500 })
      }),
    )

    await catchError(client.get('/retry', { retry: { delay, validate } }))

    expect(fn).toBeCalledTimes(2)
    expect(delay).toHaveReturnedWith(0)
    expect(validate.mock.results.map((result) => result.value)).toEqual([true, false])
  })

  it('waits for Retry-After by default', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return fn.mock.calls.length === 1
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json({ ok: true })
      }),
    )

    const startAt = Date.now()
    const data = await client.$get('/retry', { retry: true })

    expect(data).toEqual({ ok: true })
    expect(fn).toBeCalledTimes(2)
    expect(Date.now() - startAt).toBeGreaterThanOrEqual(1000)
  })

  it('ignores Retry-After for other status codes by default', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return fn.mock.calls.length === 1
          ? HttpResponse.json({}, { status: 500, headers: { 'Retry-After': '10' } })
          : HttpResponse.json({ ok: true })
      }),
    )

    const startAt = Date.now()
    const data = await client.$get('/retry', { retry: true })

    expect(data).toEqual({ ok: true })
    expect(Date.now() - startAt).toBeLessThan(1000)
  })

  it('gives up when Retry-After exceeds default maxDelay', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '120' } })
      }),
    )

    const startAt = Date.now()
    const [,error] = await catchError(client.get('/retry', { retry: true }))

    expect(fn).toBeCalledTimes(1)
    expect((error as RequestError).status).toBe(429)
    expect(Date.now() - startAt).toBeLessThan(100)
  })
})

describe('network error code', () => {
  // same shape as undici, the code is on the cause of `TypeError: fetch failed`
  function networkFailure(code?: string) {
    const cause = Object.assign(new Error('other side closed'), code ? { code } : {})

    return vi.fn(() => Promise.reject(new TypeError('fetch failed', { cause })))
  }

  it('retries a network error with the code on the cause', async () => {
    const fetch = networkFailure('UND_ERR_SOCKET')

    const [, error] = await catchError(createClient({ url: 'http://localhost', fetch }).get('/retry', {
      retry: { delay: () => 10 },
    }))

    expect((error as RequestError).code).toBe('UND_ERR_SOCKET')
    expect(fetch).toBeCalledTimes(3)
  })

  it('takes the code from a nested cause', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const fetch = vi.fn(() => Promise.reject(new TypeError('fetch failed', { cause: new Error('wrapper', { cause }) })))

    const [, error] = await catchError(createClient({ url: 'http://localhost', fetch }).get('/retry'))

    expect((error as RequestError).code).toBe('ECONNREFUSED')
  })

  it('does not retry a network error without a code', async () => {
    const fetch = networkFailure()

    const [, error] = await catchError(createClient({ url: 'http://localhost', fetch }).get('/retry', {
      retry: { delay: () => 10 },
    }))

    expect((error as RequestError).code).toBe('')
    expect(fetch).toBeCalledTimes(1)
  })

  it('does not retry a network error with the code on a non retried method', async () => {
    const fetch = networkFailure('UND_ERR_SOCKET')

    await catchError(createClient({ url: 'http://localhost', fetch }).post('/retry', {
      retry: { delay: () => 10 },
    }))

    expect(fetch).toBeCalledTimes(1)
  })
})

describe('parseRetryAfter', () => {
  const response = (value?: string) => new Response(null, {
    headers: value === undefined ? {} : { 'Retry-After': value },
  })

  it('parses seconds', () => {
    expect(parseRetryAfter(response('120'))).toBe(120_000)
    expect(parseRetryAfter(response('0'))).toBe(0)
  })

  it('parses HTTP date', () => {
    const date = new Date(Date.now() + 60_000).toUTCString()
    const delay = parseRetryAfter(response(date))!

    // HTTP dates have second precision
    expect(delay).toBeGreaterThan(58_000)
    expect(delay).toBeLessThanOrEqual(60_000)
  })

  it('returns 0 for a date in the past', () => {
    expect(parseRetryAfter(response(new Date(Date.now() - 60_000).toUTCString()))).toBe(0)
  })

  it('returns undefined for missing or invalid values', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined()
    expect(parseRetryAfter(response())).toBeUndefined()
    expect(parseRetryAfter(response('soon'))).toBeUndefined()
    expect(parseRetryAfter(response('-1'))).toBeUndefined()
    expect(parseRetryAfter(response('1.5'))).toBeUndefined()
  })
})
