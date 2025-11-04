import { Future } from '@outloud/future'
import type {
  Params,
  RequestOptions,
  Response,
  OptionalResponseType,
  RequestConfig,
  HeaderValues,
  ValidateFn,
} from './types.js'
import { errors, RequestError, TimeoutError } from './errors.js'
import { Context } from './context.js'
import { Retry, type RetryOptions } from './retry.js'

export interface ClientOptions {
  fetch: typeof fetch
  redirect: RequestInit['redirect']
  timeout: number | false
  headers?: HeaderValues
  url?: string
  validate?: ValidateFn
  retry: RetryOptions | false
}

export class Client {
  options: ClientOptions

  constructor(options: Partial<ClientOptions> = {}) {
    this.options = {
      fetch: globalThis.fetch.bind(globalThis),
      redirect: 'follow',
      timeout: false,
      retry: false,
      ...options,
    }
  }

  get baseUrl() {
    return this.options.url
  }

  getUrl(path = '/') {
    return [
      (this.baseUrl ?? '').replace(/\/+$/, ''),
      path.replace(/^\/+/, ''),
    ].join('/')
  }

  request<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
    // Path extends string = '/',
    // Method extends RequestMethod = 'GET',
  >({ url, headers, ...options }: RequestOptions<D, Type> = {}): Future<Response<T, Type>> {
    const config = {
      method: 'GET',
      redirect: this.options.redirect,
      timeout: this.options.timeout,
      retry: this.options.retry ? { ...this.options.retry } : false,
      responseType: 'json' as Type,
      url: this.getUrl(url),
      headers: {
        ...this.options.headers,
        ...headers,
      },
      ...options,
    } satisfies RequestConfig<D, Type>

    if (!('accept' in config.headers) && config.responseType === 'json') {
      config.headers.accept = 'application/json'
    }

    const context = new Context(config)
    const timeoutId = this.$timeout(context)

    const fn = () => this.$fetch<T, Type>(context)
    let executor = fn

    if (options.retry) {
      executor = () => new Retry(options.retry as RetryOptions)
        .run(fn, context)
    }

    return Future.withCancel(executor(), () => context.controller.abort(new errors.CanceledError(context)))
      .finally(() => {
        timeoutId && clearTimeout(timeoutId)
      })
  }

  isError(value: unknown): value is RequestError {
    return value instanceof RequestError
  }

  private async $fetch<
    T = unknown,
    Type extends OptionalResponseType = 'json',
  >(context: Context) {
    context.startAt ??= Date.now()

    const originalResponse = await this.options.fetch(context.request)
    const response = Object.assign(originalResponse, { data: undefined }) as Response<T, Type>
    context.response = response

    const data = await this.$processResponse(originalResponse, context.config.responseType)
    response.data = data as any

    if (!this.$validate(response)) {
      throw new RequestError({
        ...context,
        message: `Request failed with status code ${response.status}.`,
      })
    }

    return response
  }

  private $validate(response: Response) {
    return this.options.validate?.(response) ?? response.ok
  }

  private $timeout(ctx: Context) {
    if (!ctx.config.timeout) {
      return
    }

    return setTimeout(() => {
      // returns last error if available, e.g. when retrying
      ctx.controller.abort(ctx.error ?? new TimeoutError(ctx.toObject()))
    }, ctx.config.timeout)
  }

  private $processResponse(response: globalThis.Response, type: OptionalResponseType) {
    if (type === false) {
      return
    }

    switch (type) {
      case 'arrayBuffer':
        return response.arrayBuffer()
      case 'blob':
        return response.blob()
      case 'json':
        return response.json()
      case 'text':
        return response.text()
      default:
        throw new Error(`Invalid response type: ${type}`)
    }
  }

  private $returnData<
    T,
    Type extends OptionalResponseType,
  >(promise: Future<Response<T, Type>>): Future<Response<T, Type>['data']> {
    return promise.then((value) => value.data)
  }

  // shorthand methods
  get<
    T,
    Type extends OptionalResponseType = 'json',
  >(url: string, params?: Params, options?: RequestOptions<never, Type>) {
    return this.request<T, never, Type>({ ...options, method: 'GET', url, params })
  }

  $get<
    T = unknown,
    Type extends OptionalResponseType = 'json',
  >(url: string, params?: Params, options?: RequestOptions<never, Type>) {
    return this.$returnData(this.get<T, Type>(url, params, options))
  }

  head<
    T = unknown,
    Type extends OptionalResponseType = 'json',
  >(url: string, options?: RequestOptions<never, Type>) {
    return this.request<T, never, Type>({ ...options, method: 'HEAD', url })
  }

  $head<
    T = unknown,
    Type extends OptionalResponseType = 'json',
  >(url: string, options?: RequestOptions<never, Type>) {
    return this.$returnData(this.head<T, Type>(url, options))
  }

  post<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
  >(url: string, data?: D, options?: RequestOptions<D, Type>) {
    return this.request<T, D, Type>({ ...options, method: 'POST', data })
  }

  $post<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
  >(url: string, data?: D, options?: RequestOptions<D, Type>) {
    return this.$returnData(this.post<T, D, Type>(url, data, options))
  }

  put<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
  >(url: string, data?: D, options?: RequestOptions<D, Type>) {
    return this.request<T, D, Type>({ ...options, method: 'PUT', data })
  }

  $put<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
  >(url: string, data?: D, options?: RequestOptions<D, Type>) {
    return this.$returnData(this.put<T, D, Type>(url, data, options))
  }

  patch<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
  >(url: string, data?: D, options?: RequestOptions<D, Type>) {
    return this.request<T, D, Type>({ ...options, method: 'PATCH', data })
  }

  $patch<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
  >(url: string, data?: D, options?: RequestOptions<D, Type>) {
    return this.$returnData(this.patch<T, D, Type>(url, data, options))
  }

  delete<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
  >(url: string, options?: RequestOptions<D, Type>) {
    return this.request<T, D, Type>({ ...options, method: 'DELETE', url })
  }

  $delete<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = 'json',
  >(url: string, options?: RequestOptions<D, Type>) {
    return this.$returnData(this.delete<T, D, Type>(url, options))
  }
}
