type Result<T> = [T, null] | [null, Error]

export function catchError<T>(input: () => T): T extends Promise<any> ? Promise<Result<Awaited<T>>> : Result<T>
export function catchError<T>(input: Promise<T>): Promise<Result<T>>
export function catchError<T extends Promise<any> | (() => any)>(input: T): Promise<Result<any>> | Result<any> {
  try {
    const result = input instanceof Promise ? input : input()

    if (result instanceof Promise) {
      return result.then((data) => [data, null] as Result<any>)
        .catch((error) => [null, error] as Result<any>)
    }

    return [result, null]
  } catch (error) {
    return [null, error] as Result<any>
  }
}
