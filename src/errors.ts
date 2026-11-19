import type { Context } from './context.js'
import { mergeErrorStack } from './helpers.js'
import type { RequestConfig, RequestMethod, Response } from './types.js'
import { buildUrl } from './url.js'

/**
 * What made the request fail:
 * - `http`: the response has an error status (or `validate` rejected it), code `E_HTTP`,
 * - `timeout`: an attempt passed `timeout`, or the request passed `totalTimeout`, code `E_TIMEOUT`,
 * - `network`: no response, e.g. a refused connection, code of the cause (e.g. `ECONNREFUSED`) or `E_NETWORK`,
 * - `canceled`: canceled by `cancel()` or a signal, code `E_CANCELED`,
 * - `parse`: the body of a successful response could not be read, code `E_PARSE`,
 * - `invalid`: the request could not be built, e.g. a missing path parameter, code `E_INVALID_REQUEST`.
 */
export type ErrorKind = 'http' | 'timeout' | 'network' | 'canceled' | 'parse' | 'invalid'

interface ErrorOptions {
  message?: string
  error?: Error
  code?: string
  kind?: ErrorKind
}

/** Result of `RequestError.toJSON()`: the request and the failure, without headers and bodies */
export interface RequestErrorJSON {
  /** `id` of the client */
  client?: string
  /** `name` of the client */
  clientName?: string
  method: RequestMethod
  /** Full URL with path parameters and query, or the URL template if it couldn't be built */
  url: string
  /** Path parameters, left out when empty */
  params?: Record<string, any>
  status?: number
  kind: ErrorKind
  code: string
  message: string
  /** Duration of the whole request in milliseconds, including retries */
  duration: number
  attempts: number
}

const HiddenProps = ['config', 'response'] as const

const defaultCodes: Record<ErrorKind, string> = {
  http: 'E_HTTP',
  timeout: 'E_TIMEOUT',
  network: 'E_NETWORK',
  canceled: 'E_CANCELED',
  parse: 'E_PARSE',
  invalid: 'E_INVALID_REQUEST',
}

/** Returns the code of the error, if it's a non-empty string */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code

  return typeof code === 'string' && code ? code : undefined
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || (typeof value === 'object' && Object.keys(value).length === 0)
}

export class RequestError extends Error {
  /** Request config, holds headers, so it's not enumerable */
  declare config: RequestConfig

  /** Response object returned by fetch */
  declare response?: Response

  /** What made the request fail */
  kind: ErrorKind

  /** `E_HTTP`, `E_TIMEOUT`, `E_CANCELED`, `E_PARSE`, `E_INVALID_REQUEST`, or the code of a network error */
  code = ''

  /** HTTP status code of the response, `undefined` without a response */
  status?: number

  /** Response data, if available */
  data?: any

  /** Duration of the whole request in milliseconds until the error, including retries */
  duration: number

  /** Number of attempts made, `0` when the request failed before the first one */
  attempts: number

  constructor(context: Context, options: ErrorOptions = {}) {
    super(options.message ?? options.error?.message)

    if (context.stack) {
      mergeErrorStack(this, context.stack)
    }

    for (const prop of HiddenProps) {
      Object.defineProperty(this, prop, { value: context[prop], enumerable: false, writable: false })
    }

    this.kind = options.kind ?? (this.response ? 'http' : 'network')
    // fetch rejects network failures with `TypeError: fetch failed`, the code (e.g. `UND_ERR_SOCKET`) is on its cause
    this.code =
      options.code ||
      (this.kind === 'network' ? errorCode(options.error) || errorCode(options.error?.cause) : undefined) ||
      defaultCodes[this.kind]

    this.status = this.response?.status
    this.duration = Date.now() - context.startAt
    this.attempts = context.attempts
    options.error && (this.cause = options.error)
    this.response?.data !== undefined && (this.data = this.response.data)
  }

  /** Full URL of the request, with path parameters and query, or the URL template if it can't be built */
  private fullUrl() {
    try {
      return buildUrl(this.config.url, this.config.params, this.config.query).toString()
    } catch {
      return this.config.url
    }
  }

  /**
   * Returns a summary of the request and the failure as plain JSON, used by `JSON.stringify()`.
   * Leaves out headers and bodies; values in the URL and `params` are not masked.
   */
  toJSON(): RequestErrorJSON {
    const config = this.config

    const json: RequestErrorJSON = {
      client: config.id,
      clientName: config.name,
      method: config.method,
      url: this.fullUrl(),
      params: isEmpty(config.params) ? undefined : config.params,
      status: this.status,
      kind: this.kind,
      code: this.code,
      message: this.message,
      duration: this.duration,
      attempts: this.attempts,
    }

    // drops undefined values, the result is the same as after JSON serialization
    return Object.fromEntries(Object.entries(json).filter(([, value]) => value !== undefined)) as RequestErrorJSON
  }
}

export class TimeoutError extends RequestError {
  kind = 'timeout' as const
  code = 'E_TIMEOUT'
  message = 'Request timed out.'
}

export class CanceledError extends RequestError {
  kind = 'canceled' as const
  code = 'E_CANCELED'
  message = 'Request was canceled.'
}

/**
 * Returns the error as is if it's a `RequestError`, otherwise wraps it as a network error,
 * e.g. the rejection of fetch.
 */
export function toRequestError(context: Context, error: unknown): RequestError {
  if (error instanceof RequestError) {
    return error
  }

  return new RequestError(context, {
    error: error as Error,
    kind: 'network',
    message: 'Request failed due to a network error.',
  })
}

/**
 * Converts the reason of an aborted signal to an error: a `RequestError` as is (cancel, `totalTimeout`),
 * `TimeoutError` for `AbortSignal.timeout()` (`timeout` or a user signal), `CanceledError` otherwise.
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

export interface errors {
  RequestError: RequestError
  TimeoutError: TimeoutError
  CanceledError: CanceledError
}
