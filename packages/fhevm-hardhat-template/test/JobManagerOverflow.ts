import { JobManager } from "../types";
import { DatasetRegistry } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import {
  createDefaultJobParams,
  Signers,
  deployDatasetRegistryFixture,
  deployJobManagerFixture,
  createAndRegisterDataset,
  executeJobAndDecryptResult,
  OpCodes,
  RowConfig,
  parseJobFinalizedEvent,
} from "./utils";

describe("JobManager Overflows", function () {
  let signers: Signers;
  let jobManagerContract: JobManager;
  let jobManagerContractAddress: string;
  let datasetRegistryContract: DatasetRegistry;
  let datasetRegistryContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    // Deploy a new instance of the contract before each test
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerContractAddress: jobManagerContractAddress } =
      await deployJobManagerFixture(datasetRegistryContractAddress));

    // Set the JobManager address on the DatasetRegistry so commitDataset can work
    await datasetRegistryContract.connect(signers.deployer).setJobManager(jobManagerContractAddress);
  });

  it("SUM: should overflow with large numbers", async () => {
    const datasetId = 1;
    const datasetOwner = signers.alice;
    const jobBuyer = signers.bob;
    const val = 2 ** 63; // Using 2^63 to cause overflow when added to itself

    const rowConfigs: RowConfig[][] = [
      [{ type: "euint64", value: val }], // row 0
      [{ type: "euint64", value: val }], // row 1
    ];

    const dataset = await createAndRegisterDataset(
      datasetRegistryContract,
      jobManagerContractAddress,
      datasetOwner,
      rowConfigs,
      datasetId,
    );

    const sumJobParams = {
      ...createDefaultJobParams(),
      targetField: 0,
      op: OpCodes.SUM,
    };

    const { receipt } = await executeJobAndDecryptResult(
      jobManagerContract,
      jobManagerContractAddress,
      dataset,
      sumJobParams,
      datasetOwner,
      jobBuyer,
      fhevm,
      FhevmType,
    );

    // Verify JobFinalized event is emitted
    const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

    expect(jobFinalizedEvent).to.not.be.undefined;
    const isOverflow = await fhevm.userDecryptEbool(jobFinalizedEvent?.isOverflow, jobManagerContractAddress, jobBuyer);
    expect(isOverflow).to.be.true;
  });

  it("AVG_P: should detect overflow in sum before division", async () => {
    const datasetId = 2;
    const datasetOwner = signers.alice;
    const jobBuyer = signers.bob;
    const val = 2 ** 63; // Using 2^63 to cause overflow
    const divisor = 2;

    const rowConfigs: RowConfig[][] = [[{ type: "euint64", value: val }], [{ type: "euint64", value: val }]];

    const dataset = await createAndRegisterDataset(
      datasetRegistryContract,
      jobManagerContractAddress,
      datasetOwner,
      rowConfigs,
      datasetId,
    );

    const avgJobParams = {
      ...createDefaultJobParams(),
      targetField: 0,
      op: OpCodes.AVG_P,
      divisor: divisor,
    };

    const { receipt } = await executeJobAndDecryptResult(
      jobManagerContract,
      jobManagerContractAddress,
      dataset,
      avgJobParams,
      datasetOwner,
      jobBuyer,
      fhevm,
      FhevmType,
    );

    // Verify JobFinalized event is emitted
    const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

    const isOverflow = await fhevm.userDecryptEbool(jobFinalizedEvent?.isOverflow, jobManagerContractAddress, jobBuyer);
    expect(isOverflow).to.be.true;
  });

  it("WEIGHTED_SUM: should detect overflow from multiplication", async () => {
    const datasetId = 3;
    const datasetOwner = signers.alice;
    const jobBuyer = signers.bob;
    const val = 2 ** 63;
    const weights = [2]; // This will cause val * 2, which is 2^64, an overflow

    const rowConfigs: RowConfig[][] = [[{ type: "euint64", value: val }]];

    const dataset = await createAndRegisterDataset(
      datasetRegistryContract,
      jobManagerContractAddress,
      datasetOwner,
      rowConfigs,
      datasetId,
    );

    const weightedSumJobParams = {
      ...createDefaultJobParams(),
      op: OpCodes.WEIGHTED_SUM,
      weights: weights,
    };

    const { receipt } = await executeJobAndDecryptResult(
      jobManagerContract,
      jobManagerContractAddress,
      dataset,
      weightedSumJobParams,
      datasetOwner,
      jobBuyer,
      fhevm,
      FhevmType,
    );

    // Verify JobFinalized event is emitted
    const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

    const isOverflow = await fhevm.userDecryptEbool(jobFinalizedEvent?.isOverflow, jobManagerContractAddress, jobBuyer);
    expect(isOverflow).to.be.true;
  });

  it("WEIGHTED_SUM: should detect overflow from addition", async () => {
    const datasetId = 4;
    const datasetOwner = signers.alice;
    const jobBuyer = signers.bob;
    const val = 2 ** 63;
    const weights = [1];

    const rowConfigs: RowConfig[][] = [[{ type: "euint64", value: val }], [{ type: "euint64", value: val }]];

    const dataset = await createAndRegisterDataset(
      datasetRegistryContract,
      jobManagerContractAddress,
      datasetOwner,
      rowConfigs,
      datasetId,
    );

    const weightedSumJobParams = {
      ...createDefaultJobParams(),
      op: OpCodes.WEIGHTED_SUM,
      weights: weights,
    };

    const { receipt } = await executeJobAndDecryptResult(
      jobManagerContract,
      jobManagerContractAddress,
      dataset,
      weightedSumJobParams,
      datasetOwner,
      jobBuyer,
      fhevm,
      FhevmType,
    );

    // Verify JobFinalized event is emitted
    const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

    const isOverflow = await fhevm.userDecryptEbool(jobFinalizedEvent?.isOverflow, jobManagerContractAddress, jobBuyer);
    expect(isOverflow).to.be.true;
  });

  it("should handle maximum uint64 values without overflow", async () => {
    const datasetId = 5;
    const datasetOwner = signers.alice;
    const jobBuyer = signers.bob;
    const uint64Max = BigInt(2) ** BigInt(64) - BigInt(1); // 18446744073709551615
    const val1 = uint64Max / BigInt(3);
    const val2 = uint64Max / BigInt(3);
    const val3 = uint64Max - val1 - val2; // Ensure exact sum to uint64.max

    const rowConfigs: RowConfig[][] = [
      [{ type: "euint64", value: Number(val1) }], // row 0
      [{ type: "euint64", value: Number(val2) }], // row 1
      [{ type: "euint64", value: Number(val3) }], // row 2
    ];

    const dataset = await createAndRegisterDataset(
      datasetRegistryContract,
      jobManagerContractAddress,
      datasetOwner,
      rowConfigs,
      datasetId,
    );

    const sumJobParams = {
      ...createDefaultJobParams(),
      targetField: 0,
      op: OpCodes.SUM,
    };

    const { receipt } = await executeJobAndDecryptResult(
      jobManagerContract,
      jobManagerContractAddress,
      dataset,
      sumJobParams,
      datasetOwner,
      jobBuyer,
      fhevm,
      FhevmType,
    );

    // Verify JobFinalized event is emitted
    const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

    expect(jobFinalizedEvent).to.not.be.undefined;
    const isOverflow = await fhevm.userDecryptEbool(jobFinalizedEvent?.isOverflow, jobManagerContractAddress, jobBuyer);
    expect(isOverflow).to.be.false;
  });

  it("should not overflow with small values", async () => {
    const datasetId = 6;
    const datasetOwner = signers.alice;
    const jobBuyer = signers.bob;
    const val = 1000000; // Small values that definitely won't overflow

    const rowConfigs: RowConfig[][] = [
      [{ type: "euint64", value: val }], // row 0
      [{ type: "euint64", value: val }], // row 1
      [{ type: "euint64", value: val }], // row 2
      [{ type: "euint64", value: val }], // row 3
      [{ type: "euint64", value: val }], // row 4
    ];

    const dataset = await createAndRegisterDataset(
      datasetRegistryContract,
      jobManagerContractAddress,
      datasetOwner,
      rowConfigs,
      datasetId,
    );

    const sumJobParams = {
      ...createDefaultJobParams(),
      targetField: 0,
      op: OpCodes.SUM,
    };

    const { receipt } = await executeJobAndDecryptResult(
      jobManagerContract,
      jobManagerContractAddress,
      dataset,
      sumJobParams,
      datasetOwner,
      jobBuyer,
      fhevm,
      FhevmType,
    );

    // Verify JobFinalized event is emitted
    const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

    expect(jobFinalizedEvent).to.not.be.undefined;
    const isOverflow = await fhevm.userDecryptEbool(jobFinalizedEvent?.isOverflow, jobManagerContractAddress, jobBuyer);
    expect(isOverflow).to.be.false;
  });
});
