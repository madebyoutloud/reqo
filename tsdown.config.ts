import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/plugins/*.ts'],
  clean: true,
  treeshake: true,
  outDir: './dist',
  format: ['esm'],
  dts: true,
  platform: 'neutral',
  target: 'es2022',
  tsconfig: 'tsconfig.build.json',
})
