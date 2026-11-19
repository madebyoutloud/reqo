import type { HeadersInput } from './types.js'

export class Headers {
  private values = new Map<string, string>()

  constructor(values?: HeadersInput) {
    values && this.set(values)
  }

  get(name: string) {
    return this.values.get(this.normalizeName(name))
  }

  set(name: string, value: unknown, override?: boolean): this
  set(values: HeadersInput, override?: boolean): this
  set(values: string | HeadersInput, ...args: any[]): this {
    if (typeof values === 'object') {
      // a `Headers` instance and entries are iterable, a plain object is not
      const entries =
        Symbol.iterator in values ? (values as Iterable<readonly [string, unknown]>) : Object.entries(values)

      for (const [name, value] of entries) {
        this.set(name, value, args[0])
      }

      return this
    }

    const name = this.normalizeName(values)
    const value: unknown = args[0]
    const override: boolean = args[1] ?? false

    if (!override && this.has(name)) {
      return this
    }

    if (value === undefined || value === null) {
      this.values.delete(name)
    } else {
      this.values.set(name, String(value))
    }

    return this
  }

  has(name: string) {
    return this.values.has(this.normalizeName(name))
  }

  delete(name: string) {
    this.values.delete(this.normalizeName(name))

    return this
  }

  toObject() {
    return Object.fromEntries(this.values)
  }

  private normalizeName(name: string) {
    return name.toLowerCase()
  }
}
