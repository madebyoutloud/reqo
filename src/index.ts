import { Client, type ClientOptions } from './client.js'

export * from './client.js'
export { errors } from './errors.js'

export function createClient(options: Partial<ClientOptions> = {}) {
  return new Client(options)
}
