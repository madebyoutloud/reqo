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

/** Returns the code of the error, if it's a non-empty string */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code

  return typeof code === 'string' && code ? code : undefined
}

export class RequestError extends Error {
  /** Request config */
  declare config: RequestConfig

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

    // fetch rejects network failures with `TypeError: fetch failed`, the code (e.g. `UND_ERR_SOCKET`) is on its cause
    this.code = options.code || errorCode(options.error) || errorCode(options.error?.cause) || ''

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

/**
 * Returns the error as is if it's a `RequestError`, otherwise wraps it,
 * e.g. a network failure or the reason of an aborted signal.
 */
export function toRequestError(context: Context, error: unknown): RequestError {
  if (error instanceof RequestError) {
    return error
  }

  return new RequestError(context, {
    error: error as Error,
    message: 'Request failed due to a network error.',
  })
}

/**
 * Converts the reason of an aborted user signal to an error,
 * `TimeoutError` for `AbortSignal.timeout()`, `CanceledError` otherwise.
 */
export function abortError(context: Context, reason: unknown): RequestError {
  if (reason instanceof RequestError) {
    return reason
  }

  // checks name only, DOMException is not a global in every runtime (e.g. React Native)
  const isTimeout = (reason as Error | undefined)?.name === 'TimeoutError'
  const ErrorClass = isTimeout ? TimeoutError : CanceledError

  return new ErrorClass(context, { error: reason as Error })
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
