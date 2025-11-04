import type { RequestConfig, Response } from './types.js'

interface RequestErrorOptions {
  config: RequestConfig
  request: Request
  response?: Response
  message?: string
}

export class RequestError extends Error {
  config: RequestConfig
  request: Request
  response?: Response

  code = ''
  status = -1

  constructor(options: RequestErrorOptions) {
    super(options.message)

    this.config = options.config
    this.request = options.request
    this.response = options.response
    this.status = options.response?.status ?? -1
  }

  get data() {
    return this.response?.data
  }
}

export class TimeoutError extends RequestError {
  code = 'E_TIMEOUT'

  constructor(options: RequestErrorOptions) {
    super({
      message: 'Request timed out.',
      ...options,
    })
  }
}

export class CanceledError extends RequestError {
  code = 'E_CANCELED'

  constructor(options: RequestErrorOptions) {
    super({
      message: 'Request was canceled.',
      ...options,
    })
  }
}

export const errors = {
  RequestError,
  TimeoutError,
  CanceledError,
}
