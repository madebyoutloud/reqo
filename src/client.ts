import { Future } from '@outloud/future'
import type {
  Params,
  RequestOptions,
  Response,
  OptionalResponseType,
  HeaderValues,
  ValidateFn,
} from './types.js'
import { errors } from './errors.js'
import { Context } from './context.js'
import { Retry, type UserRetryOptions } from './retry.js'
import { HookRunner, type Hooks } from './hooks.js'
import { Headers } from './headers.js'
import { contentTypes } from './constants.js'

export interface ClientOptions {
  id?: string
  fetch: typeof fetch
  redirect: RequestInit['redirect']
  timeout: number | false
  headers?: HeaderValues
  url?: string
  validate?: ValidateFn
  retry: UserRetryOptions | boolean
}

const URL_REGEX = /^https?:\/\//

export class Client {
  readonly options: ClientOptions
  private hooks: { [K in keyof Hooks]?: Hooks[K][] } = {}

  constructor(options: Partial<ClientOptions> = {}) {
    this.options = {
      fetch: globalThis.fetch.bind(globalThis),
      redirect: 'follow',
      timeout: 60_000,
      retry: false,
      ...options,
    }
  }

  get baseUrl() {
    return this.options.url
  }

  getUrl(path = '/') {
    if (URL_REGEX.test(path)) {
      return path
    }

    let baseUrl = (this.baseUrl ?? '').replace(/\/+$/, '')

    if (!URL_REGEX.test(baseUrl) && typeof location !== 'undefined') {
      if (baseUrl && !baseUrl.startsWith('/')) {
        baseUrl = `/${baseUrl}`
      }

      baseUrl = `${location.origin}${baseUrl}`
    }

    if (!path.startsWith('/')) {
      path = `/${path}`
    }

    return `${baseUrl}${path}`
  }

  on<K extends keyof Hooks>(event: K, fn: Hooks[K]) {
    let hooks = this.hooks[event]

    if (!hooks) {
      hooks = []
      this.hooks[event] = hooks
    }

    hooks.push(fn)

    return this
  }

  off<K extends keyof Hooks>(event: K, fn: Hooks[K]) {
    const hooks = this.hooks[event]

    if (hooks) {
      const index = hooks.indexOf(fn)

      index !== -1 && hooks.splice(index, 1)
    }

    return this
  }

  request<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
    // Path extends string = '/',
    // Method extends RequestMethod = 'GET',
  >({ url, headers, params, ...options }: RequestOptions<D, Type> = {}): Future<Response<T, Type>> {
    const context = new Context({
      id: this.options.id,
      method: 'GET',
      redirect: this.options.redirect,
      timeout: this.options.timeout,
      retry: typeof this.options.retry === 'object' ? { ...this.options.retry } : this.options.retry,
      responseType: 'auto' as Type,
      url: this.getUrl(url),
      params: params ?? {},
      headers: new Headers({
        ...this.options.headers,
        ...headers,
      }),
      ...options,
    })

    const timeoutId = this.timeout(context)

    // eslint-disable-next-line unicorn/error-message
    context.stack = new Error().stack

    return Future.withCancel(
      this.$request<T, Type>(context),
      () => context.controller.abort(new errors.CanceledError(context)),
    )
      .finally(() => {
        timeoutId && clearTimeout(timeoutId)
      })
  }

  private async $request<T, Type extends OptionalResponseType>(context: Context) {
    await HookRunner.run(this.hooks.init, context.config)

    const fn = () => this.fetch<T, Type>(context)
    let executor = fn

    if (context.config.retry) {
      executor = () => new Retry(typeof context.config.retry === 'object' ? context.config.retry : {})
        .run(fn, context)
    }

    let response: Response<T, Type>

    try {
      response = await executor()
    } catch (error) {
      const errorResults = await HookRunner.run(this.hooks.error, error as errors['RequestError'])
      const finalError = errorResults.reverse()
        .find((item) => item instanceof Error) ?? (error as Error)

      if (finalError !== error && !finalError.cause) {
        finalError.cause = error
      }

      throw finalError
    }

    await HookRunner.run(this.hooks.response, response)

    return response
  }

  isError(value: unknown): value is errors['RequestError'] {
    return value instanceof errors.RequestError
  }

  private async fetch<T, Type extends OptionalResponseType>(context: Context) {
    context.startAt ??= Date.now()
    let response: Response<T, Type>

    await HookRunner.run(this.hooks.request, context.config)

    try {
      const originalResponse = await this.options.fetch(context.buildRequest())
      response = Object.assign(originalResponse, { data: undefined }) as Response<T, Type>
      context.response = response
    } catch (error) {
      if (error instanceof errors.RequestError) {
        throw error
      }

      throw new errors.RequestError(context, {
        error: error as Error,
        message: 'Request failed due to a network error.',
      })
    }

    try {
      const data = await this.processResponse(response, context.config.responseType)
      response.data = data as any
    } catch (error) {
      throw new errors.RequestError(context, {
        error: error as Error,
        message: 'Failed to process response data.',
      })
    }

    if (!this.validate(response)) {
      throw new errors.RequestError(context, {
        message: `Request failed with status code ${response.status}.`,
      })
    }

    return response
  }

  private validate(response: Response) {
    return this.options.validate?.(response) ?? response.ok
  }

  private timeout(context: Context) {
    if (!context.config.timeout) {
      return
    }

    return setTimeout(() => {
      // returns last error if available, e.g. when retrying
      context.controller.abort(context.error ?? new errors.TimeoutError(context))
    }, context.config.timeout)
  }

  private processResponse(response: globalThis.Response, type: OptionalResponseType) {
    if (type === false) {
      return
    }

    const contentType = response.headers.get('content-type') ?? ''

    switch (type) {
      case 'arrayBuffer':
        return response.arrayBuffer()
      case 'blob':
        return response.blob()
      case 'json':
        return response.json()
      case 'text':
        return response.text()
      case 'auto':
        if (contentTypes.json.test(contentType)) {
          return response.json()
        }

        if (!contentType || contentTypes.text.test(contentType)) {
          return response.text()
        }

        return
      default:
        throw new Error(`Invalid response type: ${type}`)
    }
  }

  protected returnData<
    T,
    Type extends OptionalResponseType,
  >(promise: Future<Response<T, Type>>): Future<Response<T, Type>['data']> {
    return promise.then((value) => value.data)
  }

  // shorthand methods
  get<
    T,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, params?: Params, options?: Omit<RequestOptions<never, Type>, 'method' | 'url' | 'params'>) {
    return this.request<T, never, Type>({ ...options, method: 'GET', url, params })
  }

  $get<
    T = unknown,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, params?: Params, options?: Omit<RequestOptions<never, Type>, 'method' | 'url' | 'params'>) {
    return this.returnData(this.get<T, Type>(url, params, options))
  }

  head<
    T = unknown,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, params?: Params, options?: Omit<RequestOptions<never, Type>, 'method' | 'url' | 'params'>) {
    return this.request<T, never, Type>({ ...options, method: 'HEAD', url, params })
  }

  $head<
    T = unknown,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, params?: Params, options?: Omit<RequestOptions<never, Type>, 'method' | 'url' | 'params'>) {
    return this.returnData(this.head<T, Type>(url, params, options))
  }

  post<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, data?: D, options?: Omit<RequestOptions<D, Type>, 'method' | 'url' | 'data'>) {
    return this.request<T, D, Type>({ ...options, method: 'POST', url, data })
  }

  $post<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, data?: D, options?: Omit<RequestOptions<D, Type>, 'method' | 'url' | 'data'>) {
    return this.returnData(this.post<T, D, Type>(url, data, options))
  }

  put<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, data?: D, options?: Omit<RequestOptions<D, Type>, 'method' | 'url' | 'data'>) {
    return this.request<T, D, Type>({ ...options, method: 'PUT', url, data })
  }

  $put<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, data?: D, options?: Omit<RequestOptions<D, Type>, 'method' | 'url' | 'data'>) {
    return this.returnData(this.put<T, D, Type>(url, data, options))
  }

  patch<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, data?: D, options?: Omit<RequestOptions<D, Type>, 'method' | 'url' | 'data'>) {
    return this.request<T, D, Type>({ ...options, method: 'PATCH', url, data })
  }

  $patch<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, data?: D, options?: Omit<RequestOptions<D, Type>, 'method' | 'url' | 'data'>) {
    return this.returnData(this.patch<T, D, Type>(url, data, options))
  }

  delete<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, options?: Omit<RequestOptions<D, Type>, 'method' | 'url'>) {
    return this.request<T, D, Type>({ ...options, method: 'DELETE', url })
  }

  $delete<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(url: string, options?: Omit<RequestOptions<D, Type>, 'method' | 'url'>) {
    return this.returnData(this.delete<T, D, Type>(url, options))
  }
}
