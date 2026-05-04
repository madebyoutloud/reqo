import { Client } from './client.js'
import { SchemaClient } from './schema_client.js'
import type { ClientOptions } from './types.js'

export { BaseClient } from './base_client.js'
export { Client } from './client.js'
export { SchemaClient } from './schema_client.js'

export { errors } from './errors.js'

export type {
  RequestState,
  RequestMethod,
  RequestConfig,
  RequestOptions,
  Response,
} from './types.js'

export function createClient(options: Partial<ClientOptions> = {}): Client {
  return new Client(options)
}

export function createSchemaClient<T extends Record<string, any>>(options?: Partial<ClientOptions>) {
  return new SchemaClient<T>(options)
}

export const reqo = createClient()
