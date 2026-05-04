/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { Future } from '@outloud/future'

import type {
  OptionalResponseType as ResponseType,
  RequestOptions as BaseRequestOptions,
  ResponseOrData,
} from './types.js'
import { BaseClient } from './base_client.js'
import { shortcuts } from './client.js'

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'
type OkStatus = 200 | 201 | 202 | 203 | 204 | 206 | 207 | '2XX'

type FilterKeys<T, K> = T[keyof T & K]
type MediaType = `${string}/${string}`

type PathsWithMethod<Paths extends {}, PathnameMethod extends HttpMethod> = {
  [Pathname in keyof Paths]: Paths[Pathname] extends Record<PathnameMethod, any>
    ? Pathname
    : never;
}[keyof Paths]

type ResponseObjectMap<T> = T extends { responses: any } ? T['responses'] : unknown
type Content<T> = T extends { content: any } ? T['content'] : unknown

export type RequestBody<T extends Record<string, any>> = 'requestBody' extends keyof T
  ? Content<T['requestBody']> extends Record<MediaType, infer U>
    ? U
    : never
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

type SuccessResponse<
  T extends Record<string | number, any>,
  Media extends MediaType = MediaType,
> = ResponseContent<T, Media, OkStatus>

export interface RequestOptions<
  T extends Record<string, any>,
  Type extends ResponseType = ResponseType,
> extends Omit<BaseRequestOptions<any, Type>, 'url' | 'method' | 'data' | 'query' | 'params'> {
  query?: T['parameters']['query']
  params?: T['parameters']['path']
  data?: RequestBody<T>
}

type ClientMethod<
  Definition extends Record<string, Record<HttpMethod, {}>>,
  Method extends HttpMethod,
  Media extends MediaType,
  ReturnData extends boolean = false,
> = <
  Path extends PathsWithMethod<Definition, Method>,
  Type extends ResponseType = ResponseType,
>(
  url: Path,
  options?: RequestOptions<Definition[Path][Method], Type>,
) => Future<
  ResponseOrData<
    SuccessResponse<ResponseObjectMap<Definition[Path][Method]>, Media>,
    Type,
    ReturnData
  >
>

export interface SchemaClient<Definition extends Record<string, any>> {
  head: ClientMethod<Definition, 'head', MediaType>
  get: ClientMethod<Definition, 'get', MediaType>
  post: ClientMethod<Definition, 'post', MediaType>
  patch: ClientMethod<Definition, 'patch', MediaType>
  put: ClientMethod<Definition, 'put', MediaType>
  delete: ClientMethod<Definition, 'delete', MediaType>

  $get: ClientMethod<Definition, 'get', MediaType, true>
  $put: ClientMethod<Definition, 'put', MediaType, true>
  $patch: ClientMethod<Definition, 'patch', MediaType, true>
  $post: ClientMethod<Definition, 'post', MediaType, true>
  $delete: ClientMethod<Definition, 'delete', MediaType, true>
}

@shortcuts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class SchemaClient<Definition extends Record<string, any>> extends BaseClient {

}
