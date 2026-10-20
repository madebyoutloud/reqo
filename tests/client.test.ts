/* eslint-disable max-lines-per-function */
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createClient, errors } from '../src/index.js'
import type { RequestError } from '../src/errors.js'
import { Context } from '../src/context.js'
import { Headers } from '../src/headers.js'
import type { Client } from '../src/client.js'
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
      // eslint-disable-next-line @typescript-eslint/no-this-alias
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

    const [,error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error).toMatchObject({
      message: 'Request was canceled.',
      code: 'E_CANCELED',
    })
  })

  it('throws canceled error when signal aborts', async () => {
    const controller = new AbortController()
    const request = client.get('/long', { signal: controller.signal })

    globalThis.setTimeout(() => controller.abort(), 20)

    const [,error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error).toMatchObject({ code: 'E_CANCELED', message: 'Request was canceled.' })
    expect(error?.cause).toBe(controller.signal.reason)
  })

  it('throws canceled error when signal is already aborted', async () => {
    const reason = new Error('stop')
    const [,error] = await catchError(client.get('/json', { signal: AbortSignal.abort(reason) }))

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error?.cause).toBe(reason)
  })

  it('throws timeout error when signal times out', async () => {
    const signal = AbortSignal.timeout(20)
    const [,error] = await catchError(client.get('/long', { signal }))

    expect(error).toBeInstanceOf(errors.TimeoutError)
    expect(error).toMatchObject({ code: 'E_TIMEOUT', message: 'Request timed out.' })
    expect(error?.cause).toBe(signal.reason)
  })

  it('throws timeout error when signal times out without DOMException global', async () => {
    vi.stubGlobal('DOMException', undefined)

    const [,error] = await catchError(client.get('/long', { signal: AbortSignal.timeout(20) }))

    expect(error).toBeInstanceOf(errors.TimeoutError)
  })

  it('throws timeout error', async () => {
    const [, error] = await catchError(client.get('/long', {
      timeout: 50,
    }))

    expect(error).toBeInstanceOf(errors.TimeoutError)

    expect(error).toMatchObject({
      code: 'E_TIMEOUT',
      message: 'Request timed out.',
    })
  })

  it('throws request error', async () => {
    const [,error] = await catchError(client.get('/error'))

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error).toMatchObject({
      status: 502,
      data: { error: { message: 'Unknown error' } },
    })
  })

  it('serializes error', async () => {
    const [,error] = await catchError(client.get('/error', { query: { test: 1 } }))
    const json = (error as RequestError).toJSON()

    expect(json).toEqual({
      client: 'test',
      url: 'http://localhost/error',
      method: 'GET',
      code: '',
      params: {},
      query: { test: 1 },
      message: error?.message,
      status: 502,
      data: { error: { message: 'Unknown error' } },
    })
  })

  it('does not expose header values when serialized', async () => {
    const secret = 'Bearer __SECRET_TOKEN__'
    const errorsToCheck = await Promise.all([
      catchError(client.get('/error', { headers: { Authorization: secret } })),
      catchError(client.get('/long', { headers: { Authorization: secret }, timeout: 20 })),
    ])

    for (const [,error] of errorsToCheck) {
      expect(error).toBeInstanceOf(errors.RequestError)
      expect((error as RequestError).config.headers.get('authorization')).toBe(secret)
      expect(JSON.stringify(error)).not.toContain('__SECRET_TOKEN__')
      expect(inspect(error, { depth: 5 })).not.toContain('__SECRET_TOKEN__')
    }
  })

  it('captures stack trace', async () => {
    const [,error] = await catchError(client.get('/error', {}))

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
