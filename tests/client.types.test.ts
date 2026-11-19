import { describe, expectTypeOf, it } from 'vitest'
import { Client, createClient, createSchemaClient, SchemaClient } from '../src/index.js'
import type { ClientMeta, ClientOptions, Plugin, RequestPromise, Untyped } from '../src/index.js'
import type { components, paths } from './data/openapi.js'

// type tests only: requests are never awaited, `fetch` never resolves
const fetch = () => new Promise<globalThis.Response>(() => undefined)
const ignore = () => undefined

interface User {
  id: number
}

describe('untyped client', () => {
  const api = createClient({ url: 'http://localhost', fetch })

  it('defaults to Untyped', () => {
    expectTypeOf(api).toEqualTypeOf<Client<Untyped>>()
    expectTypeOf(api).toEqualTypeOf<Client>()
    expectTypeOf(new Client()).toEqualTypeOf<Client>()
  })

  it('accepts any url and options', () => {
    api.$get('/anything', { params: { id: 1 }, query: { page: 1 }, headers: { a: 'b' } }).catch(ignore)
    api.$post('/anything', { data: { name: 'x' } }).catch(ignore)
    api.$post('/anything', { data: new FormData() }).catch(ignore)
    api.get(`/users/${1}`).catch(ignore)
    api.head('/x').catch(ignore)
  })

  it('types the response data with T', () => {
    expectTypeOf(api.$get<User>('/users/1')).toEqualTypeOf<RequestPromise<User>>()
    expectTypeOf(api.get<User>('/users/1')).resolves.toHaveProperty('data').toEqualTypeOf<User>()
    expectTypeOf(api.$get('/users/1')).toEqualTypeOf<RequestPromise<unknown>>()
    expectTypeOf(api.$get<User, never, 'text'>('/users/1')).toEqualTypeOf<RequestPromise<string>>()
    expectTypeOf(api.$get('/users/1', { responseType: 'blob' })).toEqualTypeOf<RequestPromise<Blob>>()
    expectTypeOf(api.$get('/users/1', { responseType: false })).toEqualTypeOf<RequestPromise<undefined>>()
  })

  it('types the body with D', () => {
    api.$post<User, { name: string }>('/users', { data: { name: 'x' } }).catch(ignore)
    // @ts-expect-error wrong body type
    api.$post<User, { name: string }>('/users', { data: { name: 1 } }).catch(ignore)
  })

  it('rejects options of other methods', () => {
    // @ts-expect-error url is the first argument
    api.$get('/users', { url: '/other' }).catch(ignore)
    // @ts-expect-error method is set by the shortcut
    api.$get('/users', { method: 'POST' }).catch(ignore)
  })
})

describe('typed client', () => {
  const api = createClient<paths>({ url: 'http://localhost', fetch })

  it('is a Client<paths>', () => {
    expectTypeOf(api).toEqualTypeOf<Client<paths>>()
    expectTypeOf(new Client<paths>()).toEqualTypeOf<Client<paths>>()
  })

  it('accepts only paths of the method', () => {
    expectTypeOf(api.$post).parameter(0)
      .toEqualTypeOf<'/special-events' | '/tickets'>()

    // @ts-expect-error unknown path
    api.$get('/unknown').catch(ignore)
    // @ts-expect-error no post operation
    api.$post('/museum-hours').catch(ignore)
  })

  it('requires params and data the operation requires', () => {
    // @ts-expect-error params are required
    api.$get('/special-events/{eventId}').catch(ignore)
    // @ts-expect-error eventId is required
    api.$get('/special-events/{eventId}', { params: {} }).catch(ignore)
    // @ts-expect-error data is required
    api.$post('/tickets').catch(ignore)

    api.$get('/special-events/{eventId}', { params: { eventId: '1' } }).catch(ignore)
    api.$post('/tickets', { data: { ticketType: 'general', ticketDate: '2024-01-01', email: 'a@b.com' } })
      .catch(ignore)
  })

  it('forbids params, query and data the operation does not define', () => {
    // @ts-expect-error no path params
    api.$get('/special-events', { params: { eventId: '1' } }).catch(ignore)
    // @ts-expect-error no query params
    api.$get('/special-events/{eventId}', { params: { eventId: '1' }, query: { page: 1 } }).catch(ignore)
    // @ts-expect-error no request body
    api.$get('/special-events', { data: { name: 'x' } }).catch(ignore)
  })

  it('types query parameters', () => {
    api.$get('/special-events', { query: { limit: 10 } }).catch(ignore)
    // @ts-expect-error wrong type
    api.$get('/special-events', { query: { limit: 'ten' } }).catch(ignore)
  })

  it('infers the response data', () => {
    expectTypeOf(api.$get('/museum-hours')).toEqualTypeOf<RequestPromise<components['schemas']['MuseumHours']>>()
    expectTypeOf(api.get('/museum-hours')).resolves.toHaveProperty('data')
      .toEqualTypeOf<components['schemas']['MuseumHours']>()
    expectTypeOf(api.$get('/museum-hours', { responseType: 'text' })).toEqualTypeOf<RequestPromise<string>>()
  })

  it('keeps createSchemaClient and SchemaClient as aliases', () => {
    expectTypeOf(createSchemaClient<paths>()).toEqualTypeOf<Client<paths>>()
    expectTypeOf(new SchemaClient<paths>()).toEqualTypeOf<Client<paths>>()
    expectTypeOf<SchemaClient<paths>>().toEqualTypeOf<Client<paths>>()
  })
})

describe('subclass', () => {
  interface ApiClientOptions extends Partial<ClientOptions> {
    apiKey: string
  }

  class ApiClient<P = Untyped> extends Client<P> {
    constructor({ apiKey, ...options }: ApiClientOptions) {
      super(options)

      this.on('request', (config) => {
        config.headers.set('authorization', `Bearer ${apiKey}`)
      })
    }

    // shortcut methods depend on `P` here, `request()` is always untyped
    ping() {
      return this.request<{ ok: boolean }>({ url: '/ping' })
    }
  }

  it('stays untyped by default', () => {
    const api = new ApiClient({ apiKey: 'x', url: 'http://localhost', fetch })

    expectTypeOf(api.$get<User>('/users/1')).toEqualTypeOf<RequestPromise<User>>()
    api.$post('/anything', { data: {} }).catch(ignore)
  })

  it('is typed with paths', () => {
    const api = new ApiClient<paths>({ apiKey: 'x', url: 'http://localhost', fetch })

    expectTypeOf(api.$get('/museum-hours')).toEqualTypeOf<RequestPromise<components['schemas']['MuseumHours']>>()
    // @ts-expect-error unknown path
    api.$get('/unknown').catch(ignore)
    // @ts-expect-error params are required
    api.$get('/special-events/{eventId}').catch(ignore)

    expectTypeOf(api.ping()).resolves.toHaveProperty('data').toEqualTypeOf<{ ok: boolean }>()
  })

  it('a non-generic subclass of a typed client', () => {
    class MuseumClient extends Client<paths> {}

    const api = new MuseumClient({ url: 'http://localhost', fetch })

    expectTypeOf(api.$get('/museum-hours')).toEqualTypeOf<RequestPromise<components['schemas']['MuseumHours']>>()
  })
})

describe('plugins', () => {
  const auth: Plugin = (client) => {
    client.on('request', (config) => {
      config.headers.set('authorization', 'Bearer x')
    })
  }

  it('accepts plugins on any client and returns it', () => {
    expectTypeOf(createClient().use(auth)).toEqualTypeOf<Client>()
    expectTypeOf(createClient<paths>().use(auth)).toEqualTypeOf<Client<paths>>()
    expectTypeOf(new (class extends Client<paths> {})({ url: 'http://localhost', fetch }).use(auth)
      .$get('/museum-hours'))
      .toEqualTypeOf<RequestPromise<components['schemas']['MuseumHours']>>()

    createClient({ plugins: [auth] })
  })

  it('accepts any client as Client<any>', () => {
    const takesAny = (_client: Client<any>) => undefined

    takesAny(createClient())
    takesAny(createClient<paths>())
  })
})

declare module '../src/index.js' {
  interface ClientMeta {
    expose?: boolean
  }
}

describe('ClientMeta', () => {
  it('takes typed keys by declaration merging', () => {
    expectTypeOf<ClientMeta['expose']>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf(createClient).toBeCallableWith({ meta: { expose: true } })
    // @ts-expect-error a typed key keeps its type
    createClient({ meta: { expose: 'yes' } })
  })
})
