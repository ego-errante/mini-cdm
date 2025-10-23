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

## Setup and Deployment

### 1. Prerequisites

- **Node.js**: Version 20 or higher
- **MetaMask**: Browser extension for wallet connectivity

### 2. Installation

Clone the repository and install dependencies. The `postinstall` script will automatically deploy contracts to a local Hardhat node.

```bash
git clone <repository-url>
cd mini-dcm
npm install
```

### 3. Environment Configuration (Optional)

To deploy to a public testnet, you'll need to configure a wallet mnemonic and an RPC provider API key.

```bash
cd packages/fhevm-hardhat-template

# Set your wallet mnemonic
npx hardhat vars set MNEMONIC

# Set Infura API key for Sepolia deployment
npx hardhat vars set INFURA_API_KEY

# Optional: Etherscan API key for contract verification
npx hardhat vars set ETHERSCAN_API_KEY
```

### 4. Local Development

1.  **Start Local Hardhat Node**

    This command starts a local, FHEVM-enabled blockchain.

    ```bash
    # Terminal 1
    npm run hardhat-node
    ```

2.  **Launch Frontend**

    This command starts the Next.js application. If contracts aren't already deployed on the local node, it will deploy them.

    ```bash
    # Terminal 2
    npm run dev:mock
    ```

3.  **Configure MetaMask**

    Add the local Hardhat network to MetaMask:
    - **Network Name**: `Hardhat`
    - **RPC URL**: `http://127.0.0.1:8545`
    - **Chain ID**: `31337`
    - **Currency Symbol**: `ETH`

4.  **Open Application**

    Navigate to `http://localhost:3000` and connect your wallet.

### 5. Testnet & Mainnet Deployment

#### Sepolia Testnet

1.  **Fund Wallet**: Ensure the wallet configured in your environment variables has Sepolia ETH ([faucet](https://sepoliafaucet.com/)).
2.  **Deploy Contracts**:
    ```bash
    npm run deploy:sepolia
    ```
3.  **Deployed Addresses**:
    - **DatasetRegistry**: `0xcC804D65432b90A6e2759323967ca6babe948917`
    - **JobManager**: `0x3d921D887DDC947465975b345Cc91822E198F3B3`

4.  **Run Frontend**: The frontend will automatically detect the Sepolia deployment.
    ```bash
    npm run dev:mock
    ```

#### Mainnet

⚠️ **Not recommended yet** - FHEVM is in active development.

When ready:

1.  Update `hardhat.config.ts` with a mainnet RPC endpoint.
2.  Thoroughly audit all smart contracts.
3.  Deploy with `npx hardhat deploy --network mainnet`.

### 6. Frontend Deployment (Netlify)

The frontend is configured for one-click deployment on Netlify.

- **Build command**: `npm run build:shared && cd packages/site && npm run build`
- **Publish directory**: `packages/site/.next`
- **Environment**: Node 20
- **Plugin**: `@netlify/plugin-nextjs`

Set the `NETLIFY=true` environment variable in your Netlify settings to prevent the build command from trying to redeploy contracts.

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
│   ├── REQUEST_JOB_LIFECYCLE.md       # Workflow documentation
│   ├── FILTER_VM.md                   # Filter bytecode specification
│   ├── FRONTEND_DEVELOPMENT.md        # Frontend development guide
│   ├── GAS_BENCHMARKING.md            # Gas cost analysis methodology
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

## More Documentation

### Project Documentation

- **[Architecture Guide](docs/ARCHITECTURE.md)** - System design, data flow, and security model
- **[Request & Job Lifecycle](docs/REQUEST_JOB_LIFECYCLE.md)** - Workflow and payment system
- **[Filter VM Specification](docs/FILTER_VM.md)** - Bytecode filter system
- **[Frontend Development](docs/FRONTEND_DEVELOPMENT.md)** - React app development guide

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

See the full **[Gas Benchmarking Guide](docs/GAS_BENCHMARKING.md)** for a detailed methodology and analysis.

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

## Current Limitations & Future Improvements

### Data Type Constraints

**Integer-Only Columns**: All data columns must be integer-typed (euint8, euint32, euint64)

- Mix different bit-widths within a dataset
- All values upcast to euint64 for uniform computation
- No support for strings, floats, or complex structures in v1
- Categorical data must be encoded as integers
- **No null values**: Every column must contain data (specific sentinel values could represent null in future)

**Column Limits**: Maximum 32 columns per dataset

- FHE encryption library has 2048-bit limit per operation
- Each euint64 = 64 bits → 2048/64 = 32 columns maximum
- WEIGHTED_SUM operations recommended for ≤10 columns for gas efficiency

### Filter VM Constraints

**Comparison Restrictions**:

- Only compare encrypted fields against plaintext constants
- No field-to-field comparisons (e.g., `Debt > Income` not supported)
- Workaround: Run multiple queries with different constant thresholds

**Stack Depth**: Maximum 8 elements per stack (value, const, bool)

- Limits deeply nested boolean expressions
- Complex filters may need to be split into multiple jobs

### Operation Limitations

**No Grouping**: No GROUP BY functionality

- Cannot compute "sum of income per country" in single query
- Run separate queries for each group value

**Limited Arithmetic**: Row-wise math restricted to linear combinations

- WEIGHTED_SUM supports only positive weights
- No column-to-column multiplication or non-linear functions
- No division by encrypted values (AVG_P uses plaintext divisor only)

**Overflow Handling**: Overflow detection provided but not prevented

- Result includes encrypted overflow flag
- Buyer must check flag after decryption and handle accordingly

### Processing Constraints

**Sequential Row Order**: Rows must be processed in ascending order (0, 1, 2, ...)

- Reduces storage costs for state tracking
- Enforces integrity and prevents row skipping
- Cannot process rows in parallel or out of order

**Dataset Deletion Risk**: Deleting a dataset mid-job prevents job completion

- Jobs hold cached dataset metadata, but rely on owner for row processing
- Consider job lifecycle before dataset deletion

**CSV Header Assumption**: First row in CSV files always treated as header and skipped

### Privacy & Security Considerations

**K-Anonymity Responsibility**: Data seller sets k-anonymity value

- No automatic calculation or validation
- Seller must choose appropriate value based on data sensitivity

**Sentinel Values**:

- K-anonymity failure returns `type(uint128).max` (2^128 - 1)
- Buyers must check for this sentinel value after decryption
- Overflow flag is separate encrypted boolean

### Gas & Scalability

**Job/Request Accumulation**: Large numbers of jobs/requests may affect gas costs

- Consider pagination or archival strategies for production
- Future: Separate state management contract

**Row-by-Row Processing**: Each row requires separate transaction

- High gas costs for large datasets
- Future: Batch processing or off-chain computation with ZK proofs

### Future Improvements

**Planned Enhancements**:

1. **Off-Chain ZK Preflight Checks**
   - Validate job parameters before expensive on-chain computation
   - Reject invalid requests with ZK proofs
   - Reduce wasted gas on malformed queries

2. **Batch Row Processing**
   - Process multiple rows per transaction
   - Significantly reduce gas costs for large datasets

3. **Fast Processing Incentives**
   - Bonus payments for rapid job completion
   - Encourage timely data provider responses

4. **Enhanced Data Types**
   - Null value support via sentinel values
   - String encoding strategies
   - Floating-point approximations

5. **Advanced Operations**
   - Field-to-field comparisons
   - GROUP BY with encrypted grouping keys
   - More complex arithmetic operations

6. **Contract Modularization**
   - Split functionality into specialized contracts
   - Reduce individual contract complexity
   - Enable easier upgrades

7. **Encrypted Job Parameters**
   - Encrypt operation types, filters, and weights
   - Only divisor remains plaintext for AVG_P
   - Enhanced query privacy

**See [Architecture Guide](docs/ARCHITECTURE.md) for detailed technical design and contract implementation details.**

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

For questions or support, visit our [GitHub Issues](https://github.com/ego-errante/mini-dcm/issues) or join the [Zama Discord](https://discord.com/invite/zama).
