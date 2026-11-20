import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { Client } from '../src/client.js'
import { Context } from '../src/context.js'
import type { RequestError } from '../src/errors.js'
import { Headers } from '../src/headers.js'
import { createClient, errors } from '../src/index.js'
import { catchError } from './helpers.js'

let client: Client

describe('client', () => {
  beforeEach(() => {
    client = createClient({
      id: 'test',
      url: 'http://localhost',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('looks up globalThis.fetch on each request', async () => {
    const fetch = vi.fn(async () => Response.json({ replaced: true }))
    vi.stubGlobal('fetch', fetch)

    const data = await client.$get('/json')

    expect(fetch).toBeCalledTimes(1)
    expect(data).toEqual({ replaced: true })
  })

  it('falls back to globalThis.fetch when fetch option is undefined', async () => {
    const data = await createClient({ url: 'http://localhost', fetch: undefined }).$get('/json')

    expect(data).toEqual({ text: 'Hello World!' })
  })

  it('calls custom fetch without binding it to options', async () => {
    let thisValue: unknown = null
    const fetch = function (this: unknown) {
      // oxlint-disable-next-line typescript/no-this-alias
      thisValue = this
      return Promise.resolve(Response.json({}))
    }

    await createClient({ url: 'http://localhost', fetch }).get('/json')

    // browsers throw "Illegal invocation" when native fetch is called on another object
    expect(thisValue).toBeUndefined()
  })

  it('returns text', async () => {
    const result = await client.get('/text', {
      responseType: 'text',
    })

    expect(result.data).toBeTypeOf('string')
    expectTypeOf(result.data).toEqualTypeOf<string>()
  })

  it('returns json', async () => {
    const result = await client.get('/json', {
      responseType: 'json',
    })

    expect(result.data).toBeTypeOf('object')
  })

  it('cancels the request', async () => {
    const request = client.get('/long')

    request.cancel()

    const [, error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error).toMatchObject({
      message: 'test: GET /long was canceled.',
      code: 'E_CANCELED',
    })
  })

  it('throws canceled error when signal aborts', async () => {
    const controller = new AbortController()
    const request = client.get('/long', { signal: controller.signal })

    globalThis.setTimeout(() => controller.abort(), 20)

    const [, error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error).toMatchObject({ code: 'E_CANCELED', message: 'test: GET /long was canceled.' })
    expect(error?.cause).toBe(controller.signal.reason)
  })

  it('throws canceled error when signal is already aborted', async () => {
    const reason = new Error('stop')
    const [, error] = await catchError(client.get('/json', { signal: AbortSignal.abort(reason) }))

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error?.cause).toBe(reason)
  })

  it('throws timeout error when signal times out', async () => {
    const signal = AbortSignal.timeout(20)
    const [, error] = await catchError(client.get('/long', { signal }))

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(error).toMatchObject({ code: 'E_TIMEOUT', message: 'test: GET /long timed out.' })
    expect(error?.cause).toBe(signal.reason)
  })

  it('throws timeout error when signal times out without DOMException global', async () => {
    vi.stubGlobal('DOMException', undefined)

    const [, error] = await catchError(client.get('/long', { signal: AbortSignal.timeout(20) }))

    expect(error).toBeInstanceOf(errors.TimeoutError)
  })

  it('throws timeout error after totalTimeout', async () => {
    const [, error] = await catchError(client.get('/long', { totalTimeout: 50 }))

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(error?.cause).toBeUndefined()
  })

  it('throws timeout error', async () => {
    const [, error] = await catchError(
      client.get('/long', {
        timeout: 50,
      }),
    )

    expect(error).toBeInstanceOf(errors.TimeoutError)

    expect(error).toMatchObject({
      code: 'E_TIMEOUT',
      message: 'test: GET /long timed out.',
    })
  })

  it('throws request error', async () => {
    const [, error] = await catchError(client.get('/error'))

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error).toMatchObject({ status: 502 })
    expect((error as RequestError).data).toEqual({ error: { message: 'Unknown error' } })
  })

  it('serializes error', async () => {
    const [, error] = await catchError(client.get('/error', { query: { test: 1 } }))
    const json = (error as RequestError).toJSON()

    expect(json).toEqual({
      client: 'test',
      url: 'http://localhost/error?test=1',
      path: '/error',
      method: 'GET',
      kind: 'http',
      code: 'E_HTTP',
      message: 'test: GET /error failed with status 502.',
      status: 502,
    })
    // bodies are left out
    expect(json).not.toHaveProperty('responseBody')
  })

  it('does not expose header values when serialized', async () => {
    const secret = 'Bearer __SECRET_TOKEN__'
    const errorsToCheck = await Promise.all([
      catchError(client.get('/error', { headers: { Authorization: secret } })),
      catchError(client.get('/long', { headers: { Authorization: secret }, timeout: 20 })),
    ])

    for (const [, error] of errorsToCheck) {
      expect(error).toBeInstanceOf(errors.RequestError)
      expect((error as RequestError).config.headers.get('authorization')).toBe(secret)
      expect(JSON.stringify(error)).not.toContain('__SECRET_TOKEN__')
      expect(inspect(error, { depth: 5 })).not.toContain('__SECRET_TOKEN__')
    }
  })

  it('captures stack trace', async () => {
    const [, error] = await catchError(client.get('/error', {}))

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error!.stack).not.toContain('at Client.fetch')
    expect(error!.stack).not.toContain('at Client.$request')
    expect(error!.stack).toContain('at Client.request')
    expect(error!.stack).toContain('at Client.get')
  })

  it('replaces params', async () => {
    const id = 123
    const context = new Context({
      url: 'http://localhost/v1/posts/{id}',
      path: '/v1/posts/{id}',
      method: 'GET',
      query: {},
      params: { id },
      headers: new Headers(),
    })

    const url = context.buildUrl()

    expect(url.toString()).toBe(`http://localhost/v1/posts/${id}`)
  })

  it('converts query correctly', async () => {
    const id = [1, 2, 3]
    const context = new Context({
      url: 'http://localhost/text',
      path: '/text',
      method: 'GET',
      query: { id },
      params: {},
      headers: new Headers(),
    })

    const url = context.buildUrl()
    const query = id.map((item) => `${encodeURIComponent('id[]')}=${encodeURIComponent(item)}`).join('&')

    expect(url.toString()).toBe(`http://localhost/text?${query}`)
  })
})

describe('client signal', () => {
  it('throws canceled error when client signal aborts', async () => {
    const controller = new AbortController()
    const signalClient = createClient({ url: 'http://localhost', signal: controller.signal })
    const request = signalClient.get('/long')

    globalThis.setTimeout(() => controller.abort(), 20)

    const [, error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error?.cause).toBe(controller.signal.reason)
  })

  it('does not send request when client signal is already aborted', async () => {
    const fetch = vi.fn(async () => Response.json({}))
    const reason = new Error('stop')
    const signalClient = createClient({ url: 'http://localhost', fetch, signal: AbortSignal.abort(reason) })

    const [, error] = await catchError(signalClient.get('/json'))

    expect(fetch).not.toBeCalled()
    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error?.cause).toBe(reason)
  })

  it('throws timeout error when client signal times out', async () => {
    const signal = AbortSignal.timeout(20)
    const [, error] = await catchError(createClient({ url: 'http://localhost', signal }).get('/long'))

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(error?.cause).toBe(signal.reason)
  })

  it.each(['client', 'request'] as const)('combines client and request signals, %s signal aborts', async (source) => {
    const clientController = new AbortController()
    const requestController = new AbortController()
    const signalClient = createClient({ url: 'http://localhost', signal: clientController.signal })
    const request = signalClient.get('/long', { signal: requestController.signal })
    const controller = source === 'client' ? clientController : requestController

    globalThis.setTimeout(() => controller.abort(), 20)

    const [, error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error?.cause).toBe(controller.signal.reason)
  })

  it('leaves no listener on client signal when request ends', async () => {
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const signalClient = createClient({ url: 'http://localhost', signal: controller.signal })

    await signalClient.get('/json')
    await catchError(signalClient.get('/error'))

    expect(remove.mock.calls).toEqual(add.mock.calls.map(([type, listener]) => [type, listener]))
  })
})

describe('path params', () => {
  it('encodes params', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) => Response.json({}))

    await createClient({ url: 'http://localhost', fetch }).get('/users/{id}', {
      params: { id: '../admin?x=1#y' },
    })

    expect(String(fetch.mock.calls[0]![0])).toBe('http://localhost/users/..%2Fadmin%3Fx%3D1%23y')
  })

  it.each([undefined, null, ''])('throws before sending when a param is %o', async (id) => {
    const fetch = vi.fn(async () => Response.json({}))

    const [, error] = await catchError(
      createClient({ url: 'http://localhost', fetch }).delete('/users/{id}', {
        params: { id },
      }),
    )

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error?.message).toBe('Missing value for path parameter "id".')
    expect(fetch).not.toBeCalled()
  })
})

describe('response body', () => {
  it('throws status error when error body does not parse', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('<html>Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const [, error] = await catchError(createClient({ url: 'http://localhost', fetch }).get('/error'))

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error).toMatchObject({ message: 'GET /error failed with status 502.', status: 502 })
  })

  it('throws parse error when success body does not parse', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('<html></html>', {
          headers: { 'content-type': 'application/json' },
        }),
    )

    const [, error] = await catchError(createClient({ url: 'http://localhost', fetch }).get('/json'))

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error).toMatchObject({ message: 'GET /json failed to process response data.', status: 200 })
    expect(error?.cause).toBeInstanceOf(SyntaxError)
  })

  it.each([
    ['a Headers instance', new globalThis.Headers({ authorization: 'Bearer x' })],
    ['entries', [['authorization', 'Bearer x']] as [string, string][]],
    ['an object', { authorization: 'Bearer x' }],
  ])('sends headers given as %s', async (_, headers) => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({}))

    await createClient({ url: 'http://localhost', fetch, headers }).get('/')
    await createClient({ url: 'http://localhost', fetch }).get('/', { headers })

    for (const [, init] of fetch.mock.calls) {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer x' })
    }
  })

  it('overrides client headers by request headers, whatever the case of the name', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({}))
    const api = createClient({
      url: 'http://localhost',
      fetch,
      headers: { 'Authorization': 'Bearer client', 'X-Removed': '1' },
    })

    await api.get('/', { headers: { 'authorization': 'Bearer request', 'x-removed': null } })

    expect(fetch.mock.calls[0]![1]!.headers).toEqual({ accept: 'application/json', authorization: 'Bearer request' })
  })

  it('sends an object as a form-urlencoded body', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({}))

    await createClient({ url: 'http://localhost', fetch }).post('/form', {
      data: { name: 'a b', tags: ['x', 'y'], nested: { key: '&' } },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    const body = new URLSearchParams(fetch.mock.calls[0]![1]!.body as string)

    expect([...body]).toEqual([
      ['name', 'a b'],
      ['tags[]', 'x'],
      ['tags[]', 'y'],
      ['nested[key]', '&'],
    ])
  })
})
