import { getNativeClass, isFormData } from './helpers.js'

/** Keys whose values are masked by default, matched case-insensitively, ignoring `-` and `_`, anywhere in a key */
export const defaultSensitiveKeys: readonly (string | RegExp)[] = [
  'password',
  'token',
  'secret',
  'authorization',
  'apiKey',
  'api_key',
  'access_token',
  'refresh_token',
]

export interface SanitizeOptions {
  /**
   * Keys whose values are masked. A string matches a key containing it, case-insensitively and ignoring `-` and `_`,
   * so `apiKey` matches `x-api-key`, a RegExp is tested against the key as is.
   * Replaces the defaults, extend them with `[...defaultSensitiveKeys, 'iban']`.
   * @default defaultSensitiveKeys
   */
  sensitiveKeys?: readonly (string | RegExp)[]
  /**
   * Longest JSON of the result in characters, a longer one is cut and returned as a string.
   * `false` disables the limit.
   * @default 4096
   */
  maxLength?: number | false
}

export const REDACTED = '[REDACTED]'

const maxDepth = 10

/** Formats a byte size, e.g. `2.1 MB` */
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[-_]/g, '')
}

export function createKeyMatcher(keys: readonly (string | RegExp)[] = defaultSensitiveKeys) {
  const strings = keys.filter((key) => typeof key === 'string').map(normalizeKey)
  const patterns = keys.filter((key) => key instanceof RegExp)

  return (key: string) => {
    const normalized = normalizeKey(key)

    return strings.some((item) => normalized.includes(item)) || patterns.some((pattern) => pattern.test(key))
  }
}

/** Placeholder for binary values and streams, or `undefined` for other values */
function binaryPlaceholder(value: object): string | undefined {
  const type = getNativeClass(value)

  if (type === 'File' || type === 'Blob') {
    const blob = value as Blob & { name?: string }
    const name = type === 'File' ? blob.name : blob.type

    return `[${type}${name ? ` ${name}` : ''}, ${formatSize(blob.size)}]`
  }

  if (value instanceof ArrayBuffer || type === 'ArrayBuffer' || type === 'SharedArrayBuffer') {
    return `[${type}, ${formatSize((value as ArrayBuffer).byteLength)}]`
  }

  if (ArrayBuffer.isView(value)) {
    const isBuffer = typeof (value.constructor as { isBuffer?: unknown } | undefined)?.isBuffer === 'function'

    return `[${isBuffer ? 'Buffer' : (value.constructor?.name ?? type)}, ${formatSize(value.byteLength)}]`
  }

  if (
    type === 'ReadableStream' ||
    (typeof ReadableStream === 'function' && value instanceof ReadableStream) ||
    typeof (value as { pipe?: unknown }).pipe === 'function'
  ) {
    return '[Stream]'
  }
}

/** Groups entries by key, a key with several values gets an array */
function fromEntries(entries: Iterable<[string, unknown]>) {
  const result: Record<string, unknown> = {}

  for (const [key, value] of entries) {
    if (Object.hasOwn(result, key)) {
      const current = result[key]
      result[key] = Array.isArray(current) ? [...current, value] : [current, value]
    } else {
      result[key] = value
    }
  }

  return result
}

function parseJson(value: string): unknown {
  const trimmed = value.trim()

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

type Entries = Iterable<[string, unknown]>

/** Converts a value to plain JSON, masking sensitive keys and replacing binary values */
class PlainConverter {
  private seen = new WeakSet<object>()

  constructor(private isSensitive: (key: string) => boolean) {}

  convert(value: unknown, depth = 0): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (typeof value !== 'object') {
      // undefined, functions and symbols are left out, as by JSON.stringify
      return undefined
    }

    return this.object(value, depth)
  }

  private object(object: object, depth: number): unknown {
    const placeholder = binaryPlaceholder(object)

    if (placeholder) {
      return placeholder
    }

    if (object instanceof Date) {
      return Number.isNaN(object.getTime()) ? null : object.toISOString()
    }

    if (object instanceof Error) {
      return { name: object.name, message: object.message }
    }

    if (this.seen.has(object)) {
      return '[Circular]'
    }

    if (depth >= maxDepth) {
      return Array.isArray(object) ? '[Array]' : '[Object]'
    }

    this.seen.add(object)

    try {
      return this.children(object, depth + 1)
    } finally {
      this.seen.delete(object)
    }
  }

  private children(object: object, depth: number): unknown {
    if (Array.isArray(object) || object instanceof Set) {
      return Array.from(object as Iterable<unknown>, (item) => this.convert(item, depth) ?? null)
    }

    if (isFormData(object) || object instanceof URLSearchParams || getNativeClass(object) === 'URLSearchParams') {
      const grouped = fromEntries((object as unknown as { entries: () => Entries }).entries())

      return this.entries(Object.entries(grouped), depth)
    }

    if (object instanceof Map) {
      return this.entries(Array.from(object, ([key, item]) => [String(key), item]), depth)
    }

    return this.entries(Object.entries(object), depth)
  }

  private entries(entries: Entries, depth: number) {
    const result: Record<string, unknown> = {}

    for (const [key, item] of entries) {
      const plain = this.isSensitive(key) && item !== undefined && item !== null ? REDACTED : this.convert(item, depth)

      if (plain !== undefined) {
        result[key] = plain
      }
    }

    return result
  }
}

/** Cuts a value whose JSON is longer than `maxLength` to a string of that length */
export function truncate(value: unknown, maxLength: number | false = 4096): unknown {
  if (maxLength === false || value === undefined) {
    return value
  }

  const json = typeof value === 'string' ? value : JSON.stringify(value)

  if (json.length <= maxLength) {
    return value
  }

  return `${json.slice(0, maxLength)}… [truncated, ${formatSize(json.length)}]`
}

/**
 * Returns a copy of a value that is safe to log, as plain JSON:
 * - values of sensitive keys are masked,
 * - `File`, `Blob`, `Buffer`, `ArrayBuffer`, typed arrays and streams are replaced with a placeholder,
 *   e.g. `[File report.pdf, 2.1 MB]`, also in `FormData`, which becomes an object,
 * - a string of JSON is parsed, so its keys are masked too,
 * - the result is cut to `maxLength` characters of JSON.
 */
export function sanitize(value: unknown, options: SanitizeOptions = {}): unknown {
  const isSensitive = createKeyMatcher(options.sensitiveKeys)
  const parsed = typeof value === 'string' ? parseJson(value) : value

  return truncate(new PlainConverter(isSensitive).convert(parsed), options.maxLength)
}
