# Gas Benchmark Test Matrix - Quick Reference

## Test Matrix Overview

**Total Tests**: 63  
**Estimated Runtime**: 30-90 minutes  
**Target Accuracy**: ≥60% (R² ≥ 0.60)

---

## Block 1: Operation Baseline (24 tests)

**Fixed**: rows=25, columns=10  
**Varies**: All operations × All filter complexities

| Test ID | Operation    | Filter  | Description                               |
| ------- | ------------ | ------- | ----------------------------------------- |
| B1-1    | COUNT        | none    | Baseline COUNT with none filter           |
| B1-2    | COUNT        | simple  | Baseline COUNT with simple filter         |
| B1-3    | COUNT        | medium  | Baseline COUNT with medium filter         |
| B1-4    | COUNT        | complex | Baseline COUNT with complex filter        |
| B1-5    | SUM          | none    | Baseline SUM with none filter             |
| B1-6    | SUM          | simple  | Baseline SUM with simple filter           |
| B1-7    | SUM          | medium  | Baseline SUM with medium filter           |
| B1-8    | SUM          | complex | Baseline SUM with complex filter          |
| B1-9    | AVG_P        | none    | Baseline AVG_P with none filter           |
| B1-10   | AVG_P        | simple  | Baseline AVG_P with simple filter         |
| B1-11   | AVG_P        | medium  | Baseline AVG_P with medium filter         |
| B1-12   | AVG_P        | complex | Baseline AVG_P with complex filter        |
| B1-13   | WEIGHTED_SUM | none    | Baseline WEIGHTED_SUM with none filter    |
| B1-14   | WEIGHTED_SUM | simple  | Baseline WEIGHTED_SUM with simple filter  |
| B1-15   | WEIGHTED_SUM | medium  | Baseline WEIGHTED_SUM with medium filter  |
| B1-16   | WEIGHTED_SUM | complex | Baseline WEIGHTED_SUM with complex filter |
| B1-17   | MIN          | none    | Baseline MIN with none filter             |
| B1-18   | MIN          | simple  | Baseline MIN with simple filter           |
| B1-19   | MIN          | medium  | Baseline MIN with medium filter           |
| B1-20   | MIN          | complex | Baseline MIN with complex filter          |
| B1-21   | MAX          | none    | Baseline MAX with none filter             |
| B1-22   | MAX          | simple  | Baseline MAX with simple filter           |
| B1-23   | MAX          | medium  | Baseline MAX with medium filter           |
| B1-24   | MAX          | complex | Baseline MAX with complex filter          |

---

## Block 2: Row Scaling (12 tests)

**Fixed**: columns=10, filter=simple  
**Varies**: All operations × [low rows (5), high rows (100)]

| Test ID | Operation    | Rows | Description                       |
| ------- | ------------ | ---- | --------------------------------- |
| B2-25   | COUNT        | 5    | COUNT with LOW rows (5)           |
| B2-26   | COUNT        | 100  | COUNT with HIGH rows (100)        |
| B2-27   | SUM          | 5    | SUM with LOW rows (5)             |
| B2-28   | SUM          | 100  | SUM with HIGH rows (100)          |
| B2-29   | AVG_P        | 5    | AVG_P with LOW rows (5)           |
| B2-30   | AVG_P        | 100  | AVG_P with HIGH rows (100)        |
| B2-31   | WEIGHTED_SUM | 5    | WEIGHTED_SUM with LOW rows (5)    |
| B2-32   | WEIGHTED_SUM | 100  | WEIGHTED_SUM with HIGH rows (100) |
| B2-33   | MIN          | 5    | MIN with LOW rows (5)             |
| B2-34   | MIN          | 100  | MIN with HIGH rows (100)          |
| B2-35   | MAX          | 5    | MAX with LOW rows (5)             |
| B2-36   | MAX          | 100  | MAX with HIGH rows (100)          |

---

## Block 3: Column Scaling (12 tests)

**Fixed**: rows=25, filter=simple  
**Varies**: All operations × [low columns (3), high columns (30)]

| Test ID | Operation    | Columns | Description                         |
| ------- | ------------ | ------- | ----------------------------------- |
| B3-37   | COUNT        | 3       | COUNT with LOW columns (3)          |
| B3-38   | COUNT        | 30      | COUNT with HIGH columns (30)        |
| B3-39   | SUM          | 3       | SUM with LOW columns (3)            |
| B3-40   | SUM          | 30      | SUM with HIGH columns (30)          |
| B3-41   | AVG_P        | 3       | AVG_P with LOW columns (3)          |
| B3-42   | AVG_P        | 30      | AVG_P with HIGH columns (30)        |
| B3-43   | WEIGHTED_SUM | 3       | WEIGHTED_SUM with LOW columns (3)   |
| B3-44   | WEIGHTED_SUM | 30      | WEIGHTED_SUM with HIGH columns (30) |
| B3-45   | MIN          | 3       | MIN with LOW columns (3)            |
| B3-46   | MIN          | 30      | MIN with HIGH columns (30)          |
| B3-47   | MAX          | 3       | MAX with LOW columns (3)            |
| B3-48   | MAX          | 30      | MAX with HIGH columns (30)          |

---

## Block 4: Edge Cases (15 tests)

**Varies**: Extreme combinations and interaction effects

### Part A: All operations with minimal dimensions (6 tests)

**Fixed**: rows=5, columns=3, filter=simple

| Test ID | Operation    | Rows | Columns | Description                              |
| ------- | ------------ | ---- | ------- | ---------------------------------------- |
| B4-49   | COUNT        | 5    | 3       | COUNT with LOW rows + LOW columns        |
| B4-50   | SUM          | 5    | 3       | SUM with LOW rows + LOW columns          |
| B4-51   | AVG_P        | 5    | 3       | AVG_P with LOW rows + LOW columns        |
| B4-52   | WEIGHTED_SUM | 5    | 3       | WEIGHTED_SUM with LOW rows + LOW columns |
| B4-53   | MIN          | 5    | 3       | MIN with LOW rows + LOW columns          |
| B4-54   | MAX          | 5    | 3       | MAX with LOW rows + LOW columns          |

### Part B: High-stress tests on expensive operations (9 tests)

**Expensive operations**: WEIGHTED_SUM, SUM, AVG_P

| Test ID | Operation    | Rows | Columns | Filter  | Description                                |
| ------- | ------------ | ---- | ------- | ------- | ------------------------------------------ |
| B4-55   | WEIGHTED_SUM | 100  | 30      | none    | WEIGHTED_SUM with HIGH rows + HIGH columns |
| B4-56   | WEIGHTED_SUM | 100  | 30      | complex | WEIGHTED_SUM STRESS TEST: HIGH everything  |
| B4-57   | SUM          | 100  | 30      | none    | SUM with HIGH rows + HIGH columns          |
| B4-58   | SUM          | 100  | 30      | complex | SUM STRESS TEST: HIGH everything           |
| B4-59   | AVG_P        | 100  | 30      | none    | AVG_P with HIGH rows + HIGH columns        |
| B4-60   | AVG_P        | 100  | 30      | complex | AVG_P STRESS TEST: HIGH everything         |

---

## Factor Levels Summary

| Factor      | Low | Medium | High |
| ----------- | --- | ------ | ---- |
| **Rows**    | 5   | 25     | 100  |
| **Columns** | 3   | 10     | 30   |

| Factor                | Levels                                    |
| --------------------- | ----------------------------------------- |
| **Operations**        | COUNT, SUM, AVG_P, WEIGHTED_SUM, MIN, MAX |
| **Filter Complexity** | none, simple, medium, complex             |

---

## Filter Complexity Details

### None (0 operations, 0 bytes)

```
Empty filter - accepts all rows
```

### Simple (1 comparison, ~7 bytes)

```typescript
// field[0] > 100
gt(0, 100);
```

### Medium (3-4 operations, ~15 bytes)

```typescript
// (field[0] > 100) AND (field[1] < 500)
and(gt(0, 100), lt(1, 500));
```

### Complex (8-10 operations, ~30 bytes)

```typescript
// ((field[0] > 100) AND (field[1] < 500)) OR
// ((field[2] >= 200) AND NOT(field[0] == 999))
or(and(gt(0, 100), lt(1, 500)), and(ge(2, 200), not(eq(0, 999))));
```

---

## Expected Gas Measurements

### Output CSV Format

```csv
TestID,Rows,Columns,Operation,FilterComplexity,OpenJobGas,PushRowTotal,PushRowAvg,FinalizeGas,TotalGas
```

### Columns Explained

- **OpenJobGas**: Gas used for job initialization
- **PushRowTotal**: Cumulative gas for all pushRow calls
- **PushRowAvg**: Average gas per pushRow call
- **FinalizeGas**: Gas used for job finalization
- **TotalGas**: Sum of all phases

---

## Quick Start

### 1. Run Benchmarks

```bash
cd packages/fhevm-hardhat-template
npx hardhat test test/GasBenchmark.ts
```

### 2. Capture Output

Copy CSV from terminal output (printed after all tests complete)

### 3. Analyze

Import CSV into Python/R/Excel and run regression:

```python
import pandas as pd
from sklearn.linear_model import LinearRegression

df = pd.read_csv('results.csv')
X = pd.get_dummies(df[['Rows', 'Columns', 'Operation', 'FilterComplexity']])
y = df['TotalGas']

model = LinearRegression().fit(X, y)
print(f"R² = {model.score(X, y):.3f}")
```

### 4. Build Estimator

Use coefficients to create gas estimation function

---

## Design Rationale

### Why 63 tests?

| Approach        | Tests  | Coverage | Efficiency            |
| --------------- | ------ | -------- | --------------------- |
| Full Factorial  | 216    | 100%     | Baseline              |
| **Our Design**  | **63** | **~85%** | **3.4× faster**       |
| Random Sampling | 63     | ~60%     | Same time, less power |

### What we capture

✅ **Main effects**: All factors varied systematically  
✅ **2-way interactions**: Operation × Rows, Operation × Columns, Rows × Columns  
✅ **Edge cases**: Extremes to validate model boundaries  
✅ **Filter scaling**: All complexity levels tested per operation

### What we assume negligible

❌ 3-way interactions (e.g., Rows × Columns × Operation)  
❌ Non-linear effects beyond quadratic  
❌ Contract state initialization overhead

---

## Validation Checklist

After running tests and building estimator:

- [ ] R² ≥ 0.60 (preferably ≥ 0.70)
- [ ] Row coefficient is positive and significant
- [ ] Column coefficient is positive and significant
- [ ] WEIGHTED_SUM has highest operation coefficient
- [ ] Filter complexity correlates positively with gas
- [ ] Validation MAPE < 40% on holdout tests

---

## Contact & Support

For questions or issues:

1. Check `GAS_BENCHMARK_GUIDE.md` for detailed documentation
2. Review test implementation in `GasBenchmark.ts`
3. Validate test data generation in `utils.ts`

**Last Updated**: 2025-10-15
