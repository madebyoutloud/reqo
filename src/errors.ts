import type { RequestConfig, Response } from './types.js'

interface RequestErrorOptions {
  config: RequestConfig
  request: Request
  response?: Response
  message?: string
  error?: Error
  code?: string
}

export class RequestError extends Error {
  config!: RequestConfig
  request!: Request
  response?: Response

  code!: string
  status: number

  constructor({ message, error, ...options }: RequestErrorOptions) {
    super(message ?? error?.message)

    if (error && 'code' in error && typeof error.code === 'string') {
      this.code = error.code
    }

    this.config = options.config
    this.request = options.request
    this.response = options.response

    this.status = this.response?.status ?? -1
    this.cause = error
  }

  get data() {
    return this.response?.data
  }

  toJSON() {
    return {
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

  constructor(options: RequestErrorOptions) {
    super({ ...options, message: 'Request timed out.' })
  }
}

export class CanceledError extends RequestError {
  code = 'E_CANCELED'

  constructor(options: RequestErrorOptions) {
    super({ ...options, message: 'Request was canceled.' })
  }
}

export const errors = {
  RequestError,
  TimeoutError,
  CanceledError,
}
