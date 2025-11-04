import type { OptionalResponseType, Params, RequestConfig, Response } from './types.js'
import { Headers } from './headers.js'
import { responseTypes, streamTypes } from './constants.js'
import { isFormData, isNativeClass } from './helpers.js'

export class Context {
  request: Request
  controller: AbortController
  response?: Response

  error?: Error
  startAt?: number

  constructor(public config: RequestConfig) {
    this.controller = new AbortController()
    this.request = this.$buildRequest()

    if (config.signal) {
      config.signal.addEventListener('abort', () => {
        this.controller.abort(config.signal?.reason)
      })
    }
  }

  get fullUrl() {
    const query = this.$buildQuery(this.config.params)
    let url = this.config.url ?? ''

    if (query) {
      url += (url.includes('?') ? '&' : '?') + query
    }

    return url
  }

  get timeoutsAt() {
    return this.config.timeout && this.startAt ? this.startAt + this.config.timeout : undefined
  }

  toObject() {
    return {
      config: this.config,
      request: this.request,
      response: this.response,
    }
  }

  private $buildRequest() {
    const headers = new Headers(this.config.headers)

    const responseType: OptionalResponseType = this.config.responseType ?? 'json'
    const mimeType = this.$detectAccept(responseType)
    headers.set('accept', mimeType)

    const body = this.$transformBody(this.config.data, headers)

    return new Request(this.fullUrl, {
      method: this.config.method,
      headers: headers.toObject(),
      signal: this.controller.signal,
      redirect: this.config.redirect,
      credentials: this.config.credentials,
      mode: this.config.mode,
      dispatcher: this.config.dispatcher as any,
      body,
    })
  }

  private $detectAccept(responseType: OptionalResponseType) {
    if (!responseType) {
      return
    }

    return responseTypes[responseType]
  }

  private $transformBody(body: unknown, headers: Headers): any {
    if (body === undefined || body === null) {
      return body
    }

    const contentType = headers.get('content-type') ?? ''

    if (isFormData(body)) {
      return body
    }

    if (body instanceof URLSearchParams) {
      return body
    }

    if (isNativeClass(body, streamTypes)) {
      return body
    }

    if (typeof body === 'object') {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return this.$buildQuery(body as Params)
      }

      headers.set('content-type', 'application/json')
      return JSON.stringify(body)
    }

    return body
  }

  private $buildQuery(value: Params = {}, prefix?: string) {
    return this.$param(value, prefix)
      .join('&')
  }

  private $param(value?: unknown, key?: string): string[] {
    if (value === null || value === undefined) {
      return []
    }

    if (Array.isArray(value)) {
      return value.map((item, i) => {
        return this.$param(item, `${key}[${i}]`)
      })
        .flat()
    }

    if (typeof value === 'object') {
      return Object.entries(value)
        .map((item) => {
          return this.$param(item[1], item[0] ? `${key}[${item[0]}]` : item[0])
        })
        .flat()
    }

    if (!key) {
      return []
    }

    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`]
  }
}
