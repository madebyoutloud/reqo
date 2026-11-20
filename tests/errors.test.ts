import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { Client } from '../src/client.js'
import { Context } from '../src/context.js'
import type { RequestError } from '../src/errors.js'
import { Headers } from '../src/headers.js'
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

    expect(error).toMatchObject({ kind: 'http', code: 'E_HTTP', status: 404 })
    expect(error.attempts).toBe(1)
    expect(error.data).toEqual({ error: 'nope' })
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
    expect(error).toMatchObject({ kind: 'timeout', code: 'E_TIMEOUT', status: undefined })
    expect(error.attempts).toBe(1)
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

    expect(error).toMatchObject({ kind: 'invalid', code: 'E_INVALID_REQUEST' })
    expect(error.attempts).toBe(1)
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

  it('are readable, but not enumerable and not in toJSON', async () => {
    const error = await failure(clientWith(async () => Response.json({}, { status: 500 })).get('/x'))

    expect(error.attempts).toBe(1)
    expect(error.duration).toBeTypeOf('number')
    expect(Object.keys(error)).not.toContain('attempts')
    expect(Object.keys(error)).not.toContain('duration')
    expect(error.toJSON()).not.toHaveProperty('attempts')
    expect(error.toJSON()).not.toHaveProperty('duration')
    expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty('duration')
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
      path: '/users/{id}',
      status: 422,
      kind: 'http',
      code: 'E_HTTP',
      message: 'AML service: POST /users/{id} failed with status 422.',
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

describe('response data', () => {
  it('is readable and writable, but not enumerable', async () => {
    const error = await failure(
      clientWith(async () => Response.json({ secret: '__BODY__' }, { status: 500 })).get('/x'),
    )

    expect(error.data).toEqual({ secret: '__BODY__' })
    expect(Object.keys(error)).not.toContain('data')
    expect({ ...error }).not.toHaveProperty('data')
    expect(JSON.stringify(error)).not.toContain('__BODY__')

    error.data = { replaced: true }

    expect(error.data).toEqual({ replaced: true })
    expect(Object.keys(error)).not.toContain('data')
  })

  it('stays out of console.log, also as a nested cause', async () => {
    const inner = await failure(
      clientWith(async () => Response.json({ secret: '__BODY__' }, { status: 500 })).get('/x'),
    )
    const outer = new Error('outer', { cause: inner })

    expect(inspect(inner, { depth: 5 })).not.toContain('__BODY__')
    expect(inspect(outer, { depth: 5 })).not.toContain('__BODY__')
  })
})

describe('path', () => {
  async function pathOf(client: Client, url: string, options = {}) {
    const error = await failure(client.get(url, options))

    expect(error.toJSON().path).toBe(error.config.path)

    return error.config.path
  }

  const notFound = async () => Response.json({}, { status: 404 })

  it('is the template of the request path, without the query', async () => {
    expect(await pathOf(clientWith(notFound), '/users/{id}', { params: { id: 7 }, query: { page: 1 } })).toBe(
      '/users/{id}',
    )
  })

  it('adds the leading slash and strips a query and hash in the path', async () => {
    expect(await pathOf(clientWith(notFound), 'users/{id}?page=1#top', { params: { id: 7 } })).toBe('/users/{id}')
  })

  it('leaves out the path of the base URL', async () => {
    const client = createClient({ id: 'aml', url: 'http://localhost/api', fetch: notFound })
    const error = await failure(client.get('/users/{id}', { params: { id: 7 } }))

    expect(error.config.path).toBe('/users/{id}')
    expect(error.toJSON().url).toBe('http://localhost/api/users/7')
    expect(error.message).toBe('aml: GET /users/{id} failed with status 404.')
  })

  it('is the pathname of an absolute URL', async () => {
    const client = clientWith(notFound)

    expect(await pathOf(client, 'https://other.test:8080/v2/items/{id}?x=1', { params: { id: 1 } })).toBe(
      '/v2/items/{id}',
    )
    expect(await pathOf(client, 'https://other.test')).toBe('/')
  })

  it('is / without a URL', async () => {
    const error = await failure(clientWith(notFound).request())

    expect(error.config.path).toBe('/')
  })
})

describe('message', () => {
  const failing = async () => Response.json({}, { status: 500 })

  it('names the client by name, then id, and the endpoint by its template', async () => {
    const named = createClient({ id: 'aml', name: 'AML service', url: 'http://localhost', fetch: failing })
    const withId = createClient({ id: 'aml', url: 'http://localhost', fetch: failing })
    const anonymous = createClient({ url: 'http://localhost', fetch: failing })
    const options = { params: { id: '__ID__' }, query: { token: '__TOKEN__' } }

    expect((await failure(named.delete('/users/{id}', options))).message).toBe(
      'AML service: DELETE /users/{id} failed with status 500.',
    )
    expect((await failure(withId.delete('/users/{id}', options))).message).toBe(
      'aml: DELETE /users/{id} failed with status 500.',
    )
    expect((await failure(anonymous.delete('/users/{id}', options))).message).toBe(
      'DELETE /users/{id} failed with status 500.',
    )
  })

  it('names the endpoint for network, timeout, canceled and parse errors', async () => {
    const network = await failure(clientWith(() => Promise.reject(new TypeError('fetch failed'))).get('/x'))
    const timeout = await failure(createClient({ id: 'aml', url: 'http://localhost' }).get('/long', { timeout: 20 }))
    const request = createClient({ id: 'aml', url: 'http://localhost' }).get('/long')
    request.cancel()
    const canceled = await failure(request)
    const parse = await failure(
      clientWith(async () => new Response('{"broken', { headers: { 'content-type': 'application/json' } })).get('/x'),
    )

    expect(network.message).toBe('AML service: GET /x failed due to a network error.')
    expect(timeout.message).toBe('aml: GET /long timed out.')
    expect(canceled.message).toBe('aml: GET /long was canceled.')
    expect(parse.message).toBe('AML service: GET /x failed to process response data.')
  })

  it('keeps a custom message', () => {
    const context = new Context({
      id: 'aml',
      url: 'http://localhost/x',
      path: '/x',
      method: 'GET',
      query: {},
      params: {},
      headers: new Headers(),
    })

    expect(new errors.RequestError(context, { message: 'custom' }).message).toBe('custom')
    expect(new errors.TimeoutError(context, { message: 'custom' }).message).toBe('custom')
    expect(new errors.CanceledError(context, { message: 'custom' }).message).toBe('custom')
    expect(new errors.TimeoutError(context).message).toBe('aml: GET /x timed out.')
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
