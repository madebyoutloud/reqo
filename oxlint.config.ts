import { createConfig } from '@outloud/oxlint-config'

export default createConfig({
  // `nuxt` and `vue` are resolvable here only through the docs workspace package
  features: { vue: false, nuxt: false },
  ignorePatterns: ['docs/**', 'tests/data/**'],
})
