import { contentTypes } from './constants.js'
import { Context } from './context.js'
import { abortError, errors, isRequestError, toRequestError } from './errors.js'
import { Headers } from './headers.js'
import { Hooks } from './hooks.js'
import { RequestPromise } from './request_promise.js'
import { Retry } from './retry.js'
import type { RequestOptions, Response, OptionalResponseType, ClientOptions } from './types.js'

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

  request<T = unknown, D = any, Type extends OptionalResponseType = OptionalResponseType>(
    options: RequestOptions<D, Type> = {},
  ): RequestPromise<Response<T, Type>> {
    const { url = '/', method = 'GET', responseType = 'auto', headers, query, params, signal, ...rest } = options

    const context = new Context({
      id: this.options.id,
      name: this.options.name,
      meta: { ...this.options.meta },
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
      // request headers override client headers, also when the case of a name differs
      headers: new Headers(this.options.headers).set(headers ?? {}, true),
      signal: this.signal(signal),
      ...rest,
      client: this,
    })

    // oxlint-disable-next-line unicorn/error-message
    context.stack = new Error().stack

    const timeoutId = this.totalTimeout(context)

    const promise = this.$request<T, Type>(context).finally(() => timeoutId && clearTimeout(timeoutId))

    return RequestPromise.create(promise, {
      cancel: (reason) =>
        context.controller.abort(
          new errors.CanceledError(context, reason === undefined ? {} : { error: reason as Error }),
        ),
      // keeps the error of the previous attempt, if any, as totalTimeout does
      timeout: () => context.controller.abort(new errors.TimeoutError(context, { error: context.error })),
    })
  }

  /** Combines the client signal with the request signal, either aborts the request. */
  private signal(signal?: AbortSignal) {
    const clientSignal = this.options.signal

    if (!clientSignal || !signal || clientSignal === signal) {
      return signal ?? clientSignal
    }

    return AbortSignal.any([clientSignal, signal])
  }

  private async $request<T, Type extends OptionalResponseType>(context: Context) {
    await this.hook('init', context.config)

    const fn = () => this.fetch<T, Type>(context)
    let executor = fn

    if (context.config.retry) {
      executor = () => new Retry(typeof context.config.retry === 'object' ? context.config.retry : {}).run(fn, context)
    }

    let response: Response<T, Type>

    try {
      response = await executor()
    } catch (error) {
      const errorResults = await this.hook('error', error as errors['RequestError'])

      // the original error is not attached as cause, it holds request headers (credentials)
      throw errorResults.reverse().find((item) => item instanceof Error) ?? (error as Error)
    }

    await this.hook('response', response)

    return response
  }

  /** Returns true for a `RequestError` of any client, use `isOwnError()` to match only errors of this client */
  isError(value: unknown): value is errors['RequestError'] {
    return isRequestError(value)
  }

  /**
   * Returns true for a `RequestError` of this client. An error of another client doesn't match,
   * also when it's thrown inside a request of this client, e.g. from a hook.
   */
  isOwnError(value: unknown): value is errors['RequestError'] {
    return isRequestError(value) && value.config.client === this
  }

  protected returnData<T, Type extends OptionalResponseType>(
    promise: RequestPromise<Response<T, Type>>,
  ): RequestPromise<Response<T, Type>['data']> {
    return RequestPromise.map(promise, (value) => value.data)
  }

  private async fetch<T, Type extends OptionalResponseType>(context: Context) {
    context.attempts++

    await this.requestHook(context)

    // timeout applies to each attempt, retry waits and request hooks (e.g. a rate limit queue) are not counted,
    // it aborts only this attempt, so the request isn't aborted and the attempt can be retried
    const { timeout } = context.config
    const signal = timeout ? AbortSignal.any([context.signal, AbortSignal.timeout(timeout)]) : context.signal

    try {
      return await this.attempt<T, Type>(context, signal)
    } finally {
      // errors created later, e.g. during retry waits, don't get the response of this attempt
      context.response = undefined
    }
  }

  /** Runs the request hooks, a hook that fails because the request was aborted rejects with the abort error */
  private async requestHook(context: Context) {
    try {
      await this.hook('request', context.config, context)
    } catch (error) {
      if (context.signal.aborted) {
        throw abortError(context, context.signal.reason)
      }

      throw error
    }
  }

  private async attempt<T, Type extends OptionalResponseType>(context: Context, signal: AbortSignal) {
    let response: Response<T, Type>

    const [url, init] = this.build(context, signal)

    try {
      // globalThis.fetch is looked up on each call, so a fetch replaced later (msw, instrumentation) is used,
      // called unbound, as browsers throw "Illegal invocation" when fetch is called on another object
      const fetch = this.options.fetch ?? globalThis.fetch

      // an aborted request is not sent, also with a custom fetch that ignores the signal
      signal.throwIfAborted()

      const originalResponse = await fetch(url, init)

      response = Object.assign(originalResponse, { data: undefined }) as Response<T, Type>
      context.response = response
    } catch (error) {
      throw signal.aborted ? abortError(context, signal.reason) : toRequestError(context, error)
    }

    // the status is checked before the body is read, so a body that doesn't parse,
    // e.g. an HTML 502 page, doesn't hide it
    const valid = this.validate(response)

    try {
      response.data = (await this.processResponse(response, context.config.responseType)) as any
    } catch (error) {
      // aborted while reading the body
      if (signal.aborted) {
        throw abortError(context, signal.reason)
      }

      // the body of a failed response is read best-effort
      if (valid) {
        throw new errors.RequestError(context, {
          error: error as Error,
          kind: 'parse',
          message: 'Failed to process response data.',
        })
      }
    }

    if (!valid) {
      throw new errors.RequestError(context, { message: `Request failed with status code ${response.status}.` })
    }

    return response
  }

  /** Builds the URL and init of fetch, e.g. a missing path parameter or a body that doesn't serialize fails here */
  private build(context: Context, signal: AbortSignal): [URL, RequestInit] {
    try {
      return [context.buildUrl(), context.buildRequest(signal) as RequestInit]
    } catch (error) {
      throw new errors.RequestError(context, { error: error as Error, kind: 'invalid' })
    }
  }

  private validate(response: Response) {
    return this.options.validate?.(response) ?? response.ok
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

        return response.blob()
      default:
        throw new Error(`Invalid response type: ${type}`)
    }
  }
}
