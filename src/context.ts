import type { OptionalResponseType, Values, RequestConfig, RequestState, Response } from './types.js'
import { responseTypes, streamTypes } from './constants.js'
import { isFormData, isNativeClass } from './helpers.js'
import { RequestError, type errors } from './errors.js'

export class Context implements RequestState {
  /** Aborted on cancel and after `totalTimeout` */
  readonly controller = new AbortController()
  /** Aborts the request: the controller, or the signal of the request or client */
  readonly signal: AbortSignal
  response?: Response

  stack?: string

  startAt?: number
  /** Time when `totalTimeout` passes */
  deadlineAt?: number
  error?: errors['RequestError']
  retryCount = 0
  retryAfter?: number

  constructor(public config: RequestConfig) {
    const { signal } = config

    this.signal = signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal
  }

  buildUrl() {
    const urlWithParams = this.config.url.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value: unknown = this.config.params[name]

      // a missing value would change the path, e.g. `DELETE /users/{id}` to `DELETE /users/`
      if (value === undefined || value === null || value === '') {
        throw new RequestError(this, { message: `Missing value for path parameter "${name}".` })
      }

      // encoded, so a value can't change the path or add a query, e.g. `../admin?x=`
      return encodeURIComponent(String(value))
    })
    const url = new URL(urlWithParams)

    for (const [key, value] of this.buildQuery(this.config.query)) {
      url.searchParams.append(key, value)
    }

    return url
  }

  /** @param signal signal of the attempt */
  buildRequest(signal: AbortSignal) {
    if (!this.config.headers.has('accept')) {
      const accept = this.detectAccept(this.config.responseType)
      this.config.headers.set('accept', accept)
    }

    const body = this.transformBody(this.config.data)

    return {
      method: this.config.method,
      headers: this.config.headers.toObject(),
      signal,
      redirect: this.config.redirect,
      credentials: this.config.credentials,
      mode: this.config.mode,
      dispatcher: this.config.dispatcher,
      body,
      keepalive: this.config.keepalive,
    }
  }

  private detectAccept(responseType: OptionalResponseType) {
    if (!responseType) {
      return
    }

    return responseTypes[responseType]
  }

  private transformBody(body: unknown): any {
    if (body === undefined || body === null) {
      return body
    }

    const contentType = this.config.headers.get('content-type') ?? ''

    if (isFormData(body)) {
      return body
    }

    if (body instanceof URLSearchParams) {
      this.config.headers.set('content-type', 'application/x-www-form-urlencoded')
      return body.toString()
    }

    if (isNativeClass(body, streamTypes)) {
      return body
    }

    if (typeof body === 'object') {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return this.buildQuery(body as Values)
      }

      this.config.headers.set('content-type', 'application/json')
      return JSON.stringify(body)
    }

    return body
  }

  private buildQuery(value: unknown, path?: string): [string, string][] {
    if (value === null || value === undefined) {
      return []
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        // TODO: use this.buildQuery(item, `${path}[${i}]`) instead?
        return this.buildQuery(item, `${path}[]`)
      })
    }

    if (typeof value === 'object') {
      return Object.entries(value)
        .flatMap(([key, item]) => this.buildQuery(item, this.paramKey(key, path)))
    }

    if (!path) {
      return []
    }

    return [[path, String(value)]]
  }

  private paramKey(key: string, path?: string) {
    return path ? `${path}[${key}]` : key
  }
}
