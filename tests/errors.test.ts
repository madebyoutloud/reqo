import { describe, expect, it, vi } from 'vitest'
import type { RequestError } from '../src/errors.js'
import { createClient, errors, isRequestError, reqo } from '../src/index.js'
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
    const error = await failure(
      clientWith(
        async () =>
          new Response('{"broken', {
            headers: { 'content-type': 'application/json' },
          }),
      ).get('/x'),
    )

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

describe('toJSON', () => {
  it('summarizes the request without headers and bodies', async () => {
    const client = clientWith(async () => Response.json({ error: 'invalid' }, { status: 422 }))

    const error = await failure(
      client.post('/users/{id}', {
        params: { id: 7 },
        query: { page: 2 },
        headers: { authorization: 'Bearer __SECRET__' },
        data: { name: 'John', password: '__BODY__' },
      }),
    )

    const json = error.toJSON()

    expect(json).toEqual({
      client: 'aml',
      clientName: 'AML service',
      method: 'POST',
      url: 'http://localhost/users/7?page=2',
      params: { id: 7 },
      status: 422,
      kind: 'http',
      code: 'E_HTTP',
      message: 'Request failed with status code 422.',
      duration: expect.any(Number),
      attempts: 1,
    })

    const serialized = JSON.stringify(error)

    expect(serialized).not.toContain('__SECRET__')
    expect(serialized).not.toContain('__BODY__')
    expect(JSON.parse(serialized)).toEqual(json)
  })

  it('falls back to the URL template when a path parameter is missing', async () => {
    const error = await failure(
      clientWith(async () => Response.json({})).get('/users/{id}', {
        query: { page: 1 },
      }),
    )

    expect(error.toJSON().url).toBe('http://localhost/users/{id}')
  })

  it('keeps the bodies on the error and its config', async () => {
    const error = await failure(
      clientWith(async () => Response.json({ a: 1 }, { status: 500 })).post('/x', {
        data: { b: 2 },
      }),
    )

    expect(error.data).toEqual({ a: 1 })
    expect(error.config.data).toEqual({ b: 2 })
  })
})

describe('isError, isOwnError and isRequestError', () => {
  const notFound = async () => Response.json({ error: 'nope' }, { status: 404 })

  it('isError and isRequestError match errors of any client', async () => {
    const a = clientWith(notFound)
    const b = clientWith(notFound)
    const error = await failure(a.get('/x'))

    expect(a.isError(error)).toBe(true)
    expect(b.isError(error)).toBe(true)
    expect(reqo.isError(error)).toBe(true)
    expect(isRequestError(error)).toBe(true)
  })

  it('isOwnError matches only the errors of its own client', async () => {
    const a = clientWith(notFound)
    const b = clientWith(notFound)
    const error = await failure(a.get('/x'))

    expect(error.config.client).toBe(a)
    expect(a.isOwnError(error)).toBe(true)
    expect(b.isOwnError(error)).toBe(false)
    expect(reqo.isOwnError(error)).toBe(false)
  })

  it('isOwnError does not match the error of a nested call to another client', async () => {
    const b = clientWith(notFound)
    const a = clientWith(async () => {
      await b.get('/inner')
      return Response.json({})
    })

    const error = await failure(a.get('/outer'))

    expect(error.status).toBe(404)
    expect(a.isError(error)).toBe(true)
    expect(a.isOwnError(error)).toBe(false)
    expect(b.isOwnError(error)).toBe(true)
  })

  it('isOwnError matches timeout and canceled errors of its own client', async () => {
    const client = createClient({ url: 'http://localhost' })
    const timeout = await failure(client.get('/long', { timeout: 20 }))
    const request = client.get('/long')
    request.cancel()
    const canceled = await failure(request)

    expect(client.isOwnError(timeout)).toBe(true)
    expect(client.isOwnError(canceled)).toBe(true)
  })

  it('a client request option does not override the owner', async () => {
    const a = clientWith(notFound)
    const b = clientWith(notFound)
    const error = await failure(a.get('/x', { client: b } as object))

    expect(a.isOwnError(error)).toBe(true)
    expect(b.isOwnError(error)).toBe(false)
  })

  it('none match other values or an error replaced by an error hook', async () => {
    const client = clientWith(notFound)
    client.on('error', () => new Error('mapped'))

    const [, error] = await catchError(client.get('/x'))

    for (const value of [error, new Error('nope'), null, 'E_HTTP', { kind: 'http', status: 404 }]) {
      expect(isRequestError(value)).toBe(false)
      expect(client.isError(value)).toBe(false)
      expect(client.isOwnError(value)).toBe(false)
    }
  })

  it('keeps the client out of JSON', async () => {
    const error = await failure(clientWith(notFound).get('/x'))

    expect(error.toJSON().client).toBe('aml')
  })
})
