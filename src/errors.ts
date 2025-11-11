import type { Context } from './context.js'
import type { RequestConfig, Response } from './types.js'

interface ErrorOptions {
  message?: string
  error?: Error
  code?: string
}

export class RequestError extends Error {
  config!: RequestConfig
  request!: Request
  response?: Response

  code = ''
  status: number
  data?: any

  constructor(context: Context, options: ErrorOptions = {}) {
    super(options.message ?? options.error?.message)

    if (options.code) {
      this.code = options.code
    } else if (options.error && 'code' in options.error && typeof options.error.code === 'string') {
      this.code = options.error.code
    }

    this.config = context.config
    this.request = context.request
    this.response = context.response

    this.status = this.response?.status ?? -1
    this.cause = options.error
    this.data = this.response?.data
  }

  toJSON() {
    return {
      client: this.config.name,
      url: this.config.url,
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
