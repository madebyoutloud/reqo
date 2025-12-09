import type { OptionalResponseType, Params, RequestConfig, Response } from './types.js'
import { Headers } from './headers.js'
import { responseTypes, streamTypes } from './constants.js'
import { isFormData, isNativeClass } from './helpers.js'

export class Context {
  controller: AbortController
  request?: Request
  response?: Response

  stack?: string

  error?: Error
  startAt?: number

  constructor(public config: RequestConfig) {
    this.controller = new AbortController()

    if (this.config.signal) {
      this.config.signal.addEventListener('abort', () => {
        this.controller.abort(this.config.signal?.reason)
      })
    }
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

  buildUrl() {
    const url = new URL(this.config.url)

    for (const [key, value] of this.buildQuery(this.config.params)) {
      url.searchParams.append(key, value)
    }

    return url
  }

  buildRequest() {
    const headers = new Headers(this.config.headers)
    const accept = this.detectAccept(this.config.responseType)
    headers.set('accept', accept)

    const body = this.transformBody(this.config.data, headers)

    const request = new Request(this.buildUrl(), {
      method: this.config.method,
      headers: headers.toObject(),
      signal: this.controller.signal,
      redirect: this.config.redirect,
      credentials: this.config.credentials,
      mode: this.config.mode,
      // @ts-expect-error unsupported in lib.dom.ts
      dispatcher: this.config.dispatcher as any,
      body,
    })

    this.request = request

    return request
  }

  private detectAccept(responseType: OptionalResponseType) {
    if (!responseType) {
      return
    }

    return responseTypes[responseType]
  }

  private transformBody(body: unknown, headers: Headers): any {
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
        return this.buildQuery(body as Params)
      }

      headers.set('content-type', 'application/json')
      return JSON.stringify(body)
    }

    return body
  }

  private buildQuery(value: unknown, path?: string): [string, string][] {
    if (value === null || value === undefined) {
      return []
    }

    if (Array.isArray(value)) {
      return value.flatMap((item, i) => {
        return this.buildQuery(item, `${path}[${i}]`)
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
