// @ts-check
import { createConfig } from '@outloud/eslint-config'

export default createConfig({
  features: {
    stylistic: true,
  },
})
  .append({
    rules: {
      '@stylistic/newline-per-chained-call': ['error', { ignoreChainWithDepth: 2 }],
    },
    files: ['**/*.test.ts'],
  })
