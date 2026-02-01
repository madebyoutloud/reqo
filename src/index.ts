import { Client, type ClientOptions } from './client.js'

export * from './client.js'
export { errors } from './errors.js'
export type {
  RequestMethod,
  RequestConfig,
  RequestOptions,
  Response,
} from './types.js'

export function createClient(options: Partial<ClientOptions> = {}) {
  return new Client(options)
}

export const reqo = createClient()
export const http = reqo
