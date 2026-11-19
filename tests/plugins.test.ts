import { describe, expect, it, vi } from 'vitest'
import { Client, createClient } from '../src/index.js'
import type { Plugin, PluginFn, PluginObject } from '../src/index.js'

const auth: Plugin = (client) => {
  client.on('request', (config) => {
    config.headers.set('authorization', 'Bearer plugin', true)
  })
}

describe('plugins', () => {
  it('applies a plugin with use() and returns the client', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({}))
    const client = createClient({ url: 'http://localhost', fetch })

    expect(client.use(auth)).toBe(client)

    await client.get('/x')

    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ authorization: 'Bearer plugin' })
  })

  it('applies plugins of the options in order', () => {
    const calls: string[] = []
    const client = new Client({
      plugins: [() => calls.push('a'), () => calls.push('b')],
    })

    expect(calls).toEqual(['a', 'b'])
    expect(client).toBeInstanceOf(Client)
  })

  it('passes the client to the plugin', () => {
    const plugin = vi.fn<Parameters<PluginFn>, ReturnType<PluginFn>>()
    const client = createClient().use(plugin)

    expect(plugin).toBeCalledWith(client)
  })

  it('installs an object plugin', () => {
    const plugin = { install: vi.fn() }
    const client = createClient({ plugins: [plugin] })

    expect(plugin.install).toBeCalledWith(client)
  })

  it('installs a class plugin with its state', async () => {
    class Counter implements PluginObject {
      count = 0

      install(client: Client<any>) {
        client.on('request', () => {
          this.count++
        })
      }
    }

    const counter = new Counter()
    const fetch = async () => Response.json({})
    const client = createClient({ url: 'http://localhost', fetch }).use(counter)

    await client.get('/a')
    await client.get('/b')

    expect(counter.count).toBe(2)
  })
})

describe('responseType auto', () => {
  it('returns a Blob for content types other than JSON or text', async () => {
    const client = createClient({
      url: 'http://localhost',
      fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/pdf' } }),
    })

    const data = await client.$get('/file')

    expect(data).toBeInstanceOf(Blob)
    expect((data as Blob).size).toBe(3)
  })
})
