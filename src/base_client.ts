import { Future } from '@outloud/future'
import type {
  RequestOptions,
  Response,
  OptionalResponseType,
  ClientOptions,
} from './types.js'
import { errors, toRequestError } from './errors.js'
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
      totalTimeout: this.options.totalTimeout,
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

    // eslint-disable-next-line unicorn/error-message
    context.stack = new Error().stack

    const timeoutId = this.totalTimeout(context)

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

      // the original error is not attached as cause, it holds request headers (credentials)
      throw errorResults.reverse()
        .find((item) => item instanceof Error) ?? (error as Error)
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

    // timeout applies to each attempt, retry waits are not counted
    const timeoutId = this.timeout(context)

    try {
      return await this.attempt<T, Type>(context)
    } finally {
      timeoutId && clearTimeout(timeoutId)
      // errors created later, e.g. during retry waits, don't get the response of this attempt
      context.response = undefined
    }
  }

  private async attempt<T, Type extends OptionalResponseType>(context: Context) {
    let response: Response<T, Type>

    await this.hook('request', context.config, context)

    try {
      // globalThis.fetch is looked up on each call, so a fetch replaced later (msw, instrumentation) is used,
      // called unbound, as browsers throw "Illegal invocation" when fetch is called on another object
      const fetch = this.options.fetch ?? globalThis.fetch

      const originalResponse = await fetch(
        context.buildUrl(),
        context.buildRequest(),
      )

      response = Object.assign(originalResponse, { data: undefined }) as Response<T, Type>
      context.response = response
    } catch (error) {
      throw toRequestError(context, error)
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
      context.controller.abort(new errors.TimeoutError(context))
    }, context.config.timeout)
  }

  private totalTimeout(context: Context) {
    if (!context.config.totalTimeout) {
      return
    }

    context.deadlineAt = Date.now() + context.config.totalTimeout

    return setTimeout(() => {
      // keeps the error of the previous attempt, if any
      context.controller.abort(new errors.TimeoutError(context, { error: context.error }))
    }, context.config.totalTimeout)
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
