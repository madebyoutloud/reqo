import { describe, expectTypeOf, it } from 'vitest'
import { createSchemaClient } from '../src/index.js'
import type { SchemaErrorData, SchemaRequestOptions, SchemaResponseData } from '../src/index.js'
import type { components, operations, paths } from './data/openapi.js'

// `fetch` is resolved per call so msw can intercept. Binding `globalThis.fetch` at
// construction would capture the unpatched one, this module runs before `server.listen()`.
const api = createSchemaClient<paths>({
  url: 'http://localhost',
  fetch: (input, init) => globalThis.fetch(input, init),
})

describe('schema client paths', () => {
  it('only accepts paths supporting the method', () => {
    expectTypeOf(api.$get).parameter(0)
      .toEqualTypeOf<
      '/museum-hours' | '/special-events' | '/special-events/{eventId}' | '/tickets/{ticketId}/qr'
    >()
    expectTypeOf(api.$post).parameter(0)
      .toEqualTypeOf<'/special-events' | '/tickets'>()
    expectTypeOf(api.$patch).parameter(0)
      .toEqualTypeOf<'/special-events/{eventId}'>()
    expectTypeOf(api.$delete).parameter(0)
      .toEqualTypeOf<'/special-events/{eventId}'>()
  })

  it('rejects unknown paths and unsupported methods', () => {
    // @ts-expect-error unknown path
    api.$get('/unknown')
    // @ts-expect-error path has no post operation
    api.$post('/museum-hours')
  })
})

describe('schema client options', () => {
  it('makes options optional when nothing is required', () => {
    expectTypeOf(api.$get('/museum-hours')).not.toBeNever()
    expectTypeOf(api.$get('/special-events')).not.toBeNever()
  })

  it('requires options when the operation has required params', () => {
    // @ts-expect-error params are required
    api.$get('/special-events/{eventId}')
    // @ts-expect-error params are required
    api.$get('/special-events/{eventId}', {})
    // @ts-expect-error eventId is required
    api.$get('/special-events/{eventId}', { params: {} })

    api.$get('/special-events/{eventId}', { params: { eventId: '1' } })
  })

  it('requires options when the operation has a required body', () => {
    // @ts-expect-error data is required
    api.$post('/tickets')

    api.$post('/tickets', {
      data: { ticketType: 'general', ticketDate: '2024-01-01', email: 'a@b.com' },
    })
  })

  it('requires both params and data', () => {
    // @ts-expect-error data is required
    api.$patch('/special-events/{eventId}', { params: { eventId: '1' } })
    // @ts-expect-error params are required
    api.$patch('/special-events/{eventId}', { data: { name: 'x' } })

    api.$patch('/special-events/{eventId}', { params: { eventId: '1' }, data: { name: 'x' } })
  })

  it('types query parameters', () => {
    api.$get('/special-events', { query: { limit: 10, startDate: '2024-01-01' } })

    // @ts-expect-error unknown query parameter
    api.$get('/special-events', { query: { unknown: 1 } })
    // @ts-expect-error wrong type
    api.$get('/special-events', { query: { limit: 'ten' } })
  })

  it('forbids values the operation does not define', () => {
    // @ts-expect-error operation defines no query parameters
    api.$get('/special-events/{eventId}', { params: { eventId: '1' }, query: { page: 1 } })
    // @ts-expect-error operation defines no request body
    api.$get('/special-events', { data: { name: 'x' } })
    // @ts-expect-error operation defines no path parameters
    api.$get('/special-events', { params: { eventId: '1' } })
  })

  it('still accepts arbitrary headers and base options', () => {
    api.$get('/special-events', {
      headers: { authorization: 'Bearer token' },
      timeout: 1000,
      retry: { limit: 2 },
    })
  })
})

describe('schema client responses', () => {
  it('infers success response data', async () => {
    expectTypeOf(await api.$get('/museum-hours'))
      .toEqualTypeOf<components['schemas']['MuseumHours']>()

    expectTypeOf(await api.$get('/special-events'))
      .toEqualTypeOf<components['schemas']['SpecialEventCollection']>()

    expectTypeOf(await api.$post('/special-events', {
      data: { name: 'x', location: 'y', eventDescription: 'z', dates: [], price: 1 },
    })).toEqualTypeOf<components['schemas']['SpecialEvent']>()
  })

  it('infers non-json media types', async () => {
    expectTypeOf(await api.$get('/tickets/{ticketId}/qr', { params: { ticketId: '1' } }))
      .toEqualTypeOf<components['schemas']['TicketCodeImage']>()
  })

  it('infers undefined for empty responses', async () => {
    expectTypeOf(await api.$delete('/special-events/{eventId}', { params: { eventId: '1' } }))
      .toEqualTypeOf<undefined>()
  })

  it('returns a typed response object without the $ prefix', async () => {
    const response = await api.get('/museum-hours')

    expectTypeOf(response.status).toEqualTypeOf<number>()
    expectTypeOf(response.data).toEqualTypeOf<components['schemas']['MuseumHours']>()
  })

  it('respects responseType', async () => {
    expectTypeOf(await api.$get('/museum-hours', { responseType: 'text' })).toEqualTypeOf<string>()
    expectTypeOf(await api.$get('/museum-hours', { responseType: 'blob' })).toEqualTypeOf<Blob>()
    expectTypeOf(await api.$get('/museum-hours', { responseType: false })).toEqualTypeOf<undefined>()
  })
})

describe('schema helper types', () => {
  it('exposes response and error data', () => {
    expectTypeOf<SchemaResponseData<paths, '/special-events', 'get'>>()
      .toEqualTypeOf<components['schemas']['SpecialEventCollection']>()

    expectTypeOf<SchemaErrorData<paths, '/special-events', 'get'>>()
      .toEqualTypeOf<components['schemas']['Error']>()
  })

  it('exposes request options', () => {
    expectTypeOf<SchemaRequestOptions<operations['getSpecialEvent']>['params']>()
      .toEqualTypeOf<{ eventId: components['parameters']['EventId'] }>()
  })
})
