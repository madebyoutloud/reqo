import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { type Client, createClient, errors } from '../src/index.js'
import type { RequestError } from '../src/errors.js'
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

    const [,error] = await catchError(client.get('/retry', {}, {
      retry: { limit: retries, delay: () => 10 },
    }))

    expect(error).toBeInstanceOf(errors.RequestError)

    expect(fn).toBeCalledTimes(retries + 1)
  })

  it('timeouts', async () => {
    const fn = vi.fn()

    server.use(
      http.get('http://localhost/retry', () => {
        fn()

        return HttpResponse.json({}, { status: 500 })
      }),
    )

    const [,error] = await catchError(client.get('/retry', {}, {
      retry: { limit: 10, delay: () => 1000 },
      timeout: 100,
    }))

    const requestError = error as RequestError

    expect(error).toBeInstanceOf(errors.RequestError)
    expect(requestError.status).toBe(500)
    expect(fn).toBeCalledTimes(1)
  })
})
