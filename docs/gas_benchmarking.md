# Gas Benchmarking Guide

## Overview

This test suite measures gas costs for JobManager operations and builds a predictive model to estimate gas usage for
arbitrary job configurations. Using a **fractional factorial design**, we achieve **60%+ accuracy** with just **63 test
cases** instead of the full 216 tests.

**Purpose**: Estimate gas costs before job execution to improve UX and cost transparency.

**Model**: `Gas = f(rows, columns, operation, filterComplexity)`

---

## Quick Start

```bash
# 1. Run benchmarks (30-90 min)
cd packages/fhevm-hardhat-template
npx hardhat test test/GasBenchmark.ts | tee ../misc/gas_output.txt

# 2. Extract CSV from terminal output
# Save to: ../misc/gas_benchmark_results.csv

# 3. Analyze results
pip install pandas scikit-learn matplotlib seaborn
python test/analyze_gas_results.py ../misc/gas_benchmark_results.csv

# 4. Validate model
npx hardhat test test/GasEstimatorValidation.ts

# 5. Use generated estimateJobGas.ts function
```

**Success Criteria**: R² ≥ 0.60, MAPE ≤ 40%

---

## Test Design

### The 63-Test Matrix

Our test suite is organized into 4 strategic blocks:

#### Block 1: Operation Baseline (24 tests)

- **Tests**: All 6 operations × All 4 filter complexities
- **Fixed**: 25 rows, 10 columns
- **Purpose**: Measure how filter complexity affects each operation

#### Block 2: Row Scaling (12 tests)

- **Tests**: All 6 operations × [5 rows, 100 rows]
- **Fixed**: 10 columns, simple filter
- **Purpose**: Capture linear scaling with row count

#### Block 3: Column Scaling (12 tests)

- **Tests**: All 6 operations × [3 columns, 30 columns]
- **Fixed**: 25 rows, simple filter
- **Purpose**: Measure decoding cost per column

#### Block 4: Edge Cases (15 tests)

- **Tests**: Extreme combinations and stress scenarios
- **Purpose**: Validate model boundaries and capture interactions

### Factors and Levels

| Factor                | Values                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| **Rows**              | 5, 25, 100                                                              |
| **Columns**           | 3, 10, 32                                                               |
| **Operations**        | COUNT, SUM, AVG_P, WEIGHTED_SUM, MIN, MAX                               |
| **Filter Complexity** | none (0 bytes), simple (7 bytes), medium (15 bytes), complex (30 bytes) |

**Full factorial**: 3 × 3 × 6 × 4 = 216 tests  
**Our design**: 63 tests (~29% of full factorial, **3.4× faster**)

### Filter Examples

```typescript
// None: Empty filter (accepts all rows)
// 0 bytes

// Simple: Single comparison (~7 bytes)
gt(0, 100);

// Medium: Compound condition (~15 bytes)
and(gt(0, 100), lt(1, 500));

// Complex: Nested conditions (~30 bytes)
or(and(gt(0, 100), lt(1, 500)), and(ge(2, 200), not(eq(0, 999))));
```

---

## Running Benchmarks

### Execution

```bash
npx hardhat test test/GasBenchmark.ts
```

**Runtime**: 30-90 minutes  
**Output**: Real-time progress + final CSV

### Progress Output

```
--- Running Test 1/63: B1-1 ---
Params: 25 rows × 10 cols, COUNT, none filter
Results:
  openJob:       850,000 gas
  pushRow total: 12,500,000 gas
  pushRow avg:   500,000 gas
  finalize:      650,000 gas
  TOTAL:         14,000,000 gas
```

### CSV Output Format

At the end, the test suite prints CSV data:

```csv
TestID,Rows,Columns,Operation,FilterComplexity,OpenJobGas,PushRowTotal,PushRowAvg,FinalizeGas,TotalGas
B1-1,25,10,COUNT,none,850000,12500000,500000,650000,14000000
B1-2,25,10,COUNT,simple,850000,13750000,550000,650000,15250000
...
```

**Action**: Copy this CSV and save to `misc/gas_benchmark_results.csv`

---

## Statistical Analysis

### Run Analysis Script

```bash
python test/analyze_gas_results.py misc/gas_benchmark_results.csv
```

### What It Does

1. **Loads benchmark data** and computes statistics
2. **Builds regression model**:
   - Log-transformed for exponential scaling
   - Includes interaction terms (Rows × Columns)
   - Operation dummy variables
3. **Evaluates performance**:
   - R² score (variance explained)
   - MAPE (mean absolute percentage error)
4. **Generates outputs**:
   - TypeScript estimator function: `../misc/estimateJobGas_log.ts`
   - Visualizations: `../misc/gas_analysis.png`
   - Coefficient report

### Expected Results

```
Model Performance:
  R² Score:  0.9091 (90.9% variance explained)
  MAPE:      34.27%
  Target:    R² ≥ 0.60, MAPE ≤ 40%
  ✓✓ Model exceeds 60% accuracy target!

Model Coefficients (log-space):
  Intercept:       14.716
  Rows:            0.032
  Columns:         0.087
  Rows×Columns:   -0.00056
  FilterBytes:     0.013
  Op_WEIGHTED_SUM: 1.051
  Op_SUM:          0.184
  Op_AVG_P:        0.186
  Op_MIN:          0.160
  Op_MAX:          0.160
```

### Model Equation

```
log(Gas) = 14.716
         + 0.032 × Rows
         + 0.087 × Columns
         - 0.00056 × (Rows × Columns)
         + 0.013 × FilterBytes
         + Operation_Offset[op]

Gas = exp(log(Gas))
```

**Key Insights**:

1. Column count has large effect (decoding cost affects all operations)
2. Negative interaction term suggests economy of scale
3. WEIGHTED_SUM is ~2.8× more expensive than COUNT
4. Filter complexity scales linearly

---

## Validation

### Run Validation Suite

```bash
npx hardhat test test/GasEstimatorValidation.ts
```

**Purpose**: Test model on 12 holdout cases (not in training set)

### Test Types

- **Interpolation** (5 tests): Parameter values between training points
- **Realistic Use Cases** (3 tests): Common real-world scenarios
- **WEIGHTED_SUM Focus** (2 tests): Most expensive operation edge cases
- **Edge Cases** (2 tests): Boundary conditions

### Sample Validation Cases

| Test ID | Rows | Columns | Operation    | Filter | Test Type     |
| ------- | ---- | ------- | ------------ | ------ | ------------- |
| VAL-01  | 15   | 7       | COUNT        | simple | Interpolation |
| VAL-02  | 50   | 20      | SUM          | medium | Interpolation |
| VAL-06  | 10   | 8       | WEIGHTED_SUM | medium | Weighted Sum  |
| VAL-08  | 60   | 8       | COUNT        | medium | Realistic     |

### Success Criteria

✅ **MAPE ≤ 40%**: Average prediction accuracy  
✅ **Accuracy Rate ≥ 75%**: Percentage of tests within 40% error

### Expected Validation Output

```
--- Validation Test 1/12: VAL-01 ---
Params: 15 rows × 7 cols, COUNT, simple filter
Predicted gas: 8,245,123
Actual gas:    7,892,456
Error:         +352,667 gas
% Error:       +4.47%
Status:        ✓✓ EXCELLENT (within 20%)

---

Overall Metrics:
  MAPE:           28.34%
  MAE:            1,234,567 gas
  Accuracy Rate:  91.7% (11/12 tests within 40%)

--- Target Assessment ---
  ✓ MAPE Target Met: 28.34% ≤ 40%
  ✓ Accuracy Target Met: 91.7% ≥ 75%
```

---

## Using the Estimator

### Generated Function

The analysis script creates `misc/estimateJobGas_log.ts`:

```typescript
export function estimateJobGas(
  rows: number,
  columns: number,
  operation: "COUNT" | "SUM" | "AVG_P" | "WEIGHTED_SUM" | "MIN" | "MAX",
  filterBytes: number
): number {
  // Log-space calculation with learned coefficients
  const logGas =
    14.716 +
    0.032 * rows +
    0.087 * columns -
    0.00056 * (rows * columns) +
    0.013 * filterBytes +
    operationOffsets[operation];

  return Math.round(Math.exp(logGas));
}
```

### Integration Example

```typescript
import { estimateJobGas } from "../misc/estimateJobGas_log";

// Before user submits job
const estimatedGas = estimateJobGas(50, 15, "SUM", 7);
console.log(`Estimated gas: ${estimatedGas.toLocaleString()}`);

// Calculate cost in ETH
const gasPriceGwei = await provider.getGasPrice();
const costETH = (estimatedGas * Number(gasPriceGwei)) / 1e18;
console.log(`Estimated cost: ${costETH.toFixed(6)} ETH`);

// Set gas limit with buffer
const gasLimit = Math.round(estimatedGas * 1.2);
const tx = await jobManager.executeJob(jobId, { gasLimit });
```

### With Confidence Intervals

```typescript
function estimateJobGasWithRange(
  rows: number,
  columns: number,
  operation: string,
  filterBytes: number
) {
  const estimate = estimateJobGas(rows, columns, operation, filterBytes);
  const margin = estimate * 0.35; // Based on 34% MAPE

  return {
    estimate,
    min: Math.round(estimate - margin),
    max: Math.round(estimate + margin),
  };
}
```

---

## Production Monitoring

### Track Accuracy Over Time

```typescript
// Log predictions vs actuals
const predicted = estimateJobGas(rows, columns, operation, filterBytes);

// After execution
const actual = receipt.gasUsed;
const error = ((predicted - actual) / actual) * 100;

analytics.track("gas_estimation", {
  predicted,
  actual,
  error,
  operation,
  rows,
  columns,
});
```

### Update Schedule

- **Frequency**: Every 3-6 months or after contract changes
- **Triggers**:
  - Accuracy drift > 10%
  - Contract upgrades
  - FHE library updates
  - New operation types added

---

## Troubleshooting

### R² < 0.60 (Low Accuracy)

**Solutions**:

1. Add polynomial terms: `Rows²`, `Columns²`
2. Add more interaction terms: `FilterBytes × Rows`
3. Build operation-specific models
4. Run additional tests in problem areas

### Tests Timeout

**Solutions**:

- Reduce high-end values (100 → 50 rows, 30 → 20 columns)
- Run blocks separately (comment out others in code)
- Increase timeout: `this.timeout(600000)` in test file

### High Errors on WEIGHTED_SUM

**Expected**: Most complex operation with `O(rows × columns)` FHE operations

**Solutions**:

- Acceptable if within 50%
- Add `Op_WEIGHTED_SUM × Columns` interaction
- Consider separate model for WEIGHTED_SUM

### CSV Not Appearing

**Check**:

- All 63 tests completed successfully
- Look for "GAS BENCHMARKING COMPLETE" header
- CSV is in `after()` hook (only runs if tests pass)
- Check `../misc/gas_output.txt` if output was piped

### Python Dependencies Error

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install pandas scikit-learn matplotlib seaborn
python test/analyze_gas_results.py ../misc/gas_benchmark_results.csv
```

---

## File Structure

```
packages/fhevm-hardhat-template/test/
├── GasBenchmark.ts              # 63 benchmark test cases
├── GasEstimatorValidation.ts    # 12 validation test cases
├── analyze_gas_results.py       # Statistical analysis script
├── utils.ts                     # Dataset generation helpers
└── filter-dsl.ts                # Filter bytecode utilities

docs/
├── GAS_BENCHMARKING.md          # This guide
└── TEST_MATRIX_SUMMARY.md       # Quick reference (all 63 tests)

misc/
├── gas_benchmark_results.csv    # Raw benchmark data
├── gas_output.txt               # Full test logs
├── estimateJobGas_log.ts        # Generated estimator function
├── gas_analysis.png             # Visualizations
└── notebooks/
    └── gas_benchmark.ipynb      # Interactive analysis notebook with model development
```

## Analysis Tools

### gas_benchmark.ipynb

The Jupyter notebook (`misc/notebooks/gas_benchmark.ipynb`) provides an interactive Python environment for advanced gas analysis and model development:

**Key Features**:

- **Interactive Model Development**: Build and compare different regression approaches (linear vs log-transformed)
- **MAPE Diagnostics**: Specialized tools to identify and fix prediction accuracy issues for small datasets
- **Error Analysis**: Detailed breakdown of prediction errors by operation, row count, and dataset size
- **Real-time Visualization**: Generate plots showing actual vs predicted gas costs, coefficient importance, and scaling patterns
- **TypeScript Generation**: Automatically creates optimized `estimateJobGas()` functions with learned coefficients
- **Model Validation**: Tests multiple modeling approaches and identifies the best performing one

**When to Use**:

- After collecting benchmark data to develop the statistical model
- When troubleshooting poor model accuracy (high MAPE)
- For experimenting with new modeling approaches
- To generate updated estimator functions for production

**Key Innovation**: Discovered that log-transformed regression resolves MAPE issues for small cases, achieving 90.9% R² and 34.27% MAPE vs 70%+ MAPE with standard linear regression on datasets spanning 100× gas cost ranges.

---

## Complete Workflow

### Phase 1: Benchmark (2-3 hours)

```bash
npx hardhat test test/GasBenchmark.ts | tee ../misc/gas_output.txt
```

Copy CSV output → save to `../misc/gas_benchmark_results.csv`

### Phase 2: Analyze (5 minutes)

**Option A: Use the automated script**

```bash
python test/analyze_gas_results.py ../misc/gas_benchmark_results.csv
```

**Option B: Use the interactive notebook** (recommended for model development)

```bash
cd misc/notebooks
jupyter notebook gas_benchmark.ipynb
# Or use VS Code/Jupyter extension
```

Review R² and MAPE metrics (target: R² ≥ 0.60, MAPE ≤ 40%)

### Phase 3: Validate (30 minutes)

```bash
npx hardhat test test/GasEstimatorValidation.ts
```

Confirm MAPE ≤ 40% on holdout tests

### Phase 4: Deploy (1 hour)

1. Copy `../misc/estimateJobGas_log.ts` to application
2. Integrate into UI/API
3. Add confidence intervals
4. Setup production monitoring

---

## Success Checklist

- [ ] Ran all 63 benchmark tests successfully
- [ ] Extracted CSV with complete results
- [ ] Ran Python analysis script
- [ ] Achieved R² ≥ 0.60 (target: 60%+)
- [ ] Achieved MAPE ≤ 40%
- [ ] Ran 12 validation tests
- [ ] Validation MAPE ≤ 40%
- [ ] Integrated estimator into application
- [ ] Setup production monitoring

---

## Key Insights

1. **Column count is critical**: Affects ALL operations due to row decoding cost
2. **Economy of scale**: Negative interaction term shows larger datasets are proportionally cheaper
3. **Log-space transformation**: Captures exponential gas growth (90.9% R² vs ~70% linear)
4. **WEIGHTED_SUM dominates**: ~2.8× more expensive than COUNT due to FHE multiplications
5. **Filter scales linearly**: 0.013 coefficient per bytecode byte per row

---

**Version**: 1.0  
**Last Updated**: 2025-10-16  
**Model Performance**: R² = 0.9091, MAPE = 34.27%  
**Status**: Production Ready ✓
