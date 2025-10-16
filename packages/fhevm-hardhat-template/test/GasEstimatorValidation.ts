import { JobManager } from "../types";
import { DatasetRegistry } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  createDefaultJobParams,
  Signers,
  deployDatasetRegistryFixture,
  deployJobManagerFixture,
  TestDataset,
  OpCodes,
  KAnonymityLevels,
  RowConfig,
  createAndRegisterDatasetPerRow,
} from "./utils";
import { compileFilterDSL, gt, lt, and, or, not, eq } from "./filter-dsl";
import { estimateJobGas } from "../../../misc/estimateJobGas_log";

// ========================================
// VALIDATION TEST CASES
// ========================================

/**
 * Holdout validation test cases
 * These are parameter combinations NOT in the training set
 * to validate the estimator's generalization ability
 */
interface ValidationTestCase {
  id: string;
  rows: number;
  columns: number;
  operation: keyof typeof OpCodes;
  filterComplexity: "none" | "simple" | "medium" | "complex";
  description: string;
  expectedAccuracyNote?: string;
}

/**
 * Define holdout test cases for validation
 * Strategy: Pick parameter values between or outside training points
 */
const VALIDATION_TEST_CASES: ValidationTestCase[] = [
  // ========================================
  // INTERPOLATION TESTS (between training points)
  // ========================================
  {
    id: "VAL-01",
    rows: 15, // Between 5 and 25
    columns: 7, // Between 3 and 10
    operation: "COUNT",
    filterComplexity: "simple",
    description: "Interpolation: Small-medium COUNT with simple filter",
  },
  {
    id: "VAL-02",
    rows: 50, // Between 25 and 100
    columns: 20, // Between 10 and 32
    operation: "SUM",
    filterComplexity: "medium",
    description: "Interpolation: Medium SUM with medium filter",
  },
  {
    id: "VAL-03",
    rows: 40,
    columns: 15,
    operation: "AVG_P",
    filterComplexity: "complex",
    description: "Interpolation: Medium AVG_P with complex filter",
  },
  {
    id: "VAL-04",
    rows: 12,
    columns: 5,
    operation: "MIN",
    filterComplexity: "none",
    description: "Interpolation: Small MIN with no filter",
  },
  {
    id: "VAL-05",
    rows: 30,
    columns: 12,
    operation: "MAX",
    filterComplexity: "simple",
    description: "Interpolation: Medium MAX with simple filter",
  },

  // ========================================
  // WEIGHTED_SUM TESTS (most expensive operation)
  // ========================================
  {
    id: "VAL-06",
    rows: 10,
    columns: 8,
    operation: "WEIGHTED_SUM",
    filterComplexity: "medium",
    description: "WEIGHTED_SUM: Small with medium filter",
  },
  {
    id: "VAL-07",
    rows: 35,
    columns: 6,
    operation: "WEIGHTED_SUM",
    filterComplexity: "simple",
    description: "WEIGHTED_SUM: Medium rows, fewer columns",
  },

  // ========================================
  // REALISTIC USE CASES
  // ========================================
  {
    id: "VAL-08",
    rows: 60,
    columns: 8,
    operation: "COUNT",
    filterComplexity: "medium",
    description: "Realistic: Count with filtering on medium dataset",
  },
  {
    id: "VAL-09",
    rows: 45,
    columns: 12,
    operation: "SUM",
    filterComplexity: "simple",
    description: "Realistic: Sum aggregation on typical dataset",
  },
  {
    id: "VAL-10",
    rows: 20,
    columns: 16,
    operation: "AVG_P",
    filterComplexity: "none",
    description: "Realistic: Average over wide dataset",
  },

  // ========================================
  // EDGE CASE EXTRAPOLATIONS
  // ========================================
  {
    id: "VAL-11",
    rows: 8,
    columns: 4,
    operation: "MIN",
    filterComplexity: "complex",
    description: "Edge: Very small dataset with complex filter",
  },
  {
    id: "VAL-12",
    rows: 75,
    columns: 25,
    operation: "MAX",
    filterComplexity: "medium",
    description: "Edge: Large dataset with medium filter",
  },
];

// ========================================
// HELPER FUNCTIONS
// ========================================

function generateFilter(complexity: "none" | "simple" | "medium" | "complex", numColumns: number) {
  const field0 = 0;
  const field1 = Math.min(1, numColumns - 1);
  const field2 = Math.min(2, numColumns - 1);

  switch (complexity) {
    case "none":
      return { bytecode: "0x", consts: [] };
    case "simple":
      return compileFilterDSL(gt(field0, 100));
    case "medium":
      return compileFilterDSL(and(gt(field0, 100), lt(field1, 500)));
    case "complex":
      return compileFilterDSL(or(and(gt(field0, 100), lt(field1, 500)), and(not(eq(field2, 999)), gt(field0, 50))));
    default:
      throw new Error(`Unknown filter complexity: ${complexity}`);
  }
}

function getFilterBytes(complexity: "none" | "simple" | "medium" | "complex"): number {
  const mapping = {
    none: 0,
    simple: 7,
    medium: 15,
    complex: 30,
  };
  return mapping[complexity];
}

function generateRowConfigs(numRows: number, numColumns: number): RowConfig[][] {
  const rowConfigs: RowConfig[][] = [];

  for (let row = 0; row < numRows; row++) {
    const rowConfig: RowConfig[] = [];
    for (let col = 0; col < numColumns; col++) {
      const baseValue = 100 + row * 50 + col * 10;
      const value = baseValue % 1000;

      rowConfig.push({
        type: "euint64",
        value: value,
      });
    }
    rowConfigs.push(rowConfig);
  }

  return rowConfigs;
}

// ========================================
// VALIDATION METRICS
// ========================================

interface ValidationResult {
  testCase: ValidationTestCase;
  predicted: number;
  actual: number;
  error: number;
  percentError: number;
  openJobGas: bigint;
  pushRowGasTotal: bigint;
  finalizeGas: bigint;
}

function calculateValidationMetrics(results: ValidationResult[]) {
  const errors = results.map((r) => r.percentError);
  const mape = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
  const mae = results.reduce((sum, r) => sum + Math.abs(r.error), 0) / results.length;

  const withinTargets = results.filter((r) => Math.abs(r.percentError) <= 40).length;
  const accuracyRate = (withinTargets / results.length) * 100;

  return {
    mape,
    mae,
    accuracyRate,
    withinTargets,
    totalTests: results.length,
  };
}

// ========================================
// VALIDATION TEST SUITE
// ========================================

describe("Gas Estimator Validation (Holdout Tests)", function () {
  // Increase timeout for validation tests
  this.timeout(300000); // 5 minutes

  let signers: Signers;
  let jobManagerContract: JobManager;
  let jobManagerContractAddress: string;
  let datasetRegistryContract: DatasetRegistry;
  let datasetRegistryContractAddress: string;

  const validationResults: ValidationResult[] = [];

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };

    console.log("\n========================================");
    console.log("GAS ESTIMATOR VALIDATION");
    console.log("========================================");
    console.log(`Total validation cases: ${VALIDATION_TEST_CASES.length}`);
    console.log("Model: Log-transformed linear regression");
    console.log("Training R²: 0.9091 (90.9%)");
    console.log("Training MAPE: 34.27%");
    console.log("\nValidation Strategy: Holdout test cases");
    console.log("Target: MAPE ≤ 40%, Accuracy Rate ≥ 75%");
    console.log("========================================\n");
  });

  beforeEach(async function () {
    // Deploy fresh contracts for each test
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerContractAddress } = await deployJobManagerFixture(datasetRegistryContractAddress));

    await datasetRegistryContract.connect(signers.deployer).setJobManager(jobManagerContractAddress);
  });

  VALIDATION_TEST_CASES.forEach((testCase, index) => {
    it(`[${testCase.id}] ${testCase.description}`, async function () {
      console.log(`\n--- Validation Test ${index + 1}/${VALIDATION_TEST_CASES.length}: ${testCase.id} ---`);
      console.log(
        `Params: ${testCase.rows} rows × ${testCase.columns} cols, ${testCase.operation}, ${testCase.filterComplexity} filter`,
      );

      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;
      const datasetId = 1;

      // ========================================
      // STEP 1: Get predicted gas from estimator
      // ========================================
      const filterBytes = getFilterBytes(testCase.filterComplexity);
      const predicted = estimateJobGas(testCase.rows, testCase.columns, testCase.operation, filterBytes);

      console.log(`Predicted gas: ${predicted.toLocaleString()}`);

      // ========================================
      // STEP 2: Run actual job and measure gas
      // ========================================
      const rowConfigs = generateRowConfigs(testCase.rows, testCase.columns);
      const dataset: TestDataset = await createAndRegisterDatasetPerRow(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
        KAnonymityLevels.NONE,
      );

      const jobParams = createDefaultJobParams();
      jobParams.op = OpCodes[testCase.operation];
      jobParams.targetField = 0;

      if (testCase.operation === "WEIGHTED_SUM") {
        jobParams.weights = Array.from({ length: testCase.columns }, (_, i) => i + 1);
      }

      if (testCase.operation === "AVG_P") {
        jobParams.divisor = testCase.rows;
      }

      const filter = generateFilter(testCase.filterComplexity, testCase.columns);
      jobParams.filter = filter;

      // Measure openJob
      const openTx = await jobManagerContract.connect(datasetOwner).openJob(datasetId, jobBuyer.address, jobParams);
      const openReceipt = await openTx.wait();
      const openJobGas = openReceipt!.gasUsed;

      const jobId = (await jobManagerContract.nextJobId()) - 1n;

      // Measure pushRow
      let pushRowGasTotal = 0n;
      for (let i = 0; i < dataset.rows.length; i++) {
        const pushTx = await jobManagerContract
          .connect(datasetOwner)
          .pushRow(jobId, dataset.rows[i], dataset.proofs[i], i);
        const pushReceipt = await pushTx.wait();
        pushRowGasTotal += pushReceipt!.gasUsed;
      }

      // Measure finalize
      const finalizeTx = await jobManagerContract.connect(datasetOwner).finalize(jobId);
      const finalizeReceipt = await finalizeTx.wait();
      const finalizeGas = finalizeReceipt!.gasUsed;

      // Calculate actual total
      const actual = Number(openJobGas + pushRowGasTotal + finalizeGas);

      // ========================================
      // STEP 3: Calculate error metrics
      // ========================================
      const error = predicted - actual;
      const percentError = (error / actual) * 100;

      console.log(`Actual gas:    ${actual.toLocaleString()}`);
      console.log(`Error:         ${error.toLocaleString()} gas`);
      console.log(`% Error:       ${percentError.toFixed(2)}%`);

      // Color-coded status
      if (Math.abs(percentError) <= 20) {
        console.log(`Status:        ✓✓ EXCELLENT (within 20%)`);
      } else if (Math.abs(percentError) <= 40) {
        console.log(`Status:        ✓ GOOD (within 40%)`);
      } else {
        console.log(`Status:        ✗ NEEDS IMPROVEMENT (> 40%)`);
      }

      // Store result
      validationResults.push({
        testCase,
        predicted,
        actual,
        error,
        percentError,
        openJobGas,
        pushRowGasTotal,
        finalizeGas,
      });

      // Assert job completed successfully
      expect(await jobManagerContract.jobOpen(jobId)).to.be.false;
    });
  });

  // ========================================
  // FINAL VALIDATION REPORT
  // ========================================
  after(function () {
    console.log("\n========================================");
    console.log("VALIDATION RESULTS SUMMARY");
    console.log("========================================\n");

    const metrics = calculateValidationMetrics(validationResults);

    console.log("Overall Metrics:");
    console.log(`  MAPE (Mean Absolute % Error): ${metrics.mape.toFixed(2)}%`);
    console.log(`  MAE (Mean Absolute Error):    ${metrics.mae.toLocaleString()} gas`);
    console.log(`  Accuracy Rate (≤40% error):   ${metrics.accuracyRate.toFixed(1)}%`);
    console.log(`  Tests within target:          ${metrics.withinTargets}/${metrics.totalTests}`);

    console.log("\n--- Target Assessment ---");
    if (metrics.mape <= 40) {
      console.log(`  ✓ MAPE Target Met: ${metrics.mape.toFixed(2)}% ≤ 40%`);
    } else {
      console.log(`  ✗ MAPE Above Target: ${metrics.mape.toFixed(2)}% > 40%`);
    }

    if (metrics.accuracyRate >= 75) {
      console.log(`  ✓ Accuracy Target Met: ${metrics.accuracyRate.toFixed(1)}% ≥ 75%`);
    } else {
      console.log(`  ✗ Accuracy Below Target: ${metrics.accuracyRate.toFixed(1)}% < 75%`);
    }

    console.log("\n--- Detailed Results by Test Case ---");
    console.log("\nTestID | Rows×Cols | Operation    | Filter  | Predicted      | Actual         | % Error");
    console.log("-------|-----------|--------------|---------|----------------|----------------|----------");

    validationResults.forEach((r) => {
      const status = Math.abs(r.percentError) <= 40 ? "✓" : "✗";
      console.log(
        `${status} ${r.testCase.id} | ${r.testCase.rows.toString().padStart(3)}×${r.testCase.columns.toString().padStart(2)}    | ${r.testCase.operation.padEnd(12)} | ${r.testCase.filterComplexity.padEnd(7)} | ${r.predicted.toLocaleString().padStart(14)} | ${r.actual.toLocaleString().padStart(14)} | ${r.percentError > 0 ? "+" : ""}${r.percentError.toFixed(1)}%`,
      );
    });

    console.log("\n--- Performance by Operation ---");
    const byOperation: Record<string, ValidationResult[]> = {};
    validationResults.forEach((r) => {
      const op = r.testCase.operation;
      if (!byOperation[op]) byOperation[op] = [];
      byOperation[op].push(r);
    });

    Object.keys(byOperation).forEach((op) => {
      const results = byOperation[op];
      const avgError = results.reduce((sum, r) => sum + Math.abs(r.percentError), 0) / results.length;
      console.log(`  ${op.padEnd(12)}: ${avgError.toFixed(1)}% avg error (${results.length} tests)`);
    });

    console.log("\n--- Performance by Filter Complexity ---");
    const byFilter: Record<string, ValidationResult[]> = {};
    validationResults.forEach((r) => {
      const filter = r.testCase.filterComplexity;
      if (!byFilter[filter]) byFilter[filter] = [];
      byFilter[filter].push(r);
    });

    Object.keys(byFilter).forEach((filter) => {
      const results = byFilter[filter];
      const avgError = results.reduce((sum, r) => sum + Math.abs(r.percentError), 0) / results.length;
      console.log(`  ${filter.padEnd(12)}: ${avgError.toFixed(1)}% avg error (${results.length} tests)`);
    });

    console.log("\n========================================");
    console.log("VALIDATION COMPLETE!");
    console.log("========================================");

    if (metrics.mape <= 40 && metrics.accuracyRate >= 75) {
      console.log("\n✓✓ ESTIMATOR VALIDATED SUCCESSFULLY!");
      console.log("Your gas estimator is ready for production use.");
    } else if (metrics.mape <= 50) {
      console.log("\n✓ ESTIMATOR PERFORMS REASONABLY WELL");
      console.log("Consider refinements for better accuracy, but usable.");
    } else {
      console.log("\n✗ ESTIMATOR NEEDS IMPROVEMENT");
      console.log("Consider re-training with additional data or interaction terms.");
    }

    console.log("\n--- Next Steps ---");
    console.log("1. Review individual test case errors above");
    console.log("2. Check if certain operations/filters have higher errors");
    console.log("3. If needed, retrain model with problematic cases");
    console.log("4. Deploy estimator to your application");
    console.log("5. Monitor real-world accuracy and update as needed\n");
  });
});
