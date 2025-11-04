// vitest.setup.js
import { beforeAll, afterEach, afterAll } from 'vitest'
import './mocks/storage.js'
import { server } from './mocks/api.js'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
