# Frontend Development Guide

Comprehensive guide for developing with the Mini-DCM React frontend, including architecture, FHEVM integration, component patterns, and deployment.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [FHEVM Integration](#fhevm-integration)
- [Context System](#context-system)
- [Custom Hooks](#custom-hooks)
- [Component Architecture](#component-architecture)
- [Working with Encrypted Data](#working-with-encrypted-data)
- [Testing](#testing)
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

### useFhevm Hook

Located in `packages/fhevm-react/useFhevm.tsx`:

```typescript
const { instance, status, error } = useFhevm({
  provider, // EIP-1193 provider (MetaMask)
  chainId, // Network chain ID
  initialMockChains, // Mock networks for dev
  enabled: true, // Enable/disable instance creation
});

// Status values: "idle" | "loading" | "ready" | "error"
```

### Encryption Workflow

```typescript
import { createInstance } from "@fhevm/react";

// 1. Get FHEVM instance
const instance = useCDMContext().fhevmInstance;
if (!instance) throw new Error("FHEVM not ready");

// 2. Create encryption input
const contractAddress = "0x...";
const userAddress = "0x...";

const encryptedInput = await instance.createEncryptedInput(
  contractAddress,
  userAddress
);

// 3. Add values to encrypt
encryptedInput.add32(5); // euint32: k-anonymity = 5
encryptedInput.add64(100); // euint64: field value = 100
encryptedInput.add8(1); // euint8: type tag = 1

// 4. Encrypt and get handles + proof
const { handles, inputProof } = await encryptedInput.encrypt();

// 5. Use in contract call
const tx = await contract.commitDataset(
  datasetId,
  rowCount,
  merkleRoot,
  numColumns,
  handles[0], // encrypted k-anonymity
  inputProof,
  cooldownSec
);
```

### Decryption Workflow

```typescript
// 1. Get encrypted result from contract
const { result, isOverflow } = await jobManager.getJobResult(jobId);

// 2. Decrypt using FHEVM instance
const decryptedResult = await instance.decrypt(result, userAddress);
const overflowFlag = await instance.decrypt(isOverflow, userAddress);

// 3. Check for k-anonymity failure
const K_ANONYMITY_SENTINEL = BigInt(2 ** 128 - 1);

if (decryptedResult === K_ANONYMITY_SENTINEL) {
  console.log("K-anonymity threshold not met");
  return null;
}

// 4. Use decrypted value
console.log("Result:", decryptedResult);
```

### Mock Networks for Development

```typescript
const initialMockChains = [
  {
    chainId: 31337, // Hardhat network
    rpcUrl: "http://127.0.0.1:8545",
  },
];

useFhevm({
  provider,
  chainId,
  initialMockChains,
  enabled: true,
});
```

## Context System

### CDMProvider

The global context provider wraps the entire app and provides shared state.

Located in `hooks/useCDMContext.tsx`:

```typescript
interface CDMContextValue {
  // MetaMask/Wallet
  provider: ethers.Eip1193Provider | undefined;
  chainId: number | undefined;
  accounts: string[] | undefined;
  isConnected: boolean;
  ethersSigner: ethers.JsonRpcSigner | undefined;
  ethersReadonlyProvider: ethers.ContractRunner | undefined;
  connect: () => void;

  // FHEVM
  fhevmInstance: FhevmInstance | undefined;
  fhevmStatus: string;
  fhevmError: Error | null | undefined;

  // Storage
  fhevmDecryptionSignatureStorage: GenericStringStorage;

  // Contracts
  jobManager: ReturnType<typeof useJobManager>;
  datasetRegistry: ReturnType<typeof useDatasetRegistry>;

  // Gas
  gasPrice: ReturnType<typeof useGasPrice>;
}
```

### Usage in Components

```typescript
import { useCDMContext } from "@/hooks/useCDMContext";

function MyComponent() {
  const {
    isConnected,
    connect,
    accounts,
    fhevmInstance,
    datasetRegistry,
    jobManager
  } = useCDMContext();

  // Access datasets
  const datasets = datasetRegistry.getDatasetsQuery.data || [];

  // Create dataset
  const handleCreate = async () => {
    await datasetRegistry.commitDatasetMutation.mutateAsync({
      datasetId: 1n,
      rowCount: 100n,
      // ...
    });
  };

  return (
    <div>
      {!isConnected ? (
        <button onClick={connect}>Connect Wallet</button>
      ) : (
        <div>Connected: {accounts[0]}</div>
      )}
    </div>
  );
}
```

## Custom Hooks

### useDatasetRegistry

Manages DatasetRegistry contract interactions with TanStack Query.

**Queries**:

```typescript
const { datasetRegistry } = useCDMContext();

// Get all datasets
const datasets = datasetRegistry.getDatasetsQuery.data || [];
// Auto-refetches every 5 seconds

// Query state
if (datasetRegistry.getDatasetsQuery.isLoading) {
  return <div>Loading...</div>;
}

if (datasetRegistry.getDatasetsQuery.error) {
  return <div>Error loading datasets</div>;
}
```

**Mutations**:

```typescript
// Commit dataset
const handleCommit = async () => {
  try {
    await datasetRegistry.commitDatasetMutation.mutateAsync({
      datasetId,
      rowCount,
      merkleRoot,
      numColumns,
      kAnonymityHandle,
      inputProof,
      cooldownSec,
    });
    toast.success("Dataset created!");
  } catch (error) {
    toast.error("Failed to create dataset");
  }
};

// Delete dataset
await datasetRegistry.deleteDatasetMutation.mutateAsync({
  datasetId,
});
```

### useJobManager

Manages JobManager contract interactions.

**Queries**:

```typescript
const { jobManager } = useCDMContext();

// Get activity (jobs + requests)
const activity = jobManager.getJobManagerActivity.data;

// Get specific request
const request = await jobManager.contract?.getRequest(requestId);

// Get job progress
const progress = await jobManager.contract?.getJobProgress(jobId);
```

**Mutations**:

```typescript
// Submit request
await jobManager.submitRequestMutation.mutateAsync({
  datasetId,
  params: jobParams,
  baseFee,
  value: totalPayment,
});

// Accept request
await jobManager.acceptRequestMutation.mutateAsync({
  requestId,
});

// Push row
await jobManager.pushRowMutation.mutateAsync({
  jobId,
  rowPacked,
  merkleProof,
  rowIndex,
});

// Finalize job
await jobManager.finalizeJobMutation.mutateAsync({
  jobId,
});
```

### useGasPrice

Monitors current gas price for cost estimation.

```typescript
const { gasPrice } = useCDMContext();

// Current gas price (auto-updates every 10s)
const currentGasPrice = gasPrice.data;

// Calculate cost
const estimatedGas = 1000000n;
const costWei = estimatedGas * currentGasPrice;
const costEth = ethers.formatEther(costWei);

console.log(`Estimated cost: ${costEth} ETH`);
```

## Component Architecture

### Modal Pattern

Modals use Radix Dialog with controlled state:

```typescript
function CreateDatasetModal({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { datasetRegistry, fhevmInstance } = useCDMContext();

  const handleSubmit = async (data: FormData) => {
    // 1. Encrypt k-anonymity
    const encrypted = await instance.createEncryptedInput(...);
    encrypted.add32(data.kAnonymity);
    const { handles, inputProof } = await encrypted.encrypt();

    // 2. Commit dataset
    await datasetRegistry.commitDatasetMutation.mutateAsync({
      datasetId: BigInt(data.id),
      rowCount: BigInt(data.rowCount),
      merkleRoot: data.merkleRoot,
      numColumns: BigInt(data.numColumns),
      kAnonymityHandle: handles[0],
      inputProof,
      cooldownSec: data.cooldownSec
    });

    // 3. Close modal
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Dataset</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          {/* Form fields */}
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

### Drawer Pattern

Drawers use Radix Sheet for sidebars:

```typescript
function DatasetDrawer({
  dataset,
  isOpen,
  onClose
}: {
  dataset: Dataset;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-[600px]">
        <SheetHeader>
          <SheetTitle>Dataset {dataset.id.toString()}</SheetTitle>
        </SheetHeader>

        {/* Dataset details */}
        <div className="space-y-4">
          <InfoSection label="Owner" value={dataset.owner} />
          <InfoSection label="Rows" value={dataset.rowCount.toString()} />
          <InfoSection label="Columns" value={dataset.numColumns.toString()} />

          {/* Activity table */}
          <ActivityTable datasetId={dataset.id} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

### Table Pattern

Activity tables use TanStack Query with real-time updates:

```typescript
function ActivityTable({ datasetId }: { datasetId: bigint }) {
  const { jobManager } = useCDMContext();

  const activity = jobManager.getJobManagerActivity.data;

  // Filter to dataset
  const datasetActivity = activity?.byDataset.get(datasetId) || {
    jobs: [],
    requests: []
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>ID</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Buyer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {datasetActivity.requests.map(req => (
          <TableRow key={`req-${req.id}`}>
            <TableCell>Request</TableCell>
            <TableCell>{req.id.toString()}</TableCell>
            <TableCell>
              <StatusBadge status={req.status} />
            </TableCell>
            <TableCell>{shortenAddress(req.buyer)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### Form Pattern

Forms use react-hook-form with zod validation:

```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const formSchema = z.object({
  datasetId: z.string().min(1),
  baseFee: z.string().refine(val => !isNaN(Number(val))),
  computeAllowance: z.string().refine(val => !isNaN(Number(val)))
});

function NewRequestForm() {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      datasetId: "",
      baseFee: "0.1",
      computeAllowance: "0.5"
    }
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const baseFee = ethers.parseEther(data.baseFee);
    const allowance = ethers.parseEther(data.computeAllowance);

    await jobManager.submitRequestMutation.mutateAsync({
      datasetId: BigInt(data.datasetId),
      params: jobParams,
      baseFee,
      value: baseFee + allowance
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="datasetId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dataset ID</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* More fields */}
        <Button type="submit">Submit Request</Button>
      </form>
    </Form>
  );
}
```

## Working with Encrypted Data

### Creating Encrypted Datasets

```typescript
import { generateDataset } from "@fhevm/shared";

async function createDataset() {
  const { fhevmInstance, accounts, datasetRegistry } = useCDMContext();

  // 1. Generate dataset off-chain
  const dataset = await generateDataset({
    id: 1,
    rowCount: 100,
    schema: [
      { type: "euint32", value: () => Math.floor(Math.random() * 100) },
      { type: "euint64", value: () => Math.floor(Math.random() * 10000) },
    ],
    fhevmInstance,
    userAddress: accounts[0],
  });

  // 2. Store dataset rows + proofs off-chain (IPFS, S3, etc.)
  await storeDataset(dataset);

  // 3. Encrypt k-anonymity
  const encrypted = await fhevmInstance.createEncryptedInput(
    datasetRegistry.contractAddress,
    accounts[0]
  );
  encrypted.add32(5); // k = 5
  const { handles, inputProof } = await encrypted.encrypt();

  // 4. Commit to blockchain
  await datasetRegistry.commitDatasetMutation.mutateAsync({
    datasetId: BigInt(dataset.id),
    rowCount: BigInt(dataset.rowCount),
    merkleRoot: dataset.merkleRoot,
    numColumns: BigInt(dataset.numColumns),
    kAnonymityHandle: handles[0],
    inputProof,
    cooldownSec: 3600,
  });
}
```

### Processing Jobs

```typescript
async function processJob(jobId: bigint) {
  const { jobManager } = useCDMContext();

  // 1. Get job details
  const job = await jobManager.contract.jobs(jobId);
  const datasetId = job.datasetId;

  // 2. Load dataset from off-chain storage
  const dataset = await loadDataset(datasetId);

  // 3. Process rows sequentially
  for (let i = 0; i < dataset.rowCount; i++) {
    try {
      await jobManager.pushRowMutation.mutateAsync({
        jobId,
        rowPacked: dataset.rows[i],
        merkleProof: dataset.proofs[i],
        rowIndex: i,
      });

      console.log(`Processed ${i + 1}/${dataset.rowCount}`);
    } catch (error) {
      console.error(`Failed at row ${i}:`, error);
      throw error;
    }
  }

  // 4. Finalize
  await jobManager.finalizeJobMutation.mutateAsync({ jobId });
}
```

### Decrypting Results

```typescript
async function viewResult(jobId: bigint) {
  const { jobManager, fhevmInstance, accounts } = useCDMContext();

  // 1. Get encrypted result
  const { result, isOverflow } = await jobManager.contract.getJobResult(jobId);

  // 2. Decrypt
  const decryptedResult = await fhevmInstance.decrypt(result, accounts[0]);
  const overflowFlag = await fhevmInstance.decrypt(isOverflow, accounts[0]);

  // 3. Check validity
  const K_ANONYMITY_FAILURE = BigInt(2 ** 128 - 1);

  if (decryptedResult === K_ANONYMITY_FAILURE) {
    toast.error("K-anonymity threshold not met");
    return null;
  }

  if (overflowFlag) {
    toast.warning("Arithmetic overflow detected - result may be invalid");
  }

  // 4. Display result
  console.log("Job result:", decryptedResult.toString());
  return decryptedResult;
}
```

## Testing

### Setup

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

### Component Tests

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import DatasetCard from '@/components/DatasetCard';

vi.mock('@/hooks/useCDMContext', () => ({
  useCDMContext: () => ({
    accounts: ['0x123...'],
    datasetRegistry: {
      deleteDatasetMutation: {
        mutateAsync: vi.fn()
      }
    }
  })
}));

describe('DatasetCard', () => {
  const mockDataset = {
    id: 1n,
    owner: '0x123...',
    rowCount: 100n,
    numColumns: 3n,
    merkleRoot: '0xabc...',
    exists: true,
    kAnonymity: 5,
    cooldownSec: 3600
  };

  it('renders dataset information', () => {
    render(<DatasetCard dataset={mockDataset} />);

    expect(screen.getByText('Dataset 1')).toBeInTheDocument();
    expect(screen.getByText('100 rows')).toBeInTheDocument();
    expect(screen.getByText('3 columns')).toBeInTheDocument();
  });

  it('shows delete button for owner', () => {
    render(<DatasetCard dataset={mockDataset} />);

    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});
```

### Hook Tests

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { useDatasetRegistry } from '@/hooks/useDatasetRegistry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

describe('useDatasetRegistry', () => {
  const queryClient = new QueryClient();
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('fetches datasets', async () => {
    const { result } = renderHook(() => useDatasetRegistry({
      // mock params
    }), { wrapper });

    await waitFor(() => {
      expect(result.current.getDatasetsQuery.isSuccess).toBe(true);
    });

    expect(result.current.getDatasetsQuery.data).toBeDefined();
  });
});
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

### Performance

1. **Memoize Expensive Computations**:

   ```typescript
   const datasetStats = useMemo(() => {
     return computeStats(datasets, activity);
   }, [datasets, activity]);
   ```

2. **Optimize Re-renders**:

   ```typescript
   const MemoizedCard = React.memo(DatasetCard);
   ```

3. **Lazy Load Heavy Components**:
   ```typescript
   const FilterBuilder = lazy(() => import("@/components/FilterBuilder"));
   ```

### Error Handling

1. **Toast Notifications**:

   ```typescript
   import { toast } from "sonner";

   try {
     await mutation.mutateAsync(params);
     toast.success("Success!");
   } catch (error) {
     toast.error(error.message || "Operation failed");
   }
   ```

2. **Error Boundaries**:
   ```typescript
   <ErrorBoundary fallback={<ErrorNotDeployed />}>
     <Overview />
   </ErrorBoundary>
   ```

### Security

1. **Validate User Input**: Use zod schemas
2. **Check Wallet Connection**: Before contract calls
3. **Verify Network**: Warn on wrong network
4. **Handle Rejected Transactions**: Gracefully

### Code Organization

1. **Colocation**: Keep related code together
2. **Barrel Exports**: Use `index.ts` for clean imports
3. **Type Safety**: Leverage TypeScript strictly
4. **Documentation**: JSDoc for complex functions

---

**Related Documentation**:

- [Architecture Guide](ARCHITECTURE.md)
- [Smart Contracts Reference](SMART_CONTRACTS.md)
- [Request & Job Lifecycle](REQUEST_JOB_LIFECYCLE.md)
- [Filter VM Specification](FILTER_VM.md)
