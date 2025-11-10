import { beforeEach, describe, expect, it } from 'vitest'
import { type Client, createClient, errors } from '../src/index.js'
import { catchError } from './helpers.js'

let client: Client

describe('client', () => {
  beforeEach(() => {
    client = createClient({
      url: 'http://localhost',
    })
  })

  it('returns text', async () => {
    const result = await client.get('/text', {}, {
      responseType: 'text',
    })

    expect(result.data)
      .toBeTypeOf('string')
  })

  it('returns json', async () => {
    const result = await client.get('/json', {}, {
      responseType: 'json',
    })

    expect(result.data)
      .toBeTypeOf('object')
  })

  it('cancels the request', async () => {
    const request = client.get('/long', {})

    request.cancel()

    await expect(request).rejects
      .toBeInstanceOf(errors.CanceledError)
  })

  it('throws timeout error', async () => {
    const [, error] = await catchError(client.get('/long', {}, {
      timeout: 50,
    }))

    expect(error)
      .toBeInstanceOf(errors.TimeoutError)

    expect(error)
      .toMatchObject({
        code: 'E_TIMEOUT',
      })
  })

  it('throws request error', async () => {
    const [,error] = await catchError(client.get('/error', {}))

    expect(error)
      .toBeInstanceOf(errors.RequestError)

    console.log(error)

    expect(error)
      .toMatchObject({
        status: 502,
        data: { error: { message: 'Unknown error' } },
      })
  })
})
