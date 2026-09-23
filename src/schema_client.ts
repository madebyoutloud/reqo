/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { Future } from '@outloud/future'

import type {
  OptionalResponseType as ResponseType,
  RequestOptions as BaseRequestOptions,
  ResponseOrData,
  Values,
} from './types.js'
import { BaseClient } from './base_client.js'
import { shortcuts } from './client.js'

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

type FilterKeys<T, K> = T[keyof T & K]
type MediaType = `${string}/${string}`

/** Keys of `T` that are not optional. */
type RequiredKeys<T> = Exclude<{
  [K in keyof T]: T extends Record<K, T[K]> ? K : never;
}[keyof T], undefined>

type IsNever<T> = [T] extends [never] ? true : false

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

type PathsWithMethod<Paths extends {}, PathnameMethod extends HttpMethod> = {
  [Pathname in keyof Paths]: Paths[Pathname] extends Record<PathnameMethod, any>
    ? Pathname
    : never;
}[keyof Paths]

type ResponseObjectMap<T> = T extends { responses: any } ? T['responses'] : unknown
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

type SuccessResponse<
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
  ? { headers?: Values }
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

type ClientMethod<
  Definition extends Record<string, Record<HttpMethod, {}>>,
  Method extends HttpMethod,
  ReturnData extends boolean = false,
  Media extends MediaType = MediaType,
> = <
  Path extends PathsWithMethod<Definition, Method>,
  Type extends ResponseType = ResponseType,
>(
  url: Path,
  ...options: IsNever<RequiredKeys<RequestOptions<Definition[Path][Method], Type>>> extends true
    ? [options?: RequestOptions<Definition[Path][Method], Type>]
    : [options: RequestOptions<Definition[Path][Method], Type>]
) => Future<
  ResponseOrData<
    SuccessResponse<ResponseObjectMap<Definition[Path][Method]>, Media>,
    Type,
    ReturnData
  >
>

export interface SchemaClient<Definition extends Record<string, any>> {
  head: ClientMethod<Definition, 'head'>
  get: ClientMethod<Definition, 'get'>
  post: ClientMethod<Definition, 'post'>
  patch: ClientMethod<Definition, 'patch'>
  put: ClientMethod<Definition, 'put'>
  delete: ClientMethod<Definition, 'delete'>

  $get: ClientMethod<Definition, 'get', true>
  $put: ClientMethod<Definition, 'put', true>
  $patch: ClientMethod<Definition, 'patch', true>
  $post: ClientMethod<Definition, 'post', true>
  $delete: ClientMethod<Definition, 'delete', true>
}

@shortcuts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class SchemaClient<Definition extends Record<string, any>> extends BaseClient {

}
