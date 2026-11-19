import type { Values } from './types.js'

export class MissingParamError extends Error {
  constructor(readonly param: string) {
    super(`Missing value for path parameter "${param}".`)
  }
}

/**
 * Fills `{name}` placeholders of the URL with encoded path parameters and appends the query.
 * Throws `MissingParamError` for a missing parameter, a `TypeError` for an invalid URL.
 */
export function buildUrl(url: string, params: Values = {}, query: Values = {}): URL {
  const urlWithParams = url.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value: unknown = params[name]

    // a missing value would change the path, e.g. `DELETE /users/{id}` to `DELETE /users/`
    if (value === undefined || value === null || value === '') {
      throw new MissingParamError(name)
    }

    // encoded, so a value can't change the path or add a query, e.g. `../admin?x=`
    return encodeURIComponent(String(value))
  })
  const result = new URL(urlWithParams)

  for (const [key, value] of buildQuery(query)) {
    result.searchParams.append(key, value)
  }

  return result
}

/** Flattens a value to query entries, nested keys as `a[b]`, arrays as `a[]` */
export function buildQuery(value: unknown, path?: string): [string, string][] {
  if (value === null || value === undefined) {
    return []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      // TODO: use buildQuery(item, `${path}[${i}]`) instead?
      return buildQuery(item, `${path}[]`)
    })
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .flatMap(([key, item]) => buildQuery(item, path ? `${path}[${key}]` : key))
  }

  if (!path) {
    return []
  }

  return [[path, String(value)]]
}
