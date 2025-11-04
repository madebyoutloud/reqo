import { methods } from './constants.js'
import type { Context } from './context.js'
import { RequestError } from './errors.js'
import type { RequestMethod } from './types.js'

export interface RetryConfig {
  limit: number
  methods: RequestMethod[]
  statusCodes: number[]
  codes: string[]
  delay: (retryCount: number, error: RequestError) => number
  validate: (error: RequestError) => boolean
}

export interface RetryOptions extends Partial<RetryConfig> {}

export class Retry {
  count = 0
  config: RetryConfig

  constructor(options: RetryOptions) {
    this.config = {
      limit: 2,
      methods: methods.slice(0),
      statusCodes: [
        408,
        413,
        429,
        500,
        502,
        503,
        504,
        521,
        522,
        524,
      ],
      codes: [],
      delay,
      validate: this.validate.bind(this),
      ...options,
    }
  }

  async run<T>(fn: () => T, context: Context): Promise<Awaited<T>> {
    try {
      return await fn()
    } catch (error) {
      this.count++

      if (!(error instanceof RequestError) ||
        !this.config.validate(error) ||
        context.controller.signal.aborted
      ) {
        throw error
      }

      const delayMs = this.config.delay(this.count, error)
      const time = Date.now() + delayMs

      if (context.timeoutsAt && time > context.timeoutsAt) {
        throw error
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs))

      return this.run(fn, context)
    }
  }

  validate(error: RequestError) {
    if (this.count > this.config.limit) {
      return false
    }

    if (!this.config.methods.includes(error.config.method)) {
      return false
    }

    const status = error.response?.status ?? -1

    return this.config.statusCodes.includes(status) || this.config.codes.includes(error.code)
  }
}

function delay(retryCount: number) {
  return 0.1 * (2 ** (retryCount - 1)) * 1000
}
