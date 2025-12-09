import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Client, createClient } from '../src/index.js'
import type { Hooks } from '../src/hooks.js'
import { RequestError } from '../src/errors.js'
import { catchError } from './helpers.js'

let client: Client

describe('hooks', () => {
  beforeEach(() => {
    client = createClient({
      url: 'http://localhost',
    })
  })

  it('calls request hook', async () => {
    const onRequest: Hooks['request'] = () => {
      // ignore
    }

    const fn = vi.fn(onRequest)
    client.on('request', fn)

    await client.get('/json')

    expect(fn).toBeCalled()
  })

  it('calls init hook once in case of retry', async () => {
    const fn = vi.fn()
    client.on('init', fn)

    await catchError(client.get('/error', {}, { retry: { delay: () => 50 } }))

    expect(fn).toBeCalledTimes(1)
  })

  it('calls request hook for every retry', async () => {
    const fn = vi.fn()
    client.on('request', fn)
    const limit = 2

    await catchError(client.get('/error', {}, {
      retry: {
        limit,
        delay: () => 50,
      },
    }))

    expect(fn).toBeCalledTimes(limit + 1)
  })

  it('calls error hook', async () => {
    const message = '__TEST__'
    const onError: Hooks['error'] = (error) => {
      error.message = message
    }

    const fn = vi.fn(onError)
    client.on('error', fn)

    const [,error] = await catchError(client.get('/error'))

    expect(error).toBeInstanceOf(RequestError)
    expect(fn).toBeCalled()
    expect(error?.message).toBe(message)
  })
})
