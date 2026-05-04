/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import type { Future } from '@outloud/future'
import { BaseClient } from './base_client.js'
import type {
  OptionalResponseType as ResponseType,
  RequestOptions as BaseRequestOptions,
  ResponseOrData,
} from './types.js'

type RequestOptions<
  D = any,
  Type extends ResponseType = ResponseType,
> = Omit<BaseRequestOptions<D, Type>, 'url' | 'method'>

type ClientMethod<ReturnData extends boolean = false> = <
  T,
  D = any,
  Type extends ResponseType = ResponseType,
>(url: string, options?: RequestOptions<D, Type>) => Future<ResponseOrData<T, Type, ReturnData>>

export interface Client {
  head: ClientMethod
  get: ClientMethod
  post: ClientMethod
  patch: ClientMethod
  put: ClientMethod
  delete: ClientMethod

  $get: ClientMethod<true>
  $post: ClientMethod<true>
  $patch: ClientMethod<true>
  $put: ClientMethod<true>
  $delete: ClientMethod<true>
}

@shortcuts
export class Client extends BaseClient {
}

function shortcut(method: string, returnData = false) {
  return function (this: Client, url: string, options: any): Future<any> {
    const result = this.request({ ...options, url, method })

    return returnData ? this.returnData(result) : result
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function shortcuts(client: Function) {
  const methods = ['get', 'head', 'post', 'patch', 'put', 'delete'] as const

  for (const method of methods) {
    client.prototype[method] = shortcut(method.toUpperCase())

    if (method !== 'head') {
      client.prototype[`$${method}`] = shortcut(method.toUpperCase(), true)
    }
  }
}
