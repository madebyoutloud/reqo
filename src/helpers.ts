export function getNativeClass(value: unknown): string {
  // [object Class]
  return Object.prototype.toString.call(value)
    .substring(8, -1)
}

export function isFormData(value: unknown): value is FormData {
  if (
    (typeof FormData === 'function' && value instanceof FormData) ||
    getNativeClass(value) === 'FormData'
  ) {
    return true
  }

  return false
}

export function isNativeClass(value: unknown, className: readonly string[] | string): boolean {
  if (Array.isArray(className)) {
    return className.some((name) => isNativeClass(value, name))
  }

  const global = (globalThis as any)[className as string]

  if (typeof global === 'function' && value instanceof global) {
    return true
  }

  return getNativeClass(value) === className
}

export function mergeErrorStack(error: Error, stack: string) {
  const originalStack = error.stack ?? ''

  const index = originalStack.indexOf(error.message) + error.message.length
  error.stack = originalStack.slice(0, index) + '\n' + stack.substring('Error: \n'.length)
}
