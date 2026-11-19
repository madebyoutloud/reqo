import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { defaultSensitiveKeys, sanitize } from '../src/index.js'

describe('sanitize', () => {
  it('masks sensitive keys at any depth, ignoring case, - and _', () => {
    expect(sanitize({
      'Password': 'a',
      'newPassword': 'b',
      'x-api-key': 'c',
      'api_key': 'd',
      'apiKey': 'e',
      'refreshToken': 'f',
      'clientSecret': 'g',
      'Authorization': 'h',
      'list': [{ token: 'i' }],
      'name': 'kept',
      'password_hint': null,
    })).toEqual({
      'Password': '[REDACTED]',
      'newPassword': '[REDACTED]',
      'x-api-key': '[REDACTED]',
      'api_key': '[REDACTED]',
      'apiKey': '[REDACTED]',
      'refreshToken': '[REDACTED]',
      'clientSecret': '[REDACTED]',
      'Authorization': '[REDACTED]',
      'list': [{ token: '[REDACTED]' }],
      'name': 'kept',
      'password_hint': null,
    })
  })

  it('accepts custom keys and patterns', () => {
    expect(sanitize({ iban: 'x', password: 'y', ssn: 'z' }, { sensitiveKeys: ['iban', /^ssn$/] }))
      .toEqual({ iban: '[REDACTED]', password: 'y', ssn: '[REDACTED]' })

    expect(sanitize({ iban: 'x', password: 'y' }, { sensitiveKeys: [...defaultSensitiveKeys, 'iban'] }))
      .toEqual({ iban: '[REDACTED]', password: '[REDACTED]' })
  })

  it('replaces binary values and streams with placeholders', () => {
    expect(sanitize({
      file: new File(['a'.repeat(2_200_000)], 'scan.pdf'),
      blob: new Blob(['abc'], { type: 'image/png' }),
      buffer: Buffer.from('abcd'),
      arrayBuffer: new ArrayBuffer(10),
      bytes: new Uint8Array(3),
      stream: new ReadableStream(),
      nodeStream: Readable.from(['a']),
    })).toEqual({
      file: '[File scan.pdf, 2.1 MB]',
      blob: '[Blob image/png, 3 B]',
      buffer: '[Buffer, 4 B]',
      arrayBuffer: '[ArrayBuffer, 10 B]',
      bytes: '[Uint8Array, 3 B]',
      stream: '[Stream]',
      nodeStream: '[Stream]',
    })
  })

  it('converts FormData and URLSearchParams to objects', () => {
    const form = new FormData()
    form.append('tag', 'a')
    form.append('tag', 'b')
    form.append('password', 'p')
    form.append('file', new Blob(['x']), 'a.txt')

    expect(sanitize(form)).toEqual({ tag: ['a', 'b'], password: '[REDACTED]', file: '[File a.txt, 1 B]' })
    expect(sanitize(new URLSearchParams('a=1&token=t'))).toEqual({ a: '1', token: '[REDACTED]' })
  })

  it('parses JSON strings', () => {
    expect(sanitize('{"password":"p","a":1}')).toEqual({ password: '[REDACTED]', a: 1 })
    expect(sanitize('plain text')).toBe('plain text')
  })

  it('handles circular references, dates, errors and bigints', () => {
    const value: Record<string, unknown> = { date: new Date(0), error: new Error('boom'), big: 1n, fn: () => 1 }
    value.self = value

    expect(sanitize(value)).toEqual({
      date: '1970-01-01T00:00:00.000Z',
      error: { name: 'Error', message: 'boom' },
      big: '1',
      self: '[Circular]',
    })
  })

  it('cuts the result to maxLength', () => {
    const result = sanitize({ text: 'x'.repeat(5000) })

    expect(typeof result).toBe('string')
    expect((result as string).length).toBeLessThan(4200)
    expect(sanitize({ text: 'x'.repeat(5000) }, { maxLength: false })).toEqual({ text: 'x'.repeat(5000) })
  })
})
