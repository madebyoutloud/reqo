import { bench, describe } from 'vitest'
import { createClient } from '../src/index.js'

const client = createClient({
  id: 'test',
  url: 'http://localhost',
})

describe('client', () => {
  client.options.fetch = fetch

  bench('native fetch', async () => {
    await fetch('http://localhost/text')
  })

  bench('library', async () => {
    client.options.fetch = fetch
    await client.request({ url: 'text' })
  })

  bench('text', async () => {
    await client.get('text')
  })

  bench('json as text', async () => {
    await client.get('json', {}, {
      responseType: 'text',
    })
  })

  bench('json', async () => {
    await client.get('json', {}, {
      responseType: 'json',
    })
  })

  bench('json auto', async () => {
    await client.get('json')
  })
})
