# HTTP
HTTP client based on Fetch API with built-in support for retries, timeouts, and JSON handling.

<p>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white" alt="TypeScript">
  <a href="https://www.npmjs.com/package/@outloud/reqo"><img src="https://badgen.net/npm/v/@outloud/reqo/latest" alt="Version"></a>
  <a href="https://npmcharts.com/compare/@outloud/reqo?minimal=true"><img src="https://badgen.net/npm/dm/@outloud/reqo" alt="Downloads"></a>
  <a href="https://www.npmjs.com/package/@outloud/reqo"><img src="https://img.shields.io/npm/l/@outloud/reqo.svg?sanitize=true" alt="License"></a>
</p>

## Installation
```bash
npm install @outloud/reqo
```

## Usage
```ts
import { reqo } from '@outloud/reqo'

const data = await reqo.$get('https://api.example.com/data', {
  retries: 3,
  timeout: 5000
})
```

## Documentation
To learn more, check [documentation](https://reqo.byoutloud.com/).
