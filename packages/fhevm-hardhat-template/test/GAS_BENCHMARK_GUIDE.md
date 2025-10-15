# Gas Benchmarking Test Matrix - Design Documentation

## Overview

This document describes the **fractional factorial design** used to estimate gas costs for JobManager operations with
**60%+ accuracy** using minimal test cases.

## Test Objectives

Estimate the gas cost function:

```
Gas = f(rows, columns, operation, filterComplexity)
```

Where the goal is to capture at least 60% of the variance in gas costs across different job configurations.

## Design Methodology

### Factorial Design Strategy

We use a **fractional factorial + augmentation** approach that balances:

- **Statistical power**: Enough data to extract meaningful coefficients
- **Efficiency**: ~63 tests vs 216 for full factorial
- **Coverage**: All main effects and key interactions captured

### Factors and Levels

| Factor                | Type        | Levels | Values                                    |
| --------------------- | ----------- | ------ | ----------------------------------------- |
| **Rows**              | Continuous  | 3      | 5, 25, 100                                |
| **Columns**           | Continuous  | 3      | 3, 10, 32                                 |
| **Operation**         | Categorical | 6      | COUNT, SUM, AVG_P, WEIGHTED_SUM, MIN, MAX |
| **Filter Complexity** | Ordinal     | 4      | none, simple, medium, complex             |

**Total possible combinations**: 3 × 3 × 6 × 4 = **216 tests**  
**Optimized test count**: **63 tests** (29% of full factorial)

**Note**: Column limit of 32 is based on FHE encryption constraint of 2048 bits per operation (32 × 64 bits = 2048
bits). We use per-row encryption to handle this limit efficiently.

## Test Matrix Structure

### Block 1: Operation Baseline (24 tests)

**Purpose**: Isolate filter complexity effect per operation

**Design**:

- All 6 operations × All 4 filter complexities
- Fixed: rows=25 (medium), columns=10 (medium)

**Why**: Establishes the baseline cost of each operation and how filter complexity scales within each operation type.

### Block 2: Row Scaling (12 tests)

**Purpose**: Establish row count coefficient per operation

**Design**:

- All 6 operations × [low rows (5), high rows (100)]
- Fixed: columns=10 (medium), filter=simple

**Why**: Captures the linear scaling with row count, which is the **primary cost driver**. We expect:

```
Gas_rows = β_operation × N_rows
```

### Block 3: Column Scaling (12 tests)

**Purpose**: Establish column count coefficient per operation

**Design**:

- All 6 operations × [low columns (3), high columns (30)]
- Fixed: rows=25 (medium), filter=simple

**Why**: Captures the decoding cost (universal) and weighted sum cost (operation-specific):

```
Gas_columns = β_decode × N_columns + β_weighted × N_columns × is_weighted_sum
```

### Block 4: Edge Cases (15 tests)

**Purpose**: Capture interaction effects and extreme scenarios

**Design**:

- 6 tests: All operations with low×low (5 rows, 3 columns)
- 9 tests: Expensive operations (WEIGHTED_SUM, SUM, AVG_P) with:
  - high×high, no filter
  - high×high, complex filter

**Why**: Tests interaction effects and validates model at extremes.

## Filter Complexity Definitions

| Level       | Description                | Operations                           | Bytecode Size |
| ----------- | -------------------------- | ------------------------------------ | ------------- |
| **None**    | Empty filter (accepts all) | 0                                    | 0 bytes       |
| **Simple**  | Single comparison          | 1 comparison                         | ~7 bytes      |
| **Medium**  | Compound condition         | 1 AND + 2 comparisons                | ~15 bytes     |
| **Complex** | Nested conditions          | 2 AND + 1 OR + 1 NOT + 4 comparisons | ~30 bytes     |

### Filter Examples

```typescript
// Simple: field[0] > 100
gt(0, 100);

// Medium: (field[0] > 100) AND (field[1] < 500)
and(gt(0, 100), lt(1, 500));

// Complex: ((field[0] > 100) AND (field[1] < 500)) OR
//          ((field[2] >= 200) AND NOT(field[0] == 999))
or(and(gt(0, 100), lt(1, 500)), and(ge(2, 200), not(eq(0, 999))));
```

## Running the Benchmarks

### Execute Tests

```bash
cd packages/fhevm-hardhat-template
npx hardhat test test/GasBenchmark.ts
```

**Expected runtime**: 30-90 minutes (depending on network speed)

### Output Format

The test suite outputs CSV data at the end:

```csv
TestID,Rows,Columns,Operation,FilterComplexity,OpenJobGas,PushRowTotal,PushRowAvg,FinalizeGas,TotalGas
B1-1,25,10,COUNT,none,850000,12500000,500000,650000,14000000
B1-2,25,10,COUNT,simple,850000,13750000,550000,650000,15250000
...
```

### Capturing Results

1. **Copy CSV output** from terminal after all tests complete
2. **Save to file**: `gas_benchmark_results.csv`
3. **Import to analysis tool**: Excel, Python (pandas), R, or Google Sheets

## Statistical Analysis

### Recommended Model (Linear Regression)

```
TotalGas = β₀
  + β₁ × Rows
  + β₂ × Columns
  + β₃ × FilterBytecodeLenth
  + β₄ × Op_SUM
  + β₅ × Op_AVG_P
  + β₆ × Op_WEIGHTED_SUM
  + β₇ × Op_MIN
  + β₈ × Op_MAX
  + ε
```

**Note**: Use dummy variables for categorical operations (COUNT is the reference category)

### Python Analysis Example

```python
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score

# Load data
df = pd.read_csv('gas_benchmark_results.csv')

# Create features
X = pd.get_dummies(df[['Rows', 'Columns', 'Operation', 'FilterComplexity']],
                   columns=['Operation', 'FilterComplexity'])
y = df['TotalGas']

# Fit model
model = LinearRegression()
model.fit(X, y)

# Evaluate
y_pred = model.predict(X)
r2 = r2_score(y, y_pred)
print(f"R² Score: {r2:.3f} ({r2*100:.1f}% variance explained)")

# Get coefficients
coef_df = pd.DataFrame({
    'Feature': X.columns,
    'Coefficient': model.coef_
}).sort_values('Coefficient', ascending=False)
print(coef_df)
```

### Expected Results

Based on the design, you should achieve:

- **R² ≥ 0.70**: 70%+ of variance explained (exceeds 60% target)
- **Significant coefficients** for:
  - Rows (largest positive)
  - Columns (large positive)
  - WEIGHTED_SUM operation (large positive)
  - Filter complexity (moderate positive)

### Key Insights to Extract

1. **Per-row cost by operation**:

   ```
   Cost_per_row[op] = β₁ + β_op
   ```

2. **Per-column cost** (universal decoding):

   ```
   Cost_per_column = β₂
   ```

3. **Filter cost per bytecode byte**:

   ```
   Cost_per_filter_byte = β₃ / avg_bytecode_length
   ```

4. **Operation base costs** (one-time overhead):
   ```
   Base_cost[op] = β₀ + β_op
   ```

## Building the Gas Estimator

After analysis, create a simple estimator function:

```typescript
function estimateGas(rows: number, columns: number, operation: string, filterBytes: number): number {
  // Coefficients from regression (example values)
  const BASE = 1_200_000;
  const PER_ROW = 450_000;
  const PER_COLUMN = 120_000;
  const PER_FILTER_BYTE = 15_000;

  // Operation multipliers
  const OP_MULTIPLIER = {
    COUNT: 1.0,
    SUM: 1.2,
    AVG_P: 1.25,
    WEIGHTED_SUM: 2.5,
    MIN: 1.3,
    MAX: 1.3,
  };

  return (
    BASE +
    rows * PER_ROW * OP_MULTIPLIER[operation] +
    rows * columns * PER_COLUMN +
    rows * filterBytes * PER_FILTER_BYTE
  );
}
```

## Validation Strategy

### Holdout Testing

After building your estimator:

1. Run 5-10 **new** test cases with random parameter combinations
2. Compare predicted vs actual gas costs
3. Calculate Mean Absolute Percentage Error (MAPE):
   ```
   MAPE = (1/n) Σ |actual - predicted| / actual × 100%
   ```
4. Target: **MAPE < 40%** (equivalent to 60%+ accuracy)

### Example Validation Cases

```typescript
// Validation test 1: Medium-complexity real-world case
{ rows: 50, columns: 15, operation: "SUM", filter: "medium" }

// Validation test 2: High-volume simple query
{ rows: 200, columns: 5, operation: "COUNT", filter: "simple" }

// Validation test 3: Complex analytical query
{ rows: 75, columns: 20, operation: "WEIGHTED_SUM", filter: "complex" }
```

## Test Matrix Summary

| Block       | Focus                      | Tests  | Key Insight                   |
| ----------- | -------------------------- | ------ | ----------------------------- |
| **Block 1** | Filter effect by operation | 24     | How filter complexity scales  |
| **Block 2** | Row scaling                | 12     | Linear relationship with rows |
| **Block 3** | Column scaling             | 12     | Decoding cost per column      |
| **Block 4** | Interactions & extremes    | 15     | Edge cases & validation       |
| **TOTAL**   | -                          | **63** | -                             |

## Next Steps

### Phase 2: Run Tests & Capture Data (2-3 hours)

1. Execute: `npx hardhat test test/GasBenchmark.ts`
2. Copy CSV output from terminal
3. Save to `gas_benchmark_results.csv`

### Phase 3: Regression Analysis (1 hour)

1. Import CSV into Python/R/Excel
2. Run linear regression
3. Extract coefficients
4. Calculate R² (target: ≥0.60)

### Phase 4: Build Estimator (1 hour)

1. Create `estimateGas()` function with coefficients
2. Validate with holdout tests
3. Document accuracy (MAPE)

## Technical Notes

### Why This Design Works

1. **Main effects captured**: Every factor varied systematically
2. **Key interactions tested**: Operation×rows, operation×columns tested directly
3. **Efficient sampling**: Avoids redundant combinations while maintaining power
4. **Realistic scenarios**: Edge cases validate model at extremes

### Cost Drivers (Expected Hierarchy)

1. **Rows** (primary) - Linear multiplier
2. **Columns** (secondary) - Affects every row via decoding
3. **Operation** (categorical) - Different computational complexity
4. **Filter** (moderate) - Scales with bytecode length

### Assumptions

- Gas costs are **linear** in rows and columns (validated by design)
- Filter costs scale **linearly** with bytecode complexity
- **No significant 3-way interactions** (rows×columns×operation)
- Contract state overhead is **negligible** compared to FHE operations

## Troubleshooting

### If R² < 0.60

1. **Add interaction terms**:

   ```
   + β_interaction × (Rows × Columns)
   ```

2. **Try polynomial terms**:

   ```
   + β_quad × Rows²
   ```

3. **Run additional tests** focusing on the operation with highest residuals

### If tests timeout

- Reduce high-end values (100 rows → 50 rows, 30 columns → 20 columns)
- Run blocks separately (comment out other blocks)
- Increase Hardhat timeout in `hardhat.config.ts`

## References

- **Factorial Design**: Montgomery, D. C. (2017). _Design and Analysis of Experiments_
- **Linear Regression**: James, G. et al. (2013). _An Introduction to Statistical Learning_
- **Gas Optimization**: Ethereum Yellow Paper, Appendix G

---

**Author**: Gas Benchmarking Team  
**Version**: 1.0  
**Last Updated**: 2025-10-15
