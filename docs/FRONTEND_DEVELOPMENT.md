# Frontend Development Guide

Comprehensive guide for developing with the Mini-DCM React frontend, including architecture, FHEVM integration, component patterns, and deployment.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [FHEVM Integration](#fhevm-integration)
- [Deployment](#deployment)
- [Best Practices](#best-practices)

## Tech Stack

### Core Framework

- **Next.js 15**: App router, React Server Components, route handlers
- **React 19**: Concurrent features, modern hooks, automatic batching
- **TypeScript 5**: Type safety, improved inference

### State Management

- **TanStack Query v5**: Server state management, caching, synchronization
- **React Context**: Global app state (MetaMask, FHEVM, contracts)
- **React Hook Form**: Form state and validation

### Blockchain

- **Ethers.js v6**: Contract interaction, wallet connectivity
- **FHEVM SDK** (`@zama-fhe/relayer-sdk`): Encryption/decryption via Zama relayer
- **MetaMask**: Wallet provider with EIP-6963 support

### UI Components

- **Radix UI**: Accessible, unstyled component primitives
- **Tailwind CSS**: Utility-first styling
- **shadcn/ui**: Pre-styled Radix components
- **Lucide React**: Icon library
- **Sonner**: Toast notifications

### Development Tools

- **Vitest**: Unit testing framework
- **Testing Library**: React component testing
- **ESLint**: Code linting
- **Prettier**: Code formatting

## Project Structure

```
packages/site/
├── app/                          # Next.js app router
│   ├── layout.tsx                # Root layout with providers
│   ├── page.tsx                  # Home page (Overview)
│   ├── providers.tsx             # Client-side providers
│   └── globals.css               # Global styles + Tailwind
│
├── components/                   # React components
│   ├── ui/                       # Radix UI components (shadcn)
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── card.tsx
│   │   └── ...
│   │
│   ├── Overview.tsx              # Main dashboard component
│   ├── DatasetCard.tsx           # Dataset display card
│   ├── DatasetDrawer.tsx         # Dataset details sidebar
│   ├── ActivityTable.tsx         # Jobs/requests table
│   ├── CreateDatasetModal.tsx    # Dataset creation modal
│   ├── NewRequestModal.tsx       # Job request modal
│   ├── JobProcessorModal.tsx     # Row processing UI
│   ├── ViewResultModal.tsx       # Result decryption modal
│   ├── FilterBuilder.tsx         # Visual filter editor
│   ├── GasAllowanceMonitor.tsx   # Real-time gas tracking
│   ├── StatusBadgesPopover.tsx   # Network status indicator
│   └── ErrorNotDeployed.tsx      # Error state component
│
├── hooks/                        # Custom React hooks
│   ├── useCDMContext.tsx         # Global context consumer
│   ├── useDatasetRegistry.ts     # DatasetRegistry contract
│   ├── useJobManager.ts          # JobManager contract
│   ├── useGasPrice.ts            # Gas price monitoring
│   ├── useInMemoryStorage.tsx    # Local storage wrapper
│   └── metamask/                 # MetaMask integration
│       ├── useEip6963.tsx        # EIP-6963 multi-wallet
│       ├── useMetaMaskProvider.tsx
│       └── useMetaMaskEthersSigner.tsx
│
├── lib/                          # Utility functions
│   ├── utils.ts                  # Generic utilities (cn, etc.)
│   ├── datasetUtils.ts           # Dataset helpers
│   └── datasetHelpers.ts         # Activity aggregation
│
├── abi/                          # Generated contract ABIs
│   ├── DatasetRegistryABI.ts     # Auto-generated from contracts
│   ├── DatasetRegistryAddresses.ts
│   ├── JobManagerABI.ts
│   └── JobManagerAddresses.ts
│
├── public/                       # Static assets
│   └── zama-logo.svg
│
├── next.config.ts                # Next.js configuration
├── tailwind.config.ts            # Tailwind configuration
├── tsconfig.json                 # TypeScript configuration
├── vitest.config.ts              # Vitest configuration
└── package.json
```

### File Naming Conventions

- **Components**: PascalCase (`DatasetCard.tsx`)
- **Hooks**: camelCase with `use` prefix (`useJobManager.ts`)
- **Utilities**: camelCase (`datasetHelpers.ts`)
- **Types**: PascalCase interfaces/types in dedicated files

## FHEVM Integration

### Overview

FHEVM enables encryption and decryption of data through Zama's relayer service. The `useFhevm` hook manages the FHEVM instance lifecycle.

### FHEVM Lifecycle

```
┌──────────────────────────────────────────────────────┐
│ 1. Initialize FHEVM Instance                         │
│    • Detect network (chainId)                        │
│    • Connect to Zama relayer                         │
│    • Setup encryption keys                           │
└────────────────┬─────────────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────────────┐
│ 2. Instance Ready                                     │
│    • Status: "ready"                                  │
│    • Instance available for encrypt/decrypt           │
└────────────────┬─────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌─────────────┐   ┌─────────────┐
│  Encrypt    │   │  Decrypt    │
│  User Input │   │  Result     │
└─────────────┘   └─────────────┘
```

## Deployment

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start Hardhat node (terminal 1)
npm run hardhat-node

# 3. Start frontend (terminal 2)
npm run dev:mock
```

### Production Build

```bash
# Build shared package
npm run build:shared

# Build frontend
cd packages/site
npm run build

# Test production build
npm run start
```

### Netlify Deployment

**Configuration** (`netlify.toml`):

```toml
[build]
  command = "npm run build:shared && cd packages/site && npm run build"
  publish = "packages/site/.next"
  base = "/"

[build.environment]
  NODE_VERSION = "20"
  NETLIFY = "true"  # Skip hardhat deploy

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

**Environment Variables**:

- Set `NETLIFY=true` to skip Hardhat deployment during build
- Configure network detection for Sepolia/Mainnet

### Environment-Specific Configuration

```typescript
// lib/constants.ts
export const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const IS_NETLIFY = process.env.NETLIFY === "true";

export const DEFAULT_CHAIN_ID = IS_PRODUCTION ? 11155111 : 31337; // Sepolia : Hardhat

export const RPC_URLS = {
  31337: "http://127.0.0.1:8545", // Local
  11155111: `https://sepolia.infura.io/v3/${process.env.NEXT_PUBLIC_INFURA_KEY}`,
};
```

## Best Practices

### State Management

1. **Use TanStack Query for Server State**: Contracts, blockchain data
2. **Use React Context for App State**: Wallet, FHEVM instance
3. **Use Local State for UI State**: Modal open/close, form inputs

### Code Organization

1. **Colocation**: Keep related code together
2. **Barrel Exports**: Use `index.ts` for clean imports
3. **Type Safety**: Leverage TypeScript strictly
4. **Documentation**: JSDoc for complex functions

---

**Related Documentation**:

- [Architecture Guide](ARCHITECTURE.md)
- [Request & Job Lifecycle](REQUEST_JOB_LIFECYCLE.md)
- [Filter VM Specification](FILTER_VM.md)
