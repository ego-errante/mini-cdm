# Mini-DCM: Minimal Confidential Data Marketplace

A privacy-preserving data marketplace built on [Zama's FHEVM](https://docs.zama.ai/fhevm) (Fully Homomorphic Encryption for Ethereum Virtual Machine). Mini-DCM enables secure computation over encrypted datasets without revealing the underlying data to buyers or the blockchain.

## What is Mini-DCM?

Mini-DCM is a decentralized marketplace where:

- **Data sellers** can publish encrypted datasets with privacy guarantees
- **Data buyers** can run analytical queries over encrypted data
- **Results** are computed homomorphically without decrypting the source data
- **Privacy** is enforced through k-anonymity, cooldowns, and FHE operations

## Key Features

### Privacy-First Architecture

- **Fully Homomorphic Encryption**: All computations happen on encrypted data
- **K-Anonymity Enforcement**: Results are only released if minimum anonymity thresholds are met
- **Cooldown Periods**: Control access frequency per buyer-dataset pair
- **Merkle Proof Verification**: Cryptographically verify data authenticity

### Powerful Query Capabilities

- **Operations**: COUNT, SUM, AVG (with plaintext divisor), WEIGHTED_SUM, MIN, MAX
- **Encrypted Filters**: Stack-based bytecode VM for complex filtering logic
- **Post-Processing**: Clamping and bucket rounding for additional privacy
- **Overflow Detection**: Automatic tracking of arithmetic overflow

### Flexible Interaction Models

- **Direct Jobs**: Dataset owners create jobs directly for buyers
- **Request-Based System**: Buyers submit requests; sellers accept and fulfill
- **Gas Allowances**: Pay-as-you-go model with automatic settlement
- **Stall Protection**: Buyers can reclaim funds from abandoned jobs

### Modern Frontend

- **Next.js 15 + React 19**: Fast, modern web application
- **Real-time Updates**: TanStack Query for reactive data fetching
- **MetaMask Integration**: EIP-6963 multi-wallet support
- **Encrypted Data Handling**: Built-in FHEVM integration

## Quick Start

### Prerequisites

- **Node.js**: Version 20 or higher
- **MetaMask**: Browser extension for wallet connectivity

### Installation

1. **Clone and install dependencies**

   ```bash
   git clone <repository-url>
   cd mini-dcm
   npm install
   ```

2. **Configure Hardhat environment variables**

   ```bash
   cd packages/fhevm-hardhat-template

   # Set your wallet mnemonic
   npx hardhat vars set MNEMONIC

   # Set Infura API key for Sepolia deployment
   npx hardhat vars set INFURA_API_KEY

   # Optional: Etherscan API key for contract verification
   npx hardhat vars set ETHERSCAN_API_KEY
   ```

3. **Start local development environment**

   ```bash
   # Terminal 1: Start local FHEVM-enabled Hardhat node
   npm run hardhat-node

   # Terminal 2: Launch frontend (automatically deploys contracts)
   npm run dev:mock
   ```

4. **Configure MetaMask**

   Add the local Hardhat network to MetaMask:
   - Network Name: `Hardhat`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency Symbol: `ETH`

5. **Open application**

   Navigate to `http://localhost:3000` and connect MetaMask

### Deploy to Sepolia Testnet

```bash
# Deploy contracts
npm run deploy:sepolia

# Start frontend (will auto-detect Sepolia deployment)
npm run dev:mock
```

## Core Concepts

### Datasets

Encrypted tabular data stored off-chain with on-chain metadata:

- **Schema**: Flexible column structure (euint8, euint32, euint64)
- **Merkle Root**: Cryptographic commitment to dataset integrity
- **K-Anonymity**: Minimum result set size (encrypted)
- **Cooldown**: Time period between queries from same buyer
- **Ownership**: Single owner controls access and job acceptance

### Jobs

Computational tasks executed over encrypted datasets:

- **Operation**: The type of computation (COUNT, SUM, etc.)
- **Filter**: Bytecode program to select rows
- **Target Field**: Column to aggregate (for SUM/AVG/MIN/MAX)
- **Weights**: Column multipliers (for WEIGHTED_SUM)
- **Post-Processing**: Optional clamping and rounding

### Requests

Buyer-initiated proposals for dataset computation:

- **Lifecycle**: PENDING → ACCEPTED → COMPLETED (or REJECTED)
- **Payment**: Base fee + compute allowance with gas tracking
- **Fulfillment**: Seller processes rows and finalizes result
- **Protection**: Stall detection and reclaim mechanism

### Filter VM

Stack-based bytecode interpreter for encrypted data filtering:

- **Opcodes**: PUSH_FIELD, PUSH_CONST, comparators (GT, GE, LT, LE, EQ, NE), logical ops (AND, OR, NOT)
- **DSL**: High-level TypeScript functions compile to bytecode
- **Execution**: Homomorphic operations on encrypted values
- **Stack Depth**: Maximum 8 elements per stack (value, const, bool)

## Project Structure

```
mini-dcm/
├── docs/                              # Documentation
│   ├── ARCHITECTURE.md                # System design and architecture
│   ├── SMART_CONTRACTS.md             # Contract reference guide
│   ├── REQUEST_JOB_LIFECYCLE.md       # Workflow documentation
│   ├── FILTER_VM.md                   # Filter bytecode specification
│   ├── FRONTEND_DEVELOPMENT.md        # Frontend development guide
│   ├── gas_benchmarking.md            # Gas cost analysis methodology
│   └── TEST_MATRIX_SUMMARY.md         # Gas benchmark test matrix
│
├── packages/
│   ├── fhevm-hardhat-template/        # Smart contracts and tests
│   │   ├── contracts/
│   │   │   ├── DatasetRegistry.sol    # Dataset lifecycle management
│   │   │   ├── JobManager.sol         # Job execution and payments
│   │   │   ├── RowDecoder.sol         # Encrypted data parsing
│   │   │   └── I*.sol                 # Contract interfaces
│   │   ├── deploy/                    # Deployment scripts
│   │   ├── test/                      # Comprehensive test suite
│   │   └── tasks/                     # Hardhat custom tasks
│   │
│   ├── site/                          # Next.js frontend application
│   │   ├── app/                       # Next.js app router
│   │   ├── components/                # React components
│   │   │   ├── ui/                    # Radix UI components
│   │   │   ├── CreateDatasetModal.tsx
│   │   │   ├── NewRequestModal.tsx
│   │   │   ├── JobProcessorModal.tsx
│   │   │   └── ...
│   │   ├── hooks/                     # Custom React hooks
│   │   │   ├── useCDMContext.tsx      # Global app context
│   │   │   ├── useDatasetRegistry.ts  # Dataset contract hook
│   │   │   ├── useJobManager.ts       # Job contract hook
│   │   │   └── metamask/              # Wallet integration
│   │   ├── lib/                       # Utility functions
│   │   └── abi/                       # Generated contract ABIs
│   │
│   ├── fhevm-shared/                  # Shared utilities package
│   │   └── src/
│   │       ├── types.ts               # Shared TypeScript types
│   │       ├── filterDsl.ts           # Filter DSL compiler
│   │       ├── encryption.ts          # FHE utilities
│   │       ├── merkle.ts              # Merkle tree helpers
│   │       └── jobUtils.ts            # Job parameter utilities
│   │
│   ├── fhevm-react/                   # FHEVM React integration
│   │   └── useFhevm.tsx               # FHEVM instance hook
│   │
│   └── postdeploy/                    # Post-deployment tasks
│
├── scripts/                           # Automation scripts
│   ├── deploy-hardhat-node.sh         # Auto-deploy on install
│   └── generate-site-abi.mjs          # ABI extraction
│
└── misc/                              # Analysis and benchmarking
    ├── gas_benchmark_results.csv      # Benchmark data
    ├── analyze_gas_results.py         # Statistical analysis
    └── notebooks/
        └── gas_benchmark.ipynb        # Interactive analysis
```

## Available Scripts

### Root Level

| Command                       | Description                                        |
| ----------------------------- | -------------------------------------------------- |
| `npm run hardhat-node`        | Start local FHEVM Hardhat node (port 8545)         |
| `npm run dev:mock`            | Run frontend in development mode (with local node) |
| `npm run deploy:hardhat-node` | Deploy contracts to local node                     |
| `npm run deploy:sepolia`      | Deploy contracts to Sepolia testnet                |
| `npm run generate-abi`        | Extract contract ABIs for frontend                 |
| `npm run build:shared`        | Build shared utilities package                     |
| `npm run dev:shared`          | Watch mode for shared package                      |

### Smart Contracts (`packages/fhevm-hardhat-template`)

| Command            | Description                         |
| ------------------ | ----------------------------------- |
| `npm run compile`  | Compile all Solidity contracts      |
| `npm test`         | Run complete test suite             |
| `npm run coverage` | Generate test coverage report       |
| `npm run lint`     | Run Solidity and TypeScript linters |
| `npm run clean`    | Remove build artifacts              |

### Frontend (`packages/site`)

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `npm run dev:mock` | Development server with Hardhat node |
| `npm run build`    | Production build                     |
| `npm run start`    | Serve production build               |
| `npm run lint`     | Run Next.js linting                  |

## Documentation

### Project Documentation

- **[Architecture Guide](docs/ARCHITECTURE.md)** - System design, data flow, and security model
- **[Smart Contracts Reference](docs/SMART_CONTRACTS.md)** - Detailed contract documentation
- **[Request & Job Lifecycle](docs/REQUEST_JOB_LIFECYCLE.md)** - Workflow and payment system
- **[Filter VM Specification](docs/FILTER_VM.md)** - Bytecode filter system
- **[Frontend Development](docs/FRONTEND_DEVELOPMENT.md)** - React app development guide
- **[Gas Benchmarking](docs/gas_benchmarking.md)** - Gas cost analysis and optimization

### External Resources

- **[FHEVM Documentation](https://docs.zama.ai/fhevm)** - Zama's FHE protocol
- **[FHEVM Hardhat Guide](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat)** - Smart contract development
- **[Relayer SDK](https://docs.zama.ai/protocol/relayer-sdk-guides/)** - Frontend integration
- **[Zama Discord](https://discord.com/invite/zama)** - Community support

## Use Cases

### Healthcare Data Analytics

- Researchers query patient data without accessing individual records
- K-anonymity ensures minimum cohort sizes
- Cooldowns prevent correlation attacks

### Financial Market Data

- Aggregate trading patterns without revealing individual positions
- Weighted sums for portfolio analysis
- Clamping and rounding for differential privacy

### IoT Sensor Networks

- Statistical analysis over encrypted sensor readings
- MIN/MAX operations for anomaly detection
- Filters for time-range and threshold queries

### Survey and Census Data

- Anonymous demographic analysis
- COUNT operations with privacy thresholds
- Multiple buyers can query without cross-contamination

## Testing

The project includes comprehensive test coverage:

- **Unit Tests**: Individual contract function testing
- **Integration Tests**: Multi-contract workflows
- **Gas Benchmarks**: Performance analysis (63 test matrix)
- **Frontend Tests**: Component and hook testing

Run tests:

```bash
# Smart contract tests
cd packages/fhevm-hardhat-template
npm test

# Specific test file
npx hardhat test test/JobManager/JobManager.ts

# Gas benchmarking
npx hardhat test test/GasBenchmark.ts

# Frontend tests
cd packages/site
npm test
```

## Gas Optimization

Mini-DCM includes a sophisticated gas benchmarking system:

- **63-Test Matrix**: Fractional factorial design
- **90.9% R² Accuracy**: Log-space regression model
- **34% MAPE**: Mean absolute percentage error
- **Predictive Estimator**: Pre-compute gas costs for better UX

See [Gas Benchmarking Guide](docs/gas_benchmarking.md) for details.

## Security Considerations

### Smart Contract Security

- **Reentrancy Guards**: Protected state-changing functions
- **Merkle Proof Verification**: Prevents data tampering
- **Sequential Row Processing**: Enforced ordering prevents skipping
- **Access Control**: Owner-based permissions

### Privacy Guarantees

- **FHE Operations**: Data never decrypted on-chain
- **K-Anonymity Enforcement**: Results fail if threshold not met
- **Overflow Detection**: Prevents wraparound attacks
- **Cooldown Periods**: Mitigate frequency attacks

### Payment Security

- **Escrow System**: Funds held until completion
- **Gas Tracking**: Accurate computation cost attribution
- **Stall Protection**: Buyer reclaim after 24-hour timeout
- **Threshold Payouts**: Minimize transaction costs

## Deployment

### Local Development

Already configured! The `postinstall` script automatically:

1. Starts a Hardhat node
2. Deploys contracts
3. Generates ABIs for frontend

### Sepolia Testnet

1. Fund wallet with Sepolia ETH ([faucet](https://sepoliafaucet.com/))
2. Deploy: `npm run deploy:sepolia`
3. Frontend auto-detects deployment via `packages/site/abi/`

### Production (Mainnet)

⚠️ **Not recommended yet** - FHEVM is in active development

When ready:

1. Update `hardhat.config.ts` with mainnet RPC
2. Thoroughly audit contracts
3. Test on testnet extensively
4. Deploy with `npx hardhat deploy --network mainnet`

## Netlify Deployment

The frontend is configured for Netlify deployment:

- Build command: `npm run build:shared && cd packages/site && npm run build`
- Publish directory: `packages/site/.next`
- Environment: Node 20
- Plugin: `@netlify/plugin-nextjs`

Set `NETLIFY=true` environment variable to skip Hardhat deployment during build.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Troubleshooting

### MetaMask Issues

**Nonce Mismatch**: Clear MetaMask activity (Settings → Advanced → Clear Activity Tab)

**Cached View Results**: Restart browser completely (MetaMask caches aggressively)

**Wrong Network**: Ensure MetaMask is on Hardhat (31337) or Sepolia

### Hardhat Node Issues

**Port Already in Use**: Kill process on 8545 (`lsof -ti:8545 | xargs kill`)

**Deployment Failed**: Check console for contract errors, recompile if needed

**Tests Timeout**: Increase timeout in test files: `this.timeout(300000)`

### Frontend Issues

**Contracts Not Deployed**: Run `npm run deploy:hardhat-node` manually

**FHEVM Instance Error**: Check that Hardhat node is running and contracts deployed

**Build Errors**: Clean and rebuild: `cd packages/site && npm run clean && npm run build`

## License

This project is licensed under the **BSD-3-Clause-Clear License**.

See [LICENSE](LICENSE) for details.

## Acknowledgments

Built with:

- **[Zama FHEVM](https://www.zama.ai/)** - Fully Homomorphic Encryption for Ethereum
- **[Hardhat](https://hardhat.org/)** - Ethereum development environment
- **[Next.js](https://nextjs.org/)** - React framework
- **[Radix UI](https://www.radix-ui.com/)** - Accessible component primitives
- **[TanStack Query](https://tanstack.com/query)** - Data fetching and caching

---

**Built with privacy at its core. Powered by Fully Homomorphic Encryption.**

For questions or support, visit our [GitHub Issues](https://github.com/your-repo/mini-dcm/issues) or join the [Zama Discord](https://discord.com/invite/zama).
