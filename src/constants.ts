import type { RequestMethod, ResponseType } from './types.js'

export const streamTypes = [
  'ArrayBuffer',
  'Blob',
  'Buffer',
  'Stream',
  'ReadableStream',
] as const

export const responseTypes: Record<ResponseType, string> = {
  auto: 'application/json',
  json: 'application/json',
  text: 'text/*',
  blob: '*/*',
  arrayBuffer: '*/*',
}

export const methods: RequestMethod[] = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']

export const contentTypes = {
  json: /application\/(?:[\w.]+\+)?json/,
  text: /text\/plain/,
}
