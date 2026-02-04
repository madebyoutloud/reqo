import type { errors } from './errors.js'
import type { Headers } from './headers.js'
import type { UserRetryOptions } from './retry.js'

export type ValidateFn = (response: Response) => boolean

export type Params = Record<string, any>
export type HeaderValues = Record<string, any>

export type ResponseType = 'arrayBuffer' | 'blob' | 'json' | 'text' | 'auto'
export type OptionalResponseType = ResponseType | false
export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TRACE'

export interface ResponseTypes<T = any> {
  arrayBuffer: ArrayBuffer
  blob: Blob
  text: string
  json: T
  auto: T
  none: undefined
}

export interface RequestOptions<
  D = any,
  Type extends OptionalResponseType = 'auto',
> {
  url?: string
  method?: RequestMethod
  params?: Params

  headers?: HeaderValues

  /** @default 'follow' */
  redirect?: RequestInit['redirect']
  signal?: AbortSignal
  credentials?: RequestInit['credentials']
  mode?: RequestInit['mode']
  dispatcher?: unknown
  keepalive?: boolean

  data?: D
  /** @default 'auto' */
  responseType?: Type
  /** @default 60000 */
  timeout?: number | false

  /** @default false */
  retry?: UserRetryOptions | boolean
}

export interface RequestConfig<
  D = any,
  Type extends OptionalResponseType = any,
> {
  /**
   * Descriptive name for the client, will be used in errors
   */
  id?: string

  url: string
  method: RequestMethod
  params: Params

  headers: Headers

  redirect?: RequestInit['redirect']
  readonly signal?: AbortSignal
  credentials?: RequestInit['credentials']
  mode?: RequestInit['mode']
  dispatcher?: unknown
  keepalive?: boolean

  data?: D
  responseType?: Type
  timeout?: number | false

  retry?: UserRetryOptions | boolean
}

export interface Response<
  T = any,
  Type extends OptionalResponseType = any,
> extends globalThis.Response {
  data: ResponseTypes<T>[
    ResponseType extends Type ? 'auto' : Type extends false ? 'none' : Type
  ]
}

export interface RequestState {
  /** Last error encountered during the request */
  error?: errors['RequestError']
  /** Number of retry attempts made */
  retryCount: number
}

export interface ErrorRequestState extends Omit<RequestState, 'error'> {
  error: errors['RequestError']
}
