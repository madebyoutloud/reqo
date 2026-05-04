import { Future } from '@outloud/future'
import type {
  RequestOptions,
  Response,
  OptionalResponseType,
  ClientOptions,
} from './types.js'
import { errors } from './errors.js'
import { Context } from './context.js'
import { Retry } from './retry.js'
import { Hooks } from './hooks.js'
import { Headers } from './headers.js'
import { contentTypes } from './constants.js'

const URL_REGEX = /^https?:\/\//

export class BaseClient extends Hooks {
  readonly options: ClientOptions

  constructor(options: Partial<ClientOptions> = {}) {
    super()

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

  request<
    T = unknown,
    D = any,
    Type extends OptionalResponseType = OptionalResponseType,
  >(options: RequestOptions<D, Type> = {}): Future<Response<T, Type>> {
    const {
      url = '/',
      method = 'GET',
      responseType = 'auto',
      headers,
      query,
      params,
      ...rest
    } = options

    const context = new Context({
      id: this.options.id,
      method,
      redirect: this.options.redirect,
      timeout: this.options.timeout,
      dispatcher: this.options.dispatcher,
      retry: typeof this.options.retry === 'object' ? { ...this.options.retry } : this.options.retry,
      responseType,
      url: this.getUrl(url),
      params: params ?? {},
      query: query ?? {},
      headers: new Headers({
        ...this.options.headers,
        ...headers,
      }),
      ...rest,
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
    await this.hook('init', context.config)

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
      const errorResults = await this.hook('error', error as errors['RequestError'])
      const finalError = errorResults.reverse()
        .find((item) => item instanceof Error) ?? (error as Error)

      if (finalError !== error && !finalError.cause) {
        finalError.cause = error
      }

      throw finalError
    }

    await this.hook('response', response)

    return response
  }

  isError(value: unknown): value is errors['RequestError'] {
    return value instanceof errors.RequestError
  }

  protected returnData<
    T,
    Type extends OptionalResponseType,
  >(promise: Future<Response<T, Type>>): Future<Response<T, Type>['data']> {
    return promise.then((value) => value.data)
  }

  private async fetch<T, Type extends OptionalResponseType>(context: Context) {
    context.startAt ??= Date.now()
    let response: Response<T, Type>

    await this.hook('request', context.config, context)

    try {
      const originalResponse = await this.options.fetch(
        context.buildUrl(),
        context.buildRequest(),
      )

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
}
