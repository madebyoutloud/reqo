// @ts-check
import { createConfig } from '@outloud/eslint-config'

export default createConfig({
  features: {
    stylistic: true,
  },
  style: {
    complexity: 20,
  },
})
  .append({ ignores: ['docs'] })
