import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { type Client, createClient, errors } from '../src/index.js'
import type { RequestError } from '../src/errors.js'
import { Context } from '../src/context.js'
import { Headers } from '../src/headers.js'
import { catchError } from './helpers.js'

let client: Client

describe('client', () => {
  beforeEach(() => {
    client = createClient({
      id: 'test',
      url: 'http://localhost',
    })
  })

  it('returns text', async () => {
    const result = await client.get('/text', {}, {
      responseType: 'text',
    })

    expect(result.data).toBeTypeOf('string')
    expectTypeOf(result.data).toEqualTypeOf<string>()
  })

  it('returns json', async () => {
    const result = await client.get('/json', {}, {
      responseType: 'json',
    })

    expect(result.data).toBeTypeOf('object')
  })

  it('cancels the request', async () => {
    const request = client.get('/long', {})

    request.cancel()

    const [,error] = await catchError(request)

    expect(error).toBeInstanceOf(errors.CanceledError)
    expect(error).toMatchObject({
      message: 'Request was canceled.',
      code: 'E_CANCELED',
    })
  })

  it('throws timeout error', async () => {
    const [, error] = await catchError(client.get('/long', {}, {
      timeout: 50,
    }))

    expect(error).toBeInstanceOf(errors.TimeoutError)

    expect(error).toMatchObject({
      code: 'E_TIMEOUT',
      message: 'Request timed out.',
    })
  })

  it('throws request error', async () => {
    const [,error] = await catchError(client.get('/error', {}))

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error).toMatchObject({
      status: 502,
      data: { error: { message: 'Unknown error' } },
    })
  })

  it('serializes error', async () => {
    const [,error] = await catchError(client.get('/error', { test: 1 }))
    const json = (error as RequestError).toJSON()

    expect(json).toEqual({
      client: 'test',
      url: 'http://localhost/error',
      method: 'GET',
      code: '',
      params: { test: 1 },
      message: error?.message,
      status: 502,
      data: { error: { message: 'Unknown error' } },
    })
  })

  it('captures stack trace', async () => {
    const [,error] = await catchError(client.get('/error', {}))

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(error!.stack).not.toContain('at Client.fetch')
    expect(error!.stack).not.toContain('at Client.$request')
    expect(error!.stack).toContain('at Client.request')
    expect(error!.stack).toContain('at Client.get')
  })

  it('converts params correctly', async () => {
    const id = [1, 2, 3]
    const context = new Context({
      url: 'http://localhost/text',
      method: 'GET',
      params: { id },
      headers: new Headers(),
    })

    const request = context.buildRequest()
    const params = id.map((item) => `${encodeURIComponent('id[]')}=${encodeURIComponent(item)}`).join('&')

    expect(request.url).toBe(`http://localhost/text?${params}`)
  })
})
