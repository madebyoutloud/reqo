# From axios or a fetch wrapper to @outloud/reqo 3

Moves a project's HTTP client from axios, or from a hand-written fetch
wrapper, to reqo 3. It covers a service class around an axios instance, its
interceptors, `axios-retry`, downloads, uploads and error handling, and a
fetch wrapper with its own exception class.

Upload progress is not replaced. reqo is built on fetch, which reports no
upload progress, so `onUploadProgress` is removed and uploads become plain
requests.

## Changes

| axios | reqo |
| --- | --- |
| `axios.create({ baseURL, headers })` | `createClient({ id, name, url, headers })` |
| a service class with `get`, `$get`, `$post` and so on | the reqo `Client`, which has the same methods |
| `client.defaults.baseURL`, a `getUrl(endpoint)` helper | `api.baseUrl`, `api.getUrl(path)` |
| `client.defaults.headers.common[name] = value` | a `request` hook that sets the header, see step 3 |
| `interceptors.request.use(fn)` | `api.on('request', (config, state) => {})`, runs before each attempt |
| `interceptors.response.use(fn)` | `api.on('response', (response) => {})` |
| `interceptors.response.use(null, fn)` | `api.on('error', (error) => {})`, return an `Error` to replace it |
| `withCredentials: true` | `credentials: 'include'`, per request or in an `init` hook |
| `params: { page }` (query string) | `query: { page }` |
| `` `/users/${id}` `` | `'/users/{id}'` with `params: { id }`, optional |
| `post(url, body, config)` | `post(url, { data: body, ...options })` |
| `delete(url, { data })` | `delete(url, { data })`, unchanged |
| `responseType: 'blob'` | `responseType: 'blob'`, unchanged |
| `responseType: 'arraybuffer'` | `responseType: 'arrayBuffer'` |
| `response.headers['x-total']` | `response.headers.get('x-total')` |
| `timeout: 10000` (none by default) | `timeout: 10_000` per attempt (60 seconds by default), `totalTimeout` for the whole request |
| `axiosRetry(client, options)` | `retry: { limit, statusCodes, codes, delay }` |
| `signal: controller.signal` | `signal: controller.signal`, unchanged |
| `CancelToken` | `signal`, or `request.cancel()` on the returned `RequestPromise` |
| `axios.isCancel(error)` | `api.isError(error) && error.kind === 'canceled'` |
| `isAxiosError(error)` | `api.isError(error)`, or `isRequestError(error)` from `@outloud/reqo` |
| `error.response.status` | `error.status`, `undefined` without a response |
| `error.response.data` | `error.data` |
| `error.response.headers` | `error.response?.headers` |
| `error.code` (`ERR_BAD_REQUEST`, `ECONNABORTED`, `ERR_NETWORK`, `ERR_CANCELED`) | `error.kind` (`http`, `timeout`, `network`, `canceled`) |
| `validateStatus` | the client option `validate(response)` |
| `onUploadProgress`, `onDownloadProgress` | dropped, no replacement |
| `transformRequest`, `transformResponse` | no option: map the data in the caller or a `response` hook |
| `paramsSerializer` | no option: build the query string yourself and put it in the URL |
| `toFormData(object)`, imported from axios | no helper: a project function, see step 6 |
| `adapter: 'fetch'` | removed, reqo always uses fetch |
| `AxiosRequestConfig`, `AxiosResponse<T>` | `RequestOptions`, `Response<T>` from `@outloud/reqo` |

A fetch wrapper maps the same way:

| fetch wrapper | reqo |
| --- | --- |
| `APIException` with `statusCode` and `data` | `RequestError` with `status` and `data` |
| `statusCode === -1` without a response | `status === undefined`, or `kind` |
| `qs.stringify(params)` appended to the URL | `query` |
| `await response.json()` on every response | `responseType: 'auto'` reads JSON, text or a `Blob` by content type |
| a manual `content-type` for objects, none for `FormData` | the same, done by reqo |
| `delete(url, body)` | `delete(url, { data: body })` |

Behaviour that changes without a type error:

- `params` holds path parameters. It fills `{name}` placeholders and nothing
  else, so an axios `params: { page: 1 }` passed to reqo is dropped from the
  URL.
- The second argument of every method is the options. A body or a query
  object passed there often typechecks and is never sent.
- A `Date` in `query` is dropped. axios sent `toISOString()`: convert it
  yourself. Arrays are sent as `ids[]=1&ids[]=2` and nested objects as
  `filter[name]=a`, like axios. `qs` sent arrays as `ids[0]=1` by default.
  `null` and `undefined` are skipped.
- A `content-type: application/json` header on the client is also sent with
  a `FormData` body, and the server can't read the upload. axios removed it
  for `FormData`. reqo sets `application/json` for object bodies itself, so
  leave it out of the client headers.
- Each attempt times out after 60 seconds by default. axios has no default
  timeout. A large upload or a slow export needs `timeout: false` or a
  longer one.
- `error.message` is reqo's, such as `API: POST /users failed with status 422.`,
  never the server's message. Read the server's message from `error.data`.
- With `responseType: 'auto'` the body is read by its content type. A JSON
  body sent as `text/plain` or without a content type resolves to a string,
  where axios parsed it. A successful response with a JSON content type and
  an empty body rejects with `kind: 'parse'`. Pass `responseType: 'json'`,
  `'text'` or `false` for such endpoints.
- In the browser, axios sent the `XSRF-TOKEN` cookie as an `X-XSRF-TOKEN`
  header on same-origin requests. reqo doesn't. If the API checks it, add the
  hook of step 2.
- Request headers override client headers whatever the case of the name. A
  `null` value removes a client header for one request.

## Steps

Find the old client first: the module that creates the axios instance or
calls `fetch`, and where the app provides it.

    grep -rnE "from ['\"]axios['\"]|axios-retry|axios\.create\(|new [A-Za-z]*(API|Api)Service\(|class [A-Za-z]*(API|Api)Service\b" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .

The steps search the whole project for method names that other clients
share. Change only calls on the API client, including when it is passed
around or injected under another name, such as `$api` or `this.api`.

Replace the service class with a reqo client. Its `get`, `$get`, `post`,
`$post` and so on keep their names, so most call sites only change their
arguments. Helpers of the class move out: `verifyError(error)` becomes
`if (!api.isError(error)) throw error`, and app helpers such as `toFormData`
become plain functions.

### 1. Create the reqo client

**Check:** `grep -rnE "axios\.create\(|new [A-Za-z]*(API|Api)Service\(|baseURL|withCredentials|adapter:" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .`. Skip when the project already creates a reqo client.

Install reqo: `npm install @outloud/reqo`.

Before:

    import axios, { type AxiosInstance } from 'axios'

    export class ApiService {
      client: AxiosInstance

      constructor(options: { url: string, headers?: Record<string, string> }) {
        this.client = axios.create({
          baseURL: options.url,
          headers: { 'Content-Type': 'application/json', ...options.headers },
          withCredentials: true,
          timeout: 30000,
        })
      }

      getUrl(endpoint?: string) {
        return [this.client.defaults.baseURL, endpoint].filter(Boolean).join('/')
      }
    }

After:

    import { createClient } from '@outloud/reqo'

    export function createApi(options: { url: string, headers?: Record<string, string> }) {
      const api = createClient({
        id: 'api',
        name: 'API',
        url: options.url,
        headers: options.headers,
        timeout: 30_000,
      })

      api.on('init', (config) => {
        config.credentials ??= 'include'
      })

      return api
    }

    window.open(api.getUrl('files/1/download'))

Drop `Content-Type: application/json` from the headers: reqo sets it for
object bodies, and keeping it breaks `FormData` uploads. The client options
have no `credentials`, so the `init` hook sets it for every request; a
request can still pass its own. `withCredentials: false` needs nothing, as
fetch sends cookies to the same origin by default. Drop `adapter`. Name each
client, so errors and logs say which API failed. An app with two APIs creates
two clients.

`api.getUrl(path)` joins the base URL and the path. It doesn't fill `{name}`
placeholders or add a query.

Before, a fetch wrapper:

    export class APIService {
      constructor(private options: { url: string, headers?: Record<string, any> }) {}

      async request<T>(options: APIRequestOptions): Promise<APIResponse<T>> {
        let url = this.getUrl(options.url)

        if (options.params) {
          url += `?${qs.stringify(options.params)}`
        }

        const response = await fetch(url, { method: options.method, headers, body })
        const data = await response.json()

        if (!response.ok) {
          throw APIException.fromResponse(Object.assign(response, { data }))
        }

        return Object.assign(response, { data })
      }
    }

After:

    const api = createClient({ id: 'api', name: 'API', url: options.url, headers: options.headers })

Delete the wrapper and its body, query and content type handling. reqo does
all of it.

In Nuxt, create the client in a plugin and provide it. The plugin runs for
each server request, so the client acts as that user. Forward only the
`cookie` header: forwarding every incoming header can send the wrong `host`
or break fetch, for example with `transfer-encoding`.

    export default defineNuxtPlugin(() => {
      const config = useRuntimeConfig()

      const api = createApi({
        url: import.meta.server ? config.apiUrl : '/api',
        headers: import.meta.server ? useRequestHeaders(['cookie']) : {},
      })

      return { provide: { api } }
    })

### 2. Move interceptors to hooks

**Check:** `grep -rnE "interceptors\.(request|response)|onRequest|onError" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .` and keep the ones on the API client. Skip when none are.

Before:

    client.interceptors.request.use(async (request) => {
      const token = await auth.getToken()

      if (token) {
        request.headers.authorization = `Bearer ${token}`
      }

      return request
    })

    client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          redirectToLogin()
        }

        return Promise.reject(APIException.fromAxiosError(error))
      },
    )

After:

    api.on('request', async (config) => {
      const token = await auth.getToken()

      if (token) {
        config.headers.set('authorization', `Bearer ${token}`, true)
      }
    })

    api.on('error', (error) => {
      if (error.status === 401) {
        redirectToLogin()
      }
    })

A `request` hook runs before each attempt, retries included, and an `init`
hook once per request. Hooks change `config` in place and return nothing.
`config.headers.set(name, value)` keeps a header that is already set, by the
request or by an earlier attempt: pass `true` to override it, as above for a
token that can change. An `error` hook that returns an `Error` replaces the
thrown one, and one that returns nothing keeps it. Step 9 covers the
exception classes. A `response` hook can change `response.data`, but no hook
can turn a failed request into a successful one. Hooks that several clients
share go in a plugin, `(client) => { client.on(...) }`, passed in `plugins`.

A hook that signs requests reads `config.method` and the URL. `config.url` is
the full URL template, base URL included, and `config.path` the path as
passed, without the query, such as `/users/{id}`. axios gave the URL as
passed, query included. Check what the server signs, and fill placeholders
and append the query when it needs them:

    api.on('request', (config) => {
      const path = config.path.replace(/\{(\w+)\}/g, (_, name) => encodeURIComponent(String(config.params[name])))
      const signature = sign({ method: config.method, url: path })

      config.headers.set('x-request-nonce', signature.nonce, true)
      config.headers.set('x-request-timestamp', signature.timestamp, true)
      config.headers.set('signature', signature.signature, true)
    })

When the API checks the XSRF token that axios sent from the cookie:

    api.on('request', (config) => {
      const token = typeof document === 'undefined' ? undefined : document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1]

      if (token) {
        config.headers.set('x-xsrf-token', decodeURIComponent(token))
      }
    })

### 3. Replace changes to default headers

**Check:** `grep -rnE "defaults\.headers|setHeader\(|setEnv\(|setLocaleHeader\(" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .` and keep the ones on the API client. Skip when none are.

Before:

    setHeader(name: string, value: string | null) {
      if (value) {
        this.client.defaults.headers.common[name] = value
      } else {
        delete this.client.defaults.headers.common[name]
      }
    }

    $api.client.defaults.headers.common['x-env'] = env

After:

    const sharedHeaders: Record<string, string | undefined> = {}

    api.on('request', (config) => {
      config.headers.set(sharedHeaders)
    })

    sharedHeaders['x-env'] = env
    sharedHeaders['x-env'] = undefined

The hook reads the values on each request and doesn't override a header the
request sets. It can read app state directly instead, such as a store or a
cookie. On a server, keep such state per request, never in a module shared by
requests of different users.

### 4. Pass options as the second argument

**Check:** `grep -rnE '\.\$?(get|post|put|patch|delete)(<[^(]*>)?\(' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .` and keep the calls on the API client that pass more than the URL. Skip when none do.

Service classes had two shapes: `$get(url, query, options)` and
`$get(url, axiosConfig)`. Both become `$get(url, options)`.

Before:

    await api.$get('/users', { status: 'active' })
    await api.$get('/users', { params: { status: 'active', page } })
    await api.$get('/firmware/1/download', { method: 'redirect' }, { responseType: 'blob' })
    await api.$post('/users', payload)
    await api.$patch(`/users/${id}`, changes, { headers: { 'x-locale': locale } })
    await api.$delete(`/users/${id}`, { data: { reason } })
    await api.get('/reports', { params: { from: startDate } })

After:

    await api.$get('/users', { query: { status: 'active' } })
    await api.$get('/users', { query: { status: 'active', page } })
    await api.$get('/firmware/1/download', { query: { method: 'redirect' }, responseType: 'blob' })
    await api.$post('/users', { data: payload })
    await api.$patch('/users/{id}', { params: { id }, data: changes, headers: { 'x-locale': locale } })
    await api.$delete('/users/{id}', { params: { id }, data: { reason } })
    await api.get('/reports', { query: { from: startDate.toISOString() } })

Rename every axios `params` to `query`. Convert `Date` values in `query` to
strings. A call that keeps an axios-only option, such as `onUploadProgress`
or `transformResponse`, doesn't typecheck: step 6 and the table say what
replaces it. `{name}` placeholders with `params` are optional: a template
literal still works, but `params` encodes the values and keeps the path
template in errors.

`get`, `post` and the other methods without `$` return the `Response` with
`data`, like axios. Its `headers` is a `Headers` object: read
`response.headers.get('x-total')` instead of `response.headers['x-total']`.

### 5. Check downloads

**Check:** `grep -rnE "responseType|\.headers\[" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .` and keep the calls on the API client and the reads on its responses. Skip when none are.

Before:

    const response = await api.post(`/protocols/${id}/export`, payload, { responseType: 'blob' })
    const name = response.headers['content-disposition']
    const pdf = await api.$get(url, { responseType: 'arraybuffer' })

After:

    const response = await api.post('/protocols/{id}/export', { params: { id }, data: payload, responseType: 'blob' })
    const name = response.headers.get('content-disposition')
    const pdf = await api.$get(url, { responseType: 'arrayBuffer' })

`'blob'` and `'text'` are unchanged, `'arraybuffer'` becomes
`'arrayBuffer'`. A download without `responseType` resolves to a `Blob` for
a binary content type, but sends `accept: application/json`: keep
`responseType: 'blob'` on downloads. Pass `timeout: false` or a longer
timeout for large or slow ones.

### 6. Make uploads plain requests

**Check:** `grep -rnE "onUploadProgress|onDownloadProgress|multipart/form-data|new FormData|toFormData" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .`. Skip when nothing matches.

Before:

    const data = new FormData()
    data.append('file', file)

    const response = await api.post(endpoint, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        upload.progress = event.total ? event.loaded / event.total : 0
      },
      signal: controller.signal,
    })

    upload.progress = 1

After:

    const data = new FormData()
    data.append('file', file)

    const response = await api.post(endpoint, { data, signal: controller.signal, timeout: false })

    upload.progress = 1

Remove `onUploadProgress` and the code that only fed it. A progress bar shows
an indeterminate state while the request runs and completes when it
resolves. Remove a `multipart/form-data` content type: fetch sets it with the
boundary. A client `content-type` header must be gone too, see step 1. Keep
`signal` for cancel buttons.

Code that imports `toFormData` from axios needs its own helper. axios wrote
arrays as `ids[]`, nested objects as `address[city]`, dates with
`toISOString()`, and skipped `undefined`. Write a function that builds the
same keys, so the API reads the fields as before.

### 7. Replace `axios-retry` with `retry`

**Check:** `grep -rnE "axios-retry|axiosRetry|exponentialDelay" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .`. Skip when nothing matches.

Before:

    import axiosRetry, { exponentialDelay } from 'axios-retry'

    axiosRetry(client, {
      retries: 4,
      retryDelay: (count) => exponentialDelay(count, undefined, 1000),
      retryCondition: (error) =>
        ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED'].includes(error.code ?? '') ||
        [502, 503, 504].includes(error.response?.status ?? 0),
      onRetry: (count, error, config) => console.log(`Retry ${count}: ${config.url}`),
    })

After:

    const api = createClient({
      url,
      retry: {
        limit: 4,
        statusCodes: [502, 503, 504],
        codes: ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'E_NETWORK'],
        delay: ({ retryCount }) => 2 ** retryCount * 1000,
      },
    })

    api.on('request', (config, state) => {
      if (state.error) {
        console.log(`Retry ${state.retryCount}: ${config.method} ${config.path}`)
      }
    })

`retry` goes on the client or on one request, and retries are off without
it. `limit` is the number of retries; axios-retry's default is 3, reqo's is 2.
`retryCount` is 1 before the first retry. Network codes such as `ENOTFOUND`
only exist on a server: in the browser a network error has the code
`E_NETWORK`, so add it to retry those there. An attempt that times out has
`E_TIMEOUT` and is retried by default. A delay above `maxDelay`, 60 seconds
by default, ends the retries instead of waiting.

Only `GET`, `HEAD` and `OPTIONS` are retried. A custom `retryCondition` that
didn't check the method retried writes too. Add `methods: ['POST']` and other
methods only for idempotent endpoints. For full control, `validate(state)`
returns `true` or `false`, or `undefined` for the default decision. Add
`totalTimeout` to requests a user waits for.

### 8. Check cancellation and timeouts

**Check:** `grep -rnE "CancelToken|isCancel|ERR_CANCELED|ECONNABORTED|AbortError|signal:|timeout:" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .` and keep the ones on calls on the API client or on its errors. Skip when none are.

Before:

    const source = axios.CancelToken.source()
    api.$get('/search', { params: { q }, cancelToken: source.token })
    source.cancel()

    if (axios.isCancel(error) || error.name === 'AbortError') return

    if (error.code === 'ECONNABORTED') showTimeout()

After:

    const request = api.$get('/search', { query: { q } })
    request.cancel()

    if (api.isError(error) && error.kind === 'canceled') return

    if (api.isError(error) && error.kind === 'timeout') showTimeout()

`signal: controller.signal` works as before; aborting it rejects with
`kind: 'canceled'`. Every call returns a `RequestPromise` with `cancel()` and
`timeout(ms)`. `then`, `catch` and `finally` return a plain `Promise`, so
keep the request to cancel it. A `signal` in the client options aborts all of
its requests.

### 9. Handle `RequestError` instead of axios errors and `APIException`

**Check:** `grep -rnE "isAxiosError|AxiosError|\.response\??\.(status|data|headers)|statusCode|APIException|ApiException|verifyError|==\s*-1" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .` and keep the reads on errors of the API client. Skip when none are.

Before:

    try {
      await api.$post('/users', payload)
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 422) {
        return showErrors(error.response.data.errors)
      }

      throw error
    }

    if (error instanceof APIException && error.statusCode === 401) logout()
    if (error instanceof APIException && error.statusCode === -1) showOffline()
    notify(error.message)

After:

    try {
      await api.$post('/users', { data: payload })
    } catch (error) {
      if (!api.isError(error) || error.status !== 422) {
        throw error
      }

      return showErrors(error.data.errors)
    }

    if (api.isError(error) && error.status === 401) logout()
    if (api.isError(error) && (error.kind === 'network' || error.kind === 'timeout')) showOffline()
    notify(error.data?.error?.message ?? error.message)

A `RequestError` has `kind`, `status` (`undefined` without a response),
`code`, `data` (the response body), `response` and `config`. Its message
names the client and the endpoint, so read the server's message from
`data`. Branch on `kind` and `status`, never on the message. App helpers that
read the body, such as validation errors, take `error.data`. Log
`error.toJSON()`, never the error or its `config`, which hold the request
headers.

To keep an app exception class and its callers, return it from an `error`
hook instead:

    api.on('error', (error) => new APIException(error.data?.error?.message ?? error.message, error.status, error.data))

Callers then keep `instanceof APIException`, but `api.isError()` no longer
matches and `kind` and `code` are lost unless the class copies them. Make
its `statusCode` read `status`, and handle `undefined` where it used `-1`.
Don't set the `RequestError` as its `cause`: loggers print causes, and the
`RequestError` holds the request headers.

### 10. Remove axios

**Check:** `grep -rnE "from ['\"](axios|axios-retry|qs)['\"]|Axios[A-Z][A-Za-z]*" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' --exclude-dir=node_modules .`. Skip when nothing matches.

Before:

    import type { AxiosRequestConfig, AxiosResponse } from 'axios'

    function load(config?: AxiosRequestConfig): Promise<AxiosResponse<User[]>> {}

After:

    import type { RequestOptions, Response as ApiResponse } from '@outloud/reqo'

    function load(options?: RequestOptions): Promise<ApiResponse<User[]>> {}

Then remove `axios` and `axios-retry` from `package.json`, and `qs` when only
the old client used it. Keep `axios` only for code that calls other services
with it on purpose, such as a server route.

## Verify

- `pnpm typecheck` passes.
- The check of step 10 finds no axios import in code that calls the API.
- No call on the API client passes `params` for query values, a `Date` in
  `query`, or a body as the second argument.
- No client sets a `content-type` header, and no upload sets
  `multipart/form-data` or `onUploadProgress`.
- Uploads and long downloads pass `timeout: false` or a longer timeout.
- No code compares an API error's status to `-1`.
- In the app: sign in, load a list with filters and pagination, submit a form
  with a validation error, upload a file, download a file, and cancel a
  request. Check the query strings and headers in the browser's network tab.
- The project's tests pass.
