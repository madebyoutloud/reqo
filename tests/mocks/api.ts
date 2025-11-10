import { setTimeout } from 'node:timers/promises'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

const handlers = [
  http.get('http://localhost/json', () => {
    return HttpResponse.json({
      text: 'Hello World!',
    })
  }),
  http.get('http://localhost/text', () => {
    return HttpResponse.text('Hello World!')
  }),
  http.get('http://localhost/long', async () => {
    await setTimeout(1000)

    return HttpResponse.json({ status: true })
  }),
  http.get('http://localhost/error', async () => {
    return HttpResponse.json({ error: { message: 'Unknown error' } }, {
      status: 502,
    })
  }),
]

export const server = setupServer(...handlers)
