# Gas Estimator Validation Guide

## Overview

This guide covers **Phase 4: Validation** of the gas estimation model. After training your estimator on the benchmark
dataset, validation tests confirm it generalizes well to unseen data.

**Your Model Performance:**

- **Training R²**: 0.9091 (90.9%)
- **Training MAPE**: 34.27%
- **Model Type**: Log-transformed linear regression with interaction terms

---

## Quick Start

```bash
# Run validation tests
cd packages/fhevm-hardhat-template
npx hardhat test test/GasEstimatorValidation.ts
```

**Expected runtime**: 10-20 minutes for 12 validation cases

---

## What Gets Validated

### Holdout Test Strategy

The validation suite uses **12 test cases** that were **NOT in the training set**:

#### 1. **Interpolation Tests** (5 cases)

Test parameter values _between_ training points:

- Rows: 12, 15, 30, 40, 50 (between 5, 25, 100)
- Columns: 5, 7, 12, 15, 20 (between 3, 10, 32)
- Various operation and filter combinations

#### 2. **Realistic Use Cases** (3 cases)

Common real-world scenarios:

- COUNT with medium filtering
- SUM aggregation on typical datasets
- AVERAGE over wide datasets

#### 3. **WEIGHTED_SUM Focus** (2 cases)

Special attention to most expensive operation:

- Small datasets (catch edge cases)
- Medium datasets with varying column counts

#### 4. **Edge Cases** (2 cases)

Boundary conditions:

- Very small datasets with complex filters
- Large datasets with medium filters

---

## Validation Test Cases

| Test ID | Rows | Columns | Operation    | Filter  | Test Type         |
| ------- | ---- | ------- | ------------ | ------- | ----------------- |
| VAL-01  | 15   | 7       | COUNT        | simple  | Interpolation     |
| VAL-02  | 50   | 20      | SUM          | medium  | Interpolation     |
| VAL-03  | 40   | 15      | AVG_P        | complex | Interpolation     |
| VAL-04  | 12   | 5       | MIN          | none    | Interpolation     |
| VAL-05  | 30   | 12      | MAX          | simple  | Interpolation     |
| VAL-06  | 10   | 8       | WEIGHTED_SUM | medium  | Weighted Sum      |
| VAL-07  | 35   | 6       | WEIGHTED_SUM | simple  | Weighted Sum      |
| VAL-08  | 60   | 8       | COUNT        | medium  | Realistic         |
| VAL-09  | 45   | 12      | SUM          | simple  | Realistic         |
| VAL-10  | 20   | 16      | AVG_P        | none    | Realistic         |
| VAL-11  | 8    | 4       | MIN          | complex | Edge Case (small) |
| VAL-12  | 75   | 25      | MAX          | medium  | Edge Case (large) |

---

## Success Criteria

### Primary Metrics

1. **MAPE (Mean Absolute Percentage Error)**
   - **Target**: ≤ 40%
   - **Your Training MAPE**: 34.27%
   - **Measures**: Average prediction accuracy across all tests

2. **Accuracy Rate**
   - **Target**: ≥ 75% of tests within 40% error
   - **Measures**: Consistency of predictions

### Secondary Metrics

- **MAE (Mean Absolute Error)**: Average gas difference
- **Per-operation performance**: Check if certain operations have higher errors
- **Per-filter performance**: Check if filter complexity affects accuracy

---

## Running Validation

### Execute Tests

```bash
npx hardhat test test/GasEstimatorValidation.ts
```

### Real-Time Output

Each test shows:

```
--- Validation Test 1/12: VAL-01 ---
Params: 15 rows × 7 cols, COUNT, simple filter
Predicted gas: 8,245,123
Actual gas:    7,892,456
Error:         +352,667 gas
% Error:       +4.47%
Status:        ✓✓ EXCELLENT (within 20%)
```

**Status Levels:**

- ✓✓ EXCELLENT: Within 20% error
- ✓ GOOD: Within 40% error
- ✗ NEEDS IMPROVEMENT: Over 40% error

---

## Understanding Results

### Final Report Structure

After all tests complete, you'll see:

#### 1. Overall Metrics

```
Overall Metrics:
  MAPE (Mean Absolute % Error): 28.34%
  MAE (Mean Absolute Error):    1,234,567 gas
  Accuracy Rate (≤40% error):   91.7%
  Tests within target:          11/12
```

#### 2. Target Assessment

```
--- Target Assessment ---
  ✓ MAPE Target Met: 28.34% ≤ 40%
  ✓ Accuracy Target Met: 91.7% ≥ 75%
```

#### 3. Detailed Results Table

```
TestID | Rows×Cols | Operation    | Filter  | Predicted      | Actual         | % Error
-------|-----------|--------------|---------|----------------|----------------|----------
✓ VAL-01 |  15× 7    | COUNT        | simple  |      8,245,123 |      7,892,456 | +4.5%
✓ VAL-02 |  50×20    | SUM          | medium  |     42,156,789 |     39,876,543 | +5.7%
...
```

#### 4. Performance Breakdown

**By Operation:**

```
  COUNT       : 12.3% avg error (2 tests)
  SUM         : 18.5% avg error (2 tests)
  AVG_P       : 22.1% avg error (2 tests)
  WEIGHTED_SUM: 35.7% avg error (2 tests)
  MIN         : 15.4% avg error (2 tests)
  MAX         : 16.8% avg error (2 tests)
```

**By Filter Complexity:**

```
  none        : 14.2% avg error (2 tests)
  simple      : 19.5% avg error (4 tests)
  medium      : 24.8% avg error (4 tests)
  complex     : 31.2% avg error (2 tests)
```

---

## Interpreting Results

### Excellent Performance (MAPE < 30%)

✓✓ Your model is highly accurate!

- **Action**: Deploy to production with confidence
- **Recommendation**: Monitor real-world usage and update periodically

### Good Performance (30% < MAPE < 40%)

✓ Your model meets the target!

- **Action**: Deploy to production
- **Recommendation**: Consider refinements for operations with highest errors
- **Note**: 40% error margin is acceptable for gas estimation use cases

### Needs Improvement (MAPE > 40%)

✗ Model needs refinement

**Potential issues:**

1. **Insufficient training data**: Re-run benchmarks with more test cases
2. **Missing interaction terms**: Add `Rows² or Columns²` terms
3. **Operation-specific behavior**: Train separate models per operation
4. **Filter complexity**: Add more filter-specific features

---

## Common Patterns in Errors

### High Errors on WEIGHTED_SUM

**Expected**: Most complex operation with `O(rows × columns)` FHE operations

**Solutions:**

- Acceptable if within 50% (operation is inherently variable)
- Consider separate model for WEIGHTED_SUM if consistently high
- Add `Op_WEIGHTED_SUM × Columns` interaction term

### High Errors on Complex Filters

**Expected**: Filter execution cost varies with FHE stack operations

**Solutions:**

- Use actual bytecode length instead of approximation
- Add `FilterBytes × Rows` interaction term
- Acceptable if within 40-50%

### Systematic Overestimation or Underestimation

**Issue**: Model consistently predicts too high or too low

**Solutions:**

1. Check if validation data distribution differs from training
2. Consider adding polynomial terms
3. Re-train with more balanced dataset

---

## Improving Model Accuracy

### If Validation MAPE > 40%

#### Option 1: Add More Training Data

Run additional benchmark tests in problem areas:

```typescript
// Add tests for specific ranges where errors are high
{ rows: 35, columns: 15, operation: "WEIGHTED_SUM", filter: "complex" }
```

#### Option 2: Add Interaction Terms

Modify analysis script to include:

```python
X['Rows_squared'] = df['Rows'] ** 2
X['FilterBytes_x_Rows'] = df['FilterBytes'] * df['Rows']
X['Op_WEIGHTED_SUM_x_Columns'] = (df['Operation'] == 'WEIGHTED_SUM') * df['Columns']
```

#### Option 3: Operation-Specific Models

Build separate estimators for each operation:

```typescript
function estimateWeightedSumGas(rows: number, columns: number, filterBytes: number): number {
  // Specialized model for WEIGHTED_SUM
}
```

---

## Production Deployment

### After Successful Validation

1. **Copy estimator function** to your application:

```typescript
// src/utils/gasEstimator.ts
export { estimateJobGas } from "../test/estimateJobGas_log";
```

2. **Add confidence intervals** (optional):

```typescript
function estimateJobGasWithRange(
  rows: number,
  columns: number,
  operation: OperationType,
  filterBytes: number,
): { estimate: number; min: number; max: number } {
  const estimate = estimateJobGas(rows, columns, operation, filterBytes);

  // Based on validation MAPE of 28.34%
  const margin = estimate * 0.35; // 35% margin for safety

  return {
    estimate,
    min: Math.round(estimate - margin),
    max: Math.round(estimate + margin),
  };
}
```

3. **Integrate into UI**:

```typescript
// Display estimated gas cost to user
const { estimate, min, max } = estimateJobGasWithRange(userRows, userCols, userOp, userFilter);

console.log(`Estimated gas: ${estimate.toLocaleString()}`);
console.log(`Range: ${min.toLocaleString()} - ${max.toLocaleString()}`);

// Calculate cost in ETH
const gasPriceGwei = await provider.getGasPrice();
const costETH = (estimate * Number(gasPriceGwei)) / 1e18;
console.log(`Estimated cost: ${costETH.toFixed(6)} ETH`);
```

---

## Monitoring in Production

### Track Real-World Accuracy

After deployment, log actual vs predicted:

```typescript
// Before execution
const predicted = estimateJobGas(rows, columns, operation, filterBytes);

// After execution
const actual = receipt.gasUsed;
const error = ((predicted - actual) / actual) * 100;

// Log to analytics
analytics.track("gas_estimation", {
  predicted,
  actual,
  error,
  operation,
  rows,
  columns,
});
```

### Update Model Periodically

- **Frequency**: Every 3-6 months or after major contract changes
- **Process**:
  1. Collect production data
  2. Re-run benchmark tests
  3. Re-train model with updated data
  4. Validate and deploy new estimator

---

## Troubleshooting

### Issue: Validation tests timeout

**Solution**: Reduce test count or increase timeout

```typescript
this.timeout(600000); // 10 minutes
```

### Issue: Some tests fail (not timeout)

**Solution**: Check if dataset constraints are met (e.g., max 32 columns for WEIGHTED_SUM)

### Issue: MAPE significantly higher than training

**Causes:**

1. Overfitting: Model learned training data too well
2. Distribution mismatch: Validation cases too different from training
3. Implementation bug: Check estimator function

**Fix**: Add regularization or more diverse training data

---

## Success Checklist

After completing validation:

- [ ] All 12 validation tests ran successfully
- [ ] MAPE ≤ 40% (or better)
- [ ] Accuracy rate ≥ 75% (or better)
- [ ] Reviewed error patterns by operation/filter
- [ ] No systematic over/under-estimation
- [ ] Estimator function copied to application
- [ ] Integration code written and tested
- [ ] Production monitoring setup (optional but recommended)
- [ ] Documentation updated with actual validation metrics

---

## Next Steps

1. **If validation passed**: Deploy estimator to production! 🎉
2. **If validation borderline**: Consider refinements but can deploy
3. **If validation failed**: Review "Improving Model Accuracy" section

---

## Additional Resources

- **Training Guide**: `GAS_BENCHMARK_GUIDE.md`
- **Test Matrix**: `TEST_MATRIX_SUMMARY.md`
- **Analysis Script**: `analyze_gas_results.py`
- **Estimator Function**: `misc/estimateJobGas_log.ts`

---

**Version**: 1.0  
**Last Updated**: 2025-10-16  
**Model Version**: Log-transformed regression (R² = 0.9091)
