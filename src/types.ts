import type { errors } from './errors.js'
import type { Headers } from './headers.js'
import type { UserRetryOptions } from './retry.js'
import type { Plugin } from './client.js'

/** Decides whether a response is successful, runs before the body is read, so `response.data` is not set yet */
export type ValidateFn = (response: Response) => boolean

export type Values = Record<string, any>

export type MaybePromise<T> = T | PromiseLike<T>

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
  Type extends OptionalResponseType = OptionalResponseType,
> {
  url?: string
  method?: RequestMethod

  params?: Values
  query?: Values
  headers?: Values

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
  /** Timeout of each attempt in milliseconds. @default 60000 */
  timeout?: number | false
  /** Timeout of the whole request in milliseconds, including retries and waits between them. @default false */
  totalTimeout?: number | false

  /** @default false */
  retry?: UserRetryOptions | boolean
}

export interface RequestConfig<
  D = any,
  Type extends OptionalResponseType = any,
> {
  /** Identifier of the client, from `ClientOptions.id` */
  id?: string
  /** Human label of the client, from `ClientOptions.name` */
  name?: string
  /** Metadata of the client, a shallow copy of `ClientOptions.meta` */
  meta?: ClientMeta

  url: string
  method: RequestMethod
  query: Values
  params: Values

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
  totalTimeout?: number | false

  retry?: UserRetryOptions | boolean
}

export type ResponseData<T, Type extends OptionalResponseType> = ResponseTypes<T>[
  ResponseType extends Type ? 'auto' : Type extends false ? 'none' : Type
]

export interface Response<
  T = any,
  Type extends OptionalResponseType = any,
> extends globalThis.Response {
  data: ResponseData<T, Type>
}

export type ResponseOrData<
  T = any,
  Type extends OptionalResponseType = any,
  ReturnData extends boolean = false,
> = ReturnData extends true ? ResponseData<T, Type> : Response<T, Type>

export interface RequestState {
  /** Last error encountered during the request */
  error?: errors['RequestError']
  /** Number of retry attempts made */
  retryCount: number
  /**
   * Aborted when the request is canceled, passes `totalTimeout`, or the signal of the request or client aborts.
   * A hook that waits, e.g. in a rate limit queue, should stop waiting and reject when it aborts.
   */
  readonly signal: AbortSignal
}

export interface ErrorRequestState extends Omit<RequestState, 'error' | 'signal'> {
  error: errors['RequestError']
  /** Delay in milliseconds from the `Retry-After` header of the error response, if valid */
  retryAfter?: number
}

/**
 * Open bag of client metadata for integrations, copied to `config.meta` of every request.
 * Add typed keys by declaration merging:
 *
 * ```ts
 * declare module '@outloud/reqo' {
 *   interface ClientMeta {
 *     expose?: boolean
 *   }
 * }
 * ```
 */
export type ClientMeta = Record<string, unknown>

export interface ClientOptions {
  /** Identifier of the client, e.g. `aml`, used in errors, logs and hooks */
  id?: string
  /** Human label of the client, e.g. `AML service`, used in errors, logs and hooks */
  name?: string
  /** Metadata for integrations, copied to `config.meta` of every request */
  meta?: ClientMeta
  /** Plugins applied when the client is created, see `client.use()` */
  plugins?: Plugin[]
  /** @default globalThis.fetch, looked up on each request */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<globalThis.Response>
  redirect: RequestInit['redirect']
  timeout: number | false
  totalTimeout?: number | false
  headers?: Values
  url?: string
  validate?: ValidateFn
  retry: UserRetryOptions | boolean
  dispatcher?: unknown
  /** Signal for every request of the client, combined with the signal of a request, either aborts it */
  signal?: AbortSignal
}
