import type { UserRetryOptions } from './retry.js'

export type ValidateFn = (response: Response) => boolean

export type Params = Record<string, unknown>
export type HeaderValues = Record<string, unknown>

export type ResponseType = 'arrayBuffer' | 'blob' | 'json' | 'text'
export type OptionalResponseType = ResponseType | false
export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TRACE'

export interface ResponseTypes<T = any> {
  arrayBuffer: ArrayBuffer
  blob: Blob
  text: string
  json: T
  none: undefined
}

export interface RequestConfig<
  D = any,
  Type extends OptionalResponseType = any,
> {
  url: string
  method: RequestMethod
  params?: Params

  headers?: HeaderValues

  redirect?: RequestInit['redirect']
  signal?: AbortSignal
  credentials?: RequestInit['credentials']
  mode?: RequestInit['mode']
  dispatcher?: unknown

  data?: D
  responseType?: Type
  timeout?: number | false

  retry?: UserRetryOptions | boolean
}

export interface RequestOptions<
  D = any,
  Type extends OptionalResponseType = any,
> extends Partial<RequestConfig<D, Type>> {}

export interface Response<
  T = any,
  Type extends OptionalResponseType = any,
> extends globalThis.Response {
  data: ResponseTypes<T>[Type extends false ? 'none' : Type]
}
