import type { OptionalResponseType, Values, RequestConfig, RequestState, Response } from './types.js'
import { responseTypes, streamTypes } from './constants.js'
import { isFormData, isNativeClass } from './helpers.js'
import type { errors } from './errors.js'
import { buildQuery, buildUrl } from './url.js'

export class Context implements RequestState {
  /** Aborted on cancel and after `totalTimeout` */
  readonly controller = new AbortController()
  /** Aborts the request: the controller, or the signal of the request or client */
  readonly signal: AbortSignal
  response?: Response

  stack?: string

  /** Time when the request was created */
  readonly startAt = Date.now()
  /** Number of attempts started */
  attempts = 0
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
    return buildUrl(this.config.url, this.config.params, this.config.query)
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
        // fetch would send the entries array as `a,1,b,2`
        return new URLSearchParams(buildQuery(body as Values)).toString()
      }

      this.config.headers.set('content-type', 'application/json')
      return JSON.stringify(body)
    }

    return body
  }
}
