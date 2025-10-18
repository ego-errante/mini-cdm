# @fhevm/shared

Shared utilities and types for FHEVM packages in the mini-dcm monorepo.

## Overview

This package contains common code shared between `fhevm-hardhat-template` and `fhevm-react` packages, including:

- **Types**: Shared TypeScript interfaces and types
- **Constants**: Common configuration and constants
- **Utils**: Shared utility functions

## Installation

This package is automatically linked via npm workspaces. In consuming packages, add:

```json
{
  "dependencies": {
    "@fhevm/shared": "workspace:*"
  }
}
```

## Usage

```typescript
import {
  RowConfig,
  Dataset,
  ENCRYPTED_TYPE_SIZES,
  formatAddress,
} from "@fhevm/shared";

// Use shared types
const config: RowConfig = {
  type: "euint32",
  value: 42,
};

// Use shared utilities
const formatted = formatAddress("0x1234567890123456789012345678901234567890");
console.log(formatted); // "0x1234...7890"
```

## Development

### Build

```bash
npm run build:shared
```

### Watch mode (for development)

```bash
npm run dev:shared
```

### Clean build artifacts

```bash
npm run clean:shared
```

## Package Structure

```
src/
├── index.ts          # Main export file
├── types.ts          # Shared TypeScript types and interfaces
├── constants.ts      # Shared constants and configuration
└── utils/
    └── index.ts      # Utility functions
```

## Contributing

When adding new shared code:

1. Add the code to the appropriate file in `src/`
2. Export it from `src/index.ts`
3. Build the package: `npm run build:shared`
4. Use it in consuming packages

## License

BSD-3-Clause-Clear
