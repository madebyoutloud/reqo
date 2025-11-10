import type { MaybePromise } from '@outloud/future'

export type Hook<Args extends any[] = any[], Result = any> = (...args: Args) => MaybePromise<Result>

export interface Hooks {
  request: Hook<[request: Request], void>
  response: Hook<[request: Request], Response>
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
