/**
 * Job utility functions for gas estimation and allowance calculation
 */

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
  operation: "COUNT" | "SUM" | "AVG_P" | "WEIGHTED_SUM" | "MIN" | "MAX",
  filterBytes: number
): bigint {
  // Log-scale linear model
  let logGas = 14.71635363;

  // Add feature contributions
  logGas += rows * 0.03171097;
  logGas += columns * 0.08678983;
  logGas += rows * columns * -0.00055629;
  logGas += filterBytes * 0.01281007;

  // Add operation-specific costs (relative to COUNT baseline)
  const operationLogCosts = {
    COUNT: 0, // baseline
    SUM: 0.18367148,
    AVG_P: 0.18604887,
    WEIGHTED_SUM: 1.05067793,
    MIN: 0.16035151,
    MAX: 0.16046606,
  };

  logGas += operationLogCosts[operation];

  // Transform back from log scale to gas units
  const gas = Math.exp(logGas);

  return BigInt(Math.round(gas));
}

/**
 * Estimates required ETH allowance for a job with 2x safety margin
 * @param rows Number of rows
 * @param columns Number of columns
 * @param operation Operation type
 * @param filterBytes Filter complexity (0-30)
 * @param gasPrice Gas price in wei
 * @returns Required allowance in wei with 2x safety margin
 */
export function estimateJobAllowance(
  rows: number,
  columns: number,
  operation: "COUNT" | "SUM" | "AVG_P" | "WEIGHTED_SUM" | "MIN" | "MAX",
  filterBytes: number,
  gasPrice: bigint
): bigint {
  const estimatedGas = estimateJobGas(rows, columns, operation, filterBytes);
  const cost = estimatedGas * gasPrice;
  // 2x safety margin
  return cost * 2n;
}
