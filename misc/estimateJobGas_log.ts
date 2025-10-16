
/**
 * Estimates gas cost for a JobManager job based on parameters
 * 
 * Model: Log-transformed linear regression
 * Accuracy: R² = 0.9091 (90.9%), MAPE = 34.27%
 * 
 * @param rows Number of rows in dataset
 * @param columns Number of columns in dataset
 * @param operation Operation type
 * @param filterBytes Approximate filter bytecode length (0=none, 7=simple, 15=medium, 30=complex)
 * @returns Estimated total gas cost
 */
export function estimateJobGas(
  rows: number,
  columns: number,
  operation: 'COUNT' | 'SUM' | 'AVG_P' | 'WEIGHTED_SUM' | 'MIN' | 'MAX',
  filterBytes: number
): number {
  // Log-scale linear model
  let logGas = 14.71635363;

  // Add feature contributions
  logGas += rows * 0.03171097;
  logGas += columns * 0.08678983;
  logGas += (rows * columns) * -0.00055629;
  logGas += filterBytes * 0.01281007;

  // Add operation-specific costs (relative to COUNT baseline)
  const operationLogCosts = {
    'COUNT': 0,  // baseline
    'SUM': 0.18367148,
    'AVG_P': 0.18604887,
    'WEIGHTED_SUM': 1.05067793,
    'MIN': 0.16035151,
    'MAX': 0.16046606,
  };

  logGas += operationLogCosts[operation];

  // Transform back from log scale to gas units
  const gas = Math.exp(logGas);

  return Math.round(gas);
}

// Example usage:
const gas1 = estimateJobGas(5, 3, 'COUNT', 7);    // Small case
const gas2 = estimateJobGas(25, 10, 'SUM', 15);   // Medium case
const gas3 = estimateJobGas(100, 32, 'AVG_P', 30); // Large case

console.log(`Small (5×3 COUNT):    ${gas1.toLocaleString()} gas`);
console.log(`Medium (25×10 SUM):   ${gas2.toLocaleString()} gas`);
console.log(`Large (100×32 AVG_P): ${gas3.toLocaleString()} gas`);
