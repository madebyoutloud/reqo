import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Client, createClient } from '../src/index.js'
import type { Hooks } from '../src/hooks.js'

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

    expect(fn)
      .toBeCalled()
  })
})
