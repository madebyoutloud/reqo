import type { MaybePromise } from '@outloud/future'
import type { errors } from './errors.js'

export type Hook<Args extends any[] = any[], Result = any> = (...args: Args) => MaybePromise<Result>

export interface Hooks {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  error: Hook<[error: errors['RequestError']], Error | void>
  request: Hook<[request: Request], void>
  response: Hook<[response: Response], void>
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
