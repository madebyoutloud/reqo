import type { Context } from './context.js'
import { mergeErrorStack } from './helpers.js'
import type { RequestConfig, Response } from './types.js'

interface ErrorOptions {
  message?: string
  error?: Error
  code?: string
}

// const Props = ['url', 'method', 'params', 'query'] as const
const HiddenProps = ['config', 'response'] as const

export class RequestError extends Error {
  /** Request config */
  declare config: RequestConfig

  /** Request object passed to fetch */
  declare request: Request

  /** Response object returned by fetch */
  response?: Response

  code = ''
  /**
   * HTTP status code of the response
   *
   * @default -1
   */
  status: number

  /** Response data, if available */
  data?: any

  constructor(context: Context, options: ErrorOptions = {}) {
    super(options.message ?? options.error?.message)

    if (context.stack) {
      mergeErrorStack(this, context.stack)
    }

    if (options.code) {
      this.code = options.code
    } else if (options.error && 'code' in options.error && typeof options.error.code === 'string') {
      this.code = options.error.code
    }

    for (const prop of HiddenProps) {
      Object.defineProperty(this, prop, { value: context[prop], enumerable: false, writable: false })
    }

    // for (const prop of Props) {
    //   this[prop] = context.config[prop] as any
    // }

    this.status = this.response?.status ?? -1
    options.error && (this.cause = options.error)
    this.response?.data && (this.data = this.response?.data)
  }

  toJSON() {
    return {
      client: this.config.id,
      url: this.config.url,
      params: this.config.params,
      query: this.config.query,
      method: this.config.method,
      message: this.message,
      code: this.code,
      status: this.status,
      data: this.data,
    }
  }
}

export class TimeoutError extends RequestError {
  code = 'E_TIMEOUT'
  message = 'Request timed out.'
}

export class CanceledError extends RequestError {
  code = 'E_CANCELED'
  message = 'Request was canceled.'
}

export const errors = {
  RequestError,
  TimeoutError,
  CanceledError,
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface errors {
  RequestError: RequestError
  TimeoutError: TimeoutError
  CanceledError: CanceledError
}
