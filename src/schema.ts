import type {
  OptionalResponseType as ResponseType,
  RequestOptions as BaseRequestOptions,
  HeadersInput,
  Values,
} from './types.js'

export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

type FilterKeys<T, K> = T[keyof T & K]
export type MediaType = `${string}/${string}`

/** Keys of `T` that are not optional. */
export type RequiredKeys<T> = Exclude<{
  [K in keyof T]: T extends Record<K, T[K]> ? K : never;
}[keyof T], undefined>

export type IsNever<T> = [T] extends [never] ? true : false

/**
 * Declares a parameter option based on its schema definition:
 * - forbidden (`?: never`) when the operation defines no such parameters,
 * - optional when the parameters are optional or none of them is required,
 * - required otherwise.
 */
type ParameterOption<Name extends string, Value> = IsNever<Value> extends true
  ? Partial<Record<Name, never>>
  : undefined extends Value
    ? Partial<Record<Name, Exclude<Value, undefined>>>
    : IsNever<RequiredKeys<Value>> extends true
      ? Partial<Record<Name, Value>>
      : Record<Name, Value>

/**
 * Declares the `data` option, required whenever the operation declares a
 * required `requestBody` and forbidden when it declares none.
 */
type BodyOption<Value> = IsNever<Value> extends true
  ? { data?: never }
  : undefined extends Value
    ? { data?: Exclude<Value, undefined> }
    : { data: Value }

export type PathsWithMethod<Paths, PathnameMethod extends HttpMethod> = {
  [Pathname in keyof Paths]: Paths[Pathname] extends Record<PathnameMethod, any>
    ? Pathname
    : never;
}[keyof Paths]

export type ResponseObjectMap<T> = T extends { responses: any } ? T['responses'] : unknown
type Content<T> = T extends { content: any } ? T['content'] : unknown

/** Parameters of the given kind (`path`, `query`, `header`, `cookie`) for an operation. */
type ParametersOf<T, Kind extends string> = T extends { parameters: infer P }
  ? Kind extends keyof P ? P[Kind] : never
  : never

type BodyContent<T> = IsNever<T> extends true
  ? never
  : Content<T> extends Record<MediaType, infer U> ? U : never

export type RequestBody<T extends Record<string, any>> = 'requestBody' extends keyof T
  ? undefined extends T['requestBody']
    ? BodyContent<NonNullable<T['requestBody']>> | undefined
    : BodyContent<T['requestBody']>
  : never

export type ResponseContent<
  T extends Record<string | number, any>,
  Media extends MediaType = MediaType,
  ResponseCode extends keyof T = keyof T,
> = ResponseCode extends keyof T
  ? {
      [K in ResponseCode]: T[K]['content'] extends Record<string, any>
        ? FilterKeys<T[K]['content'], Media> extends never
          ? T[K]['content']
          : FilterKeys<T[K]['content'], Media>
        : K extends keyof T
          ? T[K]['content']
          : never;
    }[ResponseCode]
  : never

/** Every `2xx` status code declared by an operation. */
type OkStatus<T> = Extract<{
  [K in keyof T]: K extends number
    ? `${K}` extends `2${string}` ? K : never
    : K extends '2XX' ? K : never;
}[keyof T], keyof T>

/** Every `4xx`/`5xx` (and `default`) status code declared by an operation. */
type ErrorStatus<T> = Extract<{
  [K in keyof T]: K extends number
    ? `${K}` extends `4${string}` | `5${string}` ? K : never
    : K extends '4XX' | '5XX' | 'default' ? K : never;
}[keyof T], keyof T>

export type SuccessResponse<
  T extends Record<string | number, any>,
  Media extends MediaType = MediaType,
> = ResponseContent<T, Media, OkStatus<T>>

type ErrorResponse<
  T extends Record<string | number, any>,
  Media extends MediaType = MediaType,
> = ResponseContent<T, Media, ErrorStatus<T>>

/**
 * Header parameters declared by an operation, merged with arbitrary headers.
 * Always optional, headers may also be set on the client or in a hook.
 */
type HeaderOption<T> = IsNever<Exclude<ParametersOf<T, 'header'>, undefined>> extends true
  ? { headers?: HeadersInput }
  : { headers?: Partial<Exclude<ParametersOf<T, 'header'>, undefined>> & Values }

export type RequestOptions<
  T extends Record<string, any>,
  Type extends ResponseType = ResponseType,
> = Omit<BaseRequestOptions<any, Type>, 'url' | 'method' | 'data' | 'query' | 'params' | 'headers'> &
  ParameterOption<'params', ParametersOf<T, 'path'>> &
  ParameterOption<'query', ParametersOf<T, 'query'>> &
  BodyOption<RequestBody<T>> &
  HeaderOption<T>

/** Successful response data of a schema operation. */
export type ResponseData<
  Definition extends Record<string, any>,
  Path extends keyof Definition,
  Method extends keyof Definition[Path],
  Media extends MediaType = MediaType,
> = SuccessResponse<ResponseObjectMap<Definition[Path][Method]>, Media>

/** Error response data of a schema operation, as found on `error.data`. */
export type ErrorData<
  Definition extends Record<string, any>,
  Path extends keyof Definition,
  Method extends keyof Definition[Path],
  Media extends MediaType = MediaType,
> = ErrorResponse<ResponseObjectMap<Definition[Path][Method]>, Media>

/** The operation of a path for a method, e.g. `paths['/users']['get']`. */
export type Operation<
  Paths,
  Path extends keyof Paths,
  Method extends HttpMethod,
> = Paths[Path] extends Record<Method, infer O extends Record<string, any>> ? O : never
