# Gas Benchmarking Suite - Complete Guide

## 🎯 Quick Start (TL;DR)

```bash
# 1. Run benchmarks (30-90 min)
npx hardhat test test/GasBenchmark.ts > gas_output.txt

# 2. Extract CSV (copy from terminal output at end)
# Save to: gas_benchmark_results.csv

# 3. Analyze results
pip install pandas scikit-learn matplotlib seaborn
python test/analyze_gas_results.py gas_benchmark_results.csv

# 4. Use the generated estimateJobGas.ts function in your app
```

**Expected Outcome**: Gas estimation function with **60%+ accuracy** (R² ≥ 0.60)

---

## 📋 Overview

This test suite implements a **fractional factorial design** to estimate gas costs for JobManager operations across
different parameter combinations:

- **63 test cases** (vs 216 for full factorial)
- **4 factors**: Rows, Columns, Operation Type, Filter Complexity
- **Target accuracy**: ≥60% variance explained (R²)

### What Gets Measured

For each test case, we capture:

- `openJob` gas cost
- `pushRow` gas cost (total and per-row average)
- `finalize` gas cost
- **Total gas cost** (primary target for estimation)

---

## 📁 Files in This Suite

| File                         | Purpose                                |
| ---------------------------- | -------------------------------------- |
| `GasBenchmark.ts`            | Main test suite (63 test cases)        |
| `GAS_BENCHMARK_GUIDE.md`     | Detailed methodology and theory        |
| `TEST_MATRIX_SUMMARY.md`     | Quick reference of all test cases      |
| `analyze_gas_results.py`     | Python script for statistical analysis |
| `README_GAS_BENCHMARKING.md` | This file (quick start guide)          |

---

## 🚀 Phase 1: Understanding the Design

### Test Matrix Blocks

Our 63 tests are organized into 4 strategic blocks:

#### Block 1: Operation Baseline (24 tests)

- **Tests**: All 6 operations × All 4 filter complexities
- **Fixed**: rows=25, columns=10
- **Purpose**: Measure how filter complexity affects each operation

#### Block 2: Row Scaling (12 tests)

- **Tests**: All 6 operations × [5 rows, 100 rows]
- **Fixed**: columns=10, filter=simple
- **Purpose**: Measure linear scaling with row count

#### Block 3: Column Scaling (12 tests)

- **Tests**: All 6 operations × [3 columns, 30 columns]
- **Fixed**: rows=25, filter=simple
- **Purpose**: Measure decoding cost per column

#### Block 4: Edge Cases (15 tests)

- **Tests**: Extreme combinations and high-stress scenarios
- **Purpose**: Validate model at boundaries and capture interactions

### Factor Levels

| Factor      | Low | Medium | High |
| ----------- | --- | ------ | ---- |
| **Rows**    | 5   | 25     | 100  |
| **Columns** | 3   | 10     | 30   |

**Operations**: COUNT, SUM, AVG_P, WEIGHTED_SUM, MIN, MAX  
**Filter Complexity**: none (0 bytes), simple (7 bytes), medium (15 bytes), complex (30 bytes)

---

## 🔬 Phase 2: Running the Benchmarks

### Prerequisites

```bash
cd packages/fhevm-hardhat-template
npm install  # Ensure dependencies are installed
```

### Run Tests

```bash
# Run and capture output
npx hardhat test test/GasBenchmark.ts | tee gas_output.txt
```

**Expected runtime**: 30-90 minutes depending on network speed

### Monitor Progress

Tests will log progress in real-time:

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

### Extract Results

At the end of all tests, CSV data will be printed:

```csv
TestID,Rows,Columns,Operation,FilterComplexity,OpenJobGas,PushRowTotal,PushRowAvg,FinalizeGas,TotalGas
B1-1,25,10,COUNT,none,850000,12500000,500000,650000,14000000
B1-2,25,10,COUNT,simple,850000,13750000,550000,650000,15250000
...
```

**Action**: Copy this CSV output and save to `gas_benchmark_results.csv`

---

## 📊 Phase 3: Statistical Analysis

### Setup Python Environment

```bash
pip install pandas scikit-learn matplotlib seaborn
```

### Run Analysis Script

```bash
python test/analyze_gas_results.py gas_benchmark_results.csv
```

### What the Script Does

1. **Loads data** and computes basic statistics
2. **Builds linear regression model**:
   ```
   TotalGas = β₀ + β₁×Rows + β₂×Columns + β₃×FilterBytes + Σ(β_op×Operation)
   ```
3. **Reports metrics**:
   - R² score (target: ≥0.60)
   - MAPE (target: ≤40%)
   - Coefficient values
4. **Generates visualizations** (`gas_analysis.png`)
5. **Creates TypeScript estimator function** (`estimateJobGas.ts`)

### Expected Output

```
========================================
Model Performance:
  R² Score:  0.7234 (72.3% variance explained)
  MAPE:      28.45%
  Target:    R² ≥ 0.60, MAPE ≤ 40%
  ✓ Model meets 60% accuracy target!

Model Coefficients:
  Intercept: 1,200,000 gas

Feature              Coefficient
Rows                     450,000
Columns                  120,000
FilterBytes               15,000
Op_WEIGHTED_SUM        8,500,000
Op_SUM                 1,200,000
Op_AVG_P               1,350,000
Op_MIN                 1,100,000
Op_MAX                 1,150,000
```

---

## 🎨 Phase 4: Using the Estimator

### Generated Function

The analysis script generates `estimateJobGas.ts`:

```typescript
function estimateJobGas(
  rows: number,
  columns: number,
  operation: 'COUNT' | 'SUM' | 'AVG_P' | 'WEIGHTED_SUM' | 'MIN' | 'MAX',
  filterBytes: number
): number {
  // Implementation with actual coefficients from your data
  ...
}
```

### Integration Example

```typescript
import { estimateJobGas } from "./estimateJobGas";

// User wants to query a dataset
const userQuery = {
  rows: 50,
  columns: 15,
  operation: "SUM",
  filterBytes: 7, // Simple filter
};

const estimatedGas = estimateJobGas(userQuery.rows, userQuery.columns, userQuery.operation, userQuery.filterBytes);

console.log(`Estimated gas: ${estimatedGas.toLocaleString()}`);
// Output: Estimated gas: 18,750,000

// Use for UI display, cost calculation, or gas limit setting
const gasPriceGwei = 50;
const estimatedCostETH = (estimatedGas * gasPriceGwei) / 1e9;
console.log(`Estimated cost: ${estimatedCostETH.toFixed(6)} ETH`);
```

---

## ✅ Validation Strategy

### Holdout Testing

Create 5-10 new test cases with random parameters:

```typescript
const holdoutTests = [
  { rows: 50, columns: 15, operation: "SUM", filter: "medium" },
  { rows: 75, columns: 20, operation: "WEIGHTED_SUM", filter: "complex" },
  { rows: 10, columns: 5, operation: "COUNT", filter: "simple" },
  // ... more cases
];
```

Run these tests, compare predicted vs actual, calculate MAPE.

### Acceptance Criteria

✅ **R² ≥ 0.60**: Model explains at least 60% of variance  
✅ **MAPE ≤ 40%**: Average prediction error within 40%  
✅ **Visual inspection**: Actual vs predicted plot shows good fit  
✅ **Coefficient signs**: All positive (more rows/cols/filter = more gas)

---

## 🔍 Interpreting Results

### Understanding Coefficients

| Coefficient         | Interpretation                           | Typical Value |
| ------------------- | ---------------------------------------- | ------------- |
| **Intercept**       | Base cost (openJob + finalize)           | ~1-2M gas     |
| **Rows**            | Additional gas per row                   | ~400-600K gas |
| **Columns**         | Additional gas per column per row        | ~100-150K gas |
| **FilterBytes**     | Additional gas per bytecode byte per row | ~10-20K gas   |
| **Op_WEIGHTED_SUM** | Extra cost for weighted sum vs COUNT     | ~5-10M gas    |
| **Op_SUM**          | Extra cost for sum vs COUNT              | ~1-2M gas     |

### Cost Breakdown Example

For a job with 50 rows, 10 columns, SUM operation, simple filter (7 bytes):

```
Base:         1,200,000 gas
Rows:         50 × 450,000 = 22,500,000 gas
Columns:      50 × 10 × 120,000 = 60,000,000 gas
Filter:       50 × 7 × 15,000 = 5,250,000 gas
Operation:    1,200,000 gas (SUM overhead)
              ─────────────────
TOTAL:        90,150,000 gas
```

**Key Insight**: In this example, column decoding (67%) dominates cost, followed by row processing (25%).

---

## 🛠️ Troubleshooting

### Issue: R² < 0.60

**Solutions**:

1. Add interaction terms: `Rows × Columns`
2. Try polynomial terms: `Rows²`
3. Run additional tests in the underperforming operation

### Issue: Tests Timeout

**Solutions**:

- Reduce high-end values (100 → 50 rows, 30 → 20 columns)
- Run blocks separately (comment out other blocks in code)
- Increase timeout in `GasBenchmark.ts`: `this.timeout(600000)` (10 min)

### Issue: Python Dependencies Error

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install pandas scikit-learn matplotlib seaborn
python test/analyze_gas_results.py gas_benchmark_results.csv
```

### Issue: CSV Not Appearing

- Check that all 63 tests completed successfully
- Look for the "GAS BENCHMARKING COMPLETE" header
- CSV is in the `after()` hook, runs only if tests pass
- Check `gas_output.txt` if you piped output

---

## 📈 Advanced Analysis

### Adding Interaction Terms

If R² is low, modify the analysis script to include interactions:

```python
# In build_regression_model function, add:
X['Rows_x_Columns'] = df['Rows'] * df['Columns']
X['Rows_x_FilterBytes'] = df['Rows'] * df['FilterBytes']
```

### Operation-Specific Models

Build separate models per operation for higher accuracy:

```python
for op in df['Operation'].unique():
    op_df = df[df['Operation'] == op]
    model, X, y, y_pred, coef_df = build_regression_model(op_df)
```

### Time Series Analysis

If running benchmarks multiple times, track how costs change:

```python
df['Timestamp'] = pd.to_datetime('now')
# Merge with previous runs
# Plot trends over time
```

---

## 📚 Additional Resources

### Documentation Files

- **`GAS_BENCHMARK_GUIDE.md`**: In-depth methodology, statistical theory, validation strategies
- **`TEST_MATRIX_SUMMARY.md`**: Complete list of all 63 test cases with descriptions
- **`GasBenchmark.ts`**: Test implementation (well-commented)

### Related Test Files

- **`utils.ts`**: Helper functions for dataset generation and job execution
- **`filter-dsl.ts`**: Filter bytecode compilation utilities
- **`JobManager.ts`**: Main JobManager test suite (reference for patterns)

### External References

- **Factorial Design**: Montgomery, D. C. (2017). _Design and Analysis of Experiments_
- **FHE Gas Costs**: Check Zama documentation for FHE operation costs
- **Ethereum Gas**: [Ethereum Yellow Paper, Appendix G](https://ethereum.github.io/yellowpaper/paper.pdf)

---

## 🤝 Contributing

### Improving the Model

If you find ways to improve accuracy:

1. **Document changes**: Update coefficients in `estimateJobGas.ts`
2. **Share insights**: Add findings to `GAS_BENCHMARK_GUIDE.md`
3. **Extend tests**: Add new test cases to `GasBenchmark.ts`

### Reporting Issues

When reporting issues, include:

- R² score and MAPE from analysis
- Operation types with highest residuals
- Any error messages from test run

---

## 📞 Support

For questions or issues:

1. Check **troubleshooting section** above
2. Review **`GAS_BENCHMARK_GUIDE.md`** for detailed explanations
3. Examine test implementation in **`GasBenchmark.ts`**
4. Check existing test patterns in **`JobManager.ts`**

---

## 🎉 Success Checklist

- [ ] Ran all 63 benchmark tests successfully
- [ ] Extracted CSV with all test results
- [ ] Ran Python analysis script
- [ ] Achieved R² ≥ 0.60
- [ ] Generated `estimateJobGas.ts` function
- [ ] Validated estimator on holdout test cases
- [ ] MAPE ≤ 40% on validation set
- [ ] Integrated estimator into application

**Congratulations!** You now have a gas estimation model that captures at least 60% of JobManager gas costs! 🎊

---

**Version**: 1.0  
**Last Updated**: 2025-10-15  
**Maintainers**: Gas Benchmarking Team
