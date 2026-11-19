import { describe, expect, it, vi } from 'vitest'
import { createClient, errors } from '../src/index.js'
import type { RequestError } from '../src/errors.js'
import { catchError } from './helpers.js'

function clientWith(fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  return createClient({ id: 'aml', name: 'AML service', url: 'http://localhost', fetch: vi.fn(fetch) })
}

async function failure(promise: Promise<unknown>) {
  const [, error] = await catchError(promise)

  expect(error).toBeInstanceOf(errors.RequestError)

  return error as RequestError
}

describe('error kinds', () => {
  it('http', async () => {
    const error = await failure(clientWith(async () => Response.json({ error: 'nope' }, { status: 404 })).get('/x'))

    expect(error).toMatchObject({ kind: 'http', code: 'E_HTTP', status: 404, data: { error: 'nope' }, attempts: 1 })
  })

  it('network, with the code of the cause', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const error = await failure(clientWith(() => Promise.reject(new TypeError('fetch failed', { cause }))).get('/x'))

    expect(error).toMatchObject({ kind: 'network', code: 'ECONNREFUSED', status: undefined })
  })

  it('network, without a code', async () => {
    const error = await failure(clientWith(() => Promise.reject(new TypeError('fetch failed'))).get('/x'))

    expect(error).toMatchObject({ kind: 'network', code: 'E_NETWORK' })
  })

  it('timeout', async () => {
    const error = await failure(createClient({ url: 'http://localhost' }).get('/long', { timeout: 20 }))

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(error).toMatchObject({ kind: 'timeout', code: 'E_TIMEOUT', status: undefined, attempts: 1 })
  })

  it('canceled', async () => {
    const request = createClient({ url: 'http://localhost' }).get('/long')
    request.cancel()
    const error = await failure(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error).toMatchObject({ kind: 'canceled', code: 'E_CANCELED' })
  })

  it('parse', async () => {
    const error = await failure(clientWith(async () => new Response('{"broken', {
      headers: { 'content-type': 'application/json' },
    })).get('/x'))

    expect(error).toMatchObject({ kind: 'parse', code: 'E_PARSE', status: 200 })
  })

  it('invalid, for a missing path parameter', async () => {
    const fetch = vi.fn(async () => Response.json({}))
    const error = await failure(clientWith(fetch).get('/users/{id}'))

    expect(error).toMatchObject({ kind: 'invalid', code: 'E_INVALID_REQUEST', attempts: 1 })
    expect(error.message).toBe('Missing value for path parameter "id".')
    expect(fetch).not.toBeCalled()
  })

  it('invalid, for a body that does not serialize', async () => {
    const data: Record<string, unknown> = {}
    data.self = data

    const error = await failure(clientWith(async () => Response.json({})).post('/x', { data }))

    expect(error.kind).toBe('invalid')
    expect(error.cause).toBeInstanceOf(TypeError)
  })
})

describe('error duration and attempts', () => {
  it('counts every attempt and the whole duration', async () => {
    const fetch = vi.fn(async () => Response.json({}, { status: 503 }))
    const error = await failure(clientWith(fetch).get('/x', { retry: { limit: 2, delay: () => 20 } }))

    expect(fetch).toBeCalledTimes(3)
    expect(error.attempts).toBe(3)
    expect(error.duration).toBeGreaterThanOrEqual(40)
  })
})

describe('error identity', () => {
  it('carries the client id, name and meta in config', async () => {
    const client = createClient({ id: 'aml', name: 'AML service', meta: { expose: true }, url: 'http://localhost' })
    const error = await failure(client.get('/error'))

    expect(error.config).toMatchObject({ id: 'aml', name: 'AML service', meta: { expose: true } })
  })

  it('copies meta per request', async () => {
    const meta = { expose: true }
    const client = createClient({ meta, url: 'http://localhost' })

    client.on('init', (config) => {
      config.meta!.expose = false
    })

    await client.get('/json')

    expect(meta.expose).toBe(true)
  })
})

describe('toLog', () => {
  it('returns a safe snapshot', async () => {
    const client = clientWith(async () => Response.json({
      error: 'invalid',
      access_token: 'leaked',
    }, { status: 422 }))

    const error = await failure(client.post('/users/{id}', {
      params: { id: 7 },
      query: { page: 2, token: 'abc' },
      headers: { authorization: 'Bearer __SECRET__' },
      data: { name: 'John', password: 'hunter2', nested: { apiKey: 'k' } },
    }))

    const log = error.toLog()

    expect(log).toEqual({
      client: 'aml',
      clientName: 'AML service',
      method: 'POST',
      url: 'http://localhost/users/7?page=2&token=[REDACTED]',
      params: { id: 7 },
      status: 422,
      kind: 'http',
      code: 'E_HTTP',
      message: 'Request failed with status code 422.',
      duration: expect.any(Number),
      attempts: 1,
      requestBody: { name: 'John', password: '[REDACTED]', nested: { apiKey: '[REDACTED]' } },
      responseBody: { error: 'invalid', access_token: '[REDACTED]' },
    })

    expect(JSON.stringify(log)).not.toContain('__SECRET__')
    expect(JSON.parse(JSON.stringify(log))).toEqual(log)
  })

  it('replaces files with placeholders', async () => {
    const form = new FormData()
    form.append('title', 'Report')
    form.append('file', new File(['x'.repeat(2048)], 'report.pdf', { type: 'application/pdf' }))

    const error = await failure(clientWith(async () => new Response(null, { status: 500 })).post('/upload', {
      data: form,
    }))

    expect(error.toLog().requestBody).toEqual({ title: 'Report', file: '[File report.pdf, 2.0 KB]' })
  })

  it('cuts bodies to maxLength', async () => {
    const error = await failure(clientWith(async () => new Response('x'.repeat(10_000), {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    })).get('/x'))

    const body = error.toLog({ maxLength: 100 }).responseBody as string

    expect(body.startsWith('x'.repeat(100))).toBe(true)
    expect(body).toContain('[truncated, 9.8 KB]')
    expect((error.toLog().responseBody as string).length).toBeLessThan(4200)
  })

  it('leaves out bodies with body: false', async () => {
    const error = await failure(clientWith(async () => Response.json({ a: 1 }, { status: 500 })).post('/x', {
      data: { b: 2 },
    }))

    expect(error.toLog({ body: false })).not.toHaveProperty('requestBody')
    expect(error.toLog({ body: false })).not.toHaveProperty('responseBody')
  })

  it('accepts custom sensitive keys', async () => {
    const error = await failure(clientWith(async () => new Response(null, { status: 500 })).post('/x', {
      query: { iban: 'SK00' },
      data: { iban: 'SK00', password: 'p' },
    }))

    const log = error.toLog({ sensitiveKeys: ['iban'] })

    expect(log.url).toBe('http://localhost/x?iban=[REDACTED]')
    expect(log.requestBody).toEqual({ iban: '[REDACTED]', password: 'p' })
  })

  it('falls back to the URL template when a path parameter is missing', async () => {
    const error = await failure(clientWith(async () => Response.json({})).get('/users/{id}', {
      query: { secret: 's' },
    }))

    expect(error.toLog().url).toBe('http://localhost/users/{id}')
  })
})
