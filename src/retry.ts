import type { Context } from './context.js'
import { errors } from './errors.js'
import type { RequestMethod } from './types.js'

export type DelayFn = (retryCount: number, error: errors['RequestError']) => number
export type ValidateFn = (retryCount: number, error: errors['RequestError'], options: RetryOptions) => boolean

export interface RetryOptions {
  limit: number
  methods: RequestMethod[]
  statusCodes: number[]
  codes: string[]
  delay: DelayFn
  validate: ValidateFn
}

export interface UserRetryOptions extends Partial<RetryOptions> {}

export class Retry {
  count = 0
  options: RetryOptions

  constructor(options: UserRetryOptions = {}) {
    this.options = {
      ...defaultOptions,
      ...options,
    }
  }

  async run<T>(fn: () => T, context: Context): Promise<Awaited<T>> {
    while (true) {
      try {
        return await fn()
      } catch (error) {
        context.error = error as Error
        this.count++

        if (!(error instanceof errors.RequestError) ||
          !this.options.validate(this.count, error, this.options) ||
          context.controller.signal.aborted
        ) {
          throw error
        }

        const delayMs = this.options.delay(this.count, error)
        const time = Date.now() + delayMs

        if (context.timeoutsAt && time > context.timeoutsAt) {
          throw error
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs))

        if (context.controller.signal.aborted) {
          throw error
        }
      }
    }
  }
}

// TODO: handle retry-after header
const delay: DelayFn = (retryCount) => {
  return 0.1 * (2 ** (retryCount - 1)) * 1000
}

const validate: ValidateFn = (retryCount, error, options) => {
  if (retryCount > options.limit) {
    return false
  }

  if (!options.methods.includes(error.config.method)) {
    return false
  }

  const status = error.response?.status ?? -1

  return options.statusCodes.includes(status) || options.codes.includes(error.code)
}

const defaultOptions: RetryOptions = {
  limit: 2,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  statusCodes: [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530],
  codes: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'],
  delay,
  validate,
}
