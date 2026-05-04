import type { MaybePromise } from '@outloud/future'
import type { errors } from './errors.js'
import type { RequestConfig, RequestState } from './types.js'

export type Hook<Args extends any[] = any[], Result = any> = (...args: Args) => MaybePromise<Result>

export interface HookList {
  /** Runs when a request error occurs. */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  error: Hook<[error: errors['RequestError']], Error | void>

  /** Runs on request initialization, before any other hook. It's called only once even with retries. */
  init: Hook<[config: RequestConfig], void>

  /** Runs before the request is sent and is called for each retry attempt. */
  request: Hook<[config: RequestConfig, state: RequestState], void>

  /** Runs after a response is received. */
  response: Hook<[response: Response], void>
}

export class Hooks {
  protected hooks: { [K in keyof HookList]?: HookList[K][] } = {}

  on<K extends keyof HookList>(event: K, fn: HookList[K]) {
    let hooks = this.hooks[event]

    if (!hooks) {
      hooks = []
      this.hooks[event] = hooks
    }

    hooks.push(fn)

    return this
  }

  off<K extends keyof HookList>(event: K, fn: HookList[K]) {
    const hooks = this.hooks[event]

    if (hooks) {
      const index = hooks.indexOf(fn)

      index !== -1 && hooks.splice(index, 1)
    }

    return this
  }

  protected hook<K extends keyof HookList>(event: K, ...args: Parameters<HookList[K]>) {
    return HookRunner.run(this.hooks[event], ...args)
  }
}

export class HookRunner<T extends Hook> {
  constructor(private hooks: T[] = []) {}

  async run(...args: Parameters<T>) {
    const result: Awaited<ReturnType<T>>[] = []

    for (const hook of this.hooks) {
      result.push(await hook(...args))
    }

    return result
  }

  static run<T extends Hook>(hooks: T[] = [], ...args: Parameters<T>) {
    return new HookRunner<T>(hooks)
      .run(...args)
  }
}
