import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { JobManager, JobManager__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { createPackedEncryptedTable } from "./RowDecoder";
import { TransactionReceipt } from "ethers";

export interface TestDataset {
  id: number;
  rows: string[];
  merkleRoot: string;
  proofs: string[][];
  numColumns: number;
  rowCount: number;
}

export interface RowConfig {
  type: "euint8" | "euint32" | "euint64";
  value: number;
}

// Test utilities
export async function generateMerkleTreeFromRows(rows: string[], datasetId: number) {
  if (rows.length === 0) {
    throw new Error("Cannot generate merkle tree from empty rows");
  }

  // Generate leaf hashes for merkle tree
  const leaves = rows.map((row, index) =>
    ethers.keccak256(ethers.solidityPacked(["uint256", "uint256", "bytes"], [datasetId, index, row])),
  );

  // Build merkle tree from bottom up
  let currentLevel = leaves;

  // Keep building levels until we have a single root
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    // Process pairs of nodes
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Combine two nodes
        const combined = ethers.keccak256(
          ethers.solidityPacked(["bytes32", "bytes32"], [currentLevel[i], currentLevel[i + 1]]),
        );
        nextLevel.push(combined);
      } else {
        // Odd number of nodes, duplicate the last one by hashing with itself
        const duplicated = ethers.keccak256(
          ethers.solidityPacked(["bytes32", "bytes32"], [currentLevel[i], currentLevel[i]]),
        );
        nextLevel.push(duplicated);
      }
    }

    currentLevel = nextLevel;
  }

  const root = currentLevel[0];

  // Generate proofs for each leaf
  const proofs = leaves.map((_, leafIndex) => generateMerkleProof(leaves, leafIndex));

  return {
    root,
    proofs: proofs.map((proof) => proof.map((p) => p.toString())),
  };
}

export function generateMerkleProof(leaves: string[], targetIndex: number): string[] {
  const proof: string[] = [];
  let currentLevel = leaves;
  let index = targetIndex;

  // Build proof from bottom up
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    const proofElements: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Two nodes - combine them
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const combined = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [left, right]));
        nextLevel.push(combined);

        // Add sibling to proof (the one we're not using for this path)
        if (i === index) {
          proofElements.push(right);
        } else if (i + 1 === index) {
          proofElements.push(left);
        }
      } else {
        // Odd number of nodes, duplicate the last one by hashing with itself
        const duplicated = ethers.keccak256(
          ethers.solidityPacked(["bytes32", "bytes32"], [currentLevel[i], currentLevel[i]]),
        );
        nextLevel.push(duplicated);

        // If this is the target node, add its duplicate as proof element
        if (i === index) {
          proofElements.push(currentLevel[i]); // The duplicate sibling is the node itself
        }
      }
    }

    // Add the proof elements from this level
    proof.push(...proofElements);

    // Move to next level and update index
    currentLevel = nextLevel;
    index = Math.floor(index / 2);
  }

  return proof;
}

export async function generateTestDatasetWithEncryption(
  contractAddress: string,
  signer: HardhatEthersSigner,
  datasetId: number = 1,
  numRows: number = 4,
  numColumns: number = 1,
) {
  // Define pool of test values to choose from
  const testValues = [
    { type: "euint8" as const, value: 42 },
    { type: "euint32" as const, value: 1337 },
    { type: "euint64" as const, value: 999999 },
    { type: "euint8" as const, value: 10 },
  ];

  // Generate rowConfigs dynamically based on numRows and numColumns
  const rowConfigs = [];
  for (let row = 0; row < numRows; row++) {
    const rowConfig = [];
    for (let col = 0; col < numColumns; col++) {
      // Cycle through test values, using modulo to wrap around
      const valueIndex = (row * numColumns + col) % testValues.length;
      rowConfig.push(testValues[valueIndex]);
    }
    rowConfigs.push(rowConfig);
  }

  return generateTestDatasetWithCustomConfig(contractAddress, signer, rowConfigs, datasetId);
}

export async function generateTestDatasetWithCustomConfig(
  contractAddress: string,
  signer: HardhatEthersSigner,
  rowConfigs: RowConfig[][],
  datasetId: number = 1,
) {
  const cellList = rowConfigs.flat();
  const numColumns = rowConfigs[0].length;
  const rows = await createPackedEncryptedTable(contractAddress, signer, cellList, numColumns);

  // Generate merkle tree from encrypted rows
  const merkleData = await generateMerkleTreeFromRows(rows, datasetId);

  return {
    rows,
    root: merkleData.root,
    proofs: merkleData.proofs,
    numColumns,
  };
}

export function createDefaultDatasetParams(id: number = 1): TestDataset {
  return {
    id,
    rows: [] as string[], // Will be populated with encrypted hex strings
    merkleRoot: "0x" as string,
    proofs: [] as string[][],
    numColumns: 3, // Default number of columns
    rowCount: 4,
  };
}

export async function setupTestDataset(
  datasetRegistry: DatasetRegistry,
  jobManagerAddress: string,
  owner: HardhatEthersSigner,
  datasetId: number = 1,
  numRows: number = 4,
  numColumns: number = 1,
): Promise<TestDataset> {
  const dataset = createDefaultDatasetParams(datasetId);

  const testData = await generateTestDatasetWithEncryption(jobManagerAddress, owner, datasetId, numRows, numColumns);
  dataset.rows = testData.rows;
  dataset.merkleRoot = testData.root;
  dataset.proofs = testData.proofs;
  dataset.numColumns = testData.numColumns;
  dataset.rowCount = testData.rows.length;

  await datasetRegistry
    .connect(owner)
    .commitDataset(dataset.id, dataset.rowCount, dataset.merkleRoot, dataset.numColumns, 0);

  return dataset;
}

export const OpCodes = {
  WEIGHTED_SUM: 0,
  SUM: 1,
  AVG_P: 2,
  COUNT: 3,
  MIN: 4,
  MAX: 5,
};

export function createDefaultJobParams() {
  return {
    op: OpCodes.SUM,
    targetField: 0,
    weights: [],
    divisor: 0,
    cooldownSec: 0,
    clampMin: 0,
    clampMax: 0,
    roundBucket: 0,
    filter: {
      bytecode: "0x",
      consts: [] as number[],
    },
  };
}

export type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

export async function deployDatasetRegistryFixture() {
  const factory = (await ethers.getContractFactory("DatasetRegistry")) as DatasetRegistry__factory;
  const datasetRegistryContract = (await factory.deploy()) as DatasetRegistry;
  const datasetRegistryContractAddress = await datasetRegistryContract.getAddress();

  return { datasetRegistryContract, datasetRegistryContractAddress };
}

export interface DatasetObject {
  merkleRoot: string;
  numColumns: bigint;
  rowCount: bigint;
  owner: string;
  exists: boolean;
}

export async function getDatasetObject(
  datasetRegistryContract: DatasetRegistry,
  datasetId: number,
): Promise<DatasetObject> {
  const [merkleRoot, numColumns, rowCount, owner, exists] = await datasetRegistryContract.getDataset(datasetId);

  return {
    merkleRoot,
    numColumns,
    rowCount,
    owner,
    exists,
  };
}

export async function deployJobManagerFixture(datasetRegistryContractAddress: string) {
  const factory = (await ethers.getContractFactory("JobManager")) as JobManager__factory;
  const jobManagerContract = (await factory.deploy(datasetRegistryContractAddress)) as JobManager;
  const jobManagerContractAddress = await jobManagerContract.getAddress();

  return { jobManagerContract, jobManagerContractAddress };
}

// Dataset creation and registration utilities
export async function createAndRegisterDataset(
  datasetRegistryContract: DatasetRegistry,
  jobManagerAddress: string,
  datasetOwner: HardhatEthersSigner,
  rowConfigs: RowConfig[][],
  datasetId: number,
): Promise<TestDataset> {
  const dataset = createDefaultDatasetParams(datasetId);

  const testData = await generateTestDatasetWithCustomConfig(jobManagerAddress, datasetOwner, rowConfigs, datasetId);
  dataset.rows = testData.rows;
  dataset.merkleRoot = testData.root;
  dataset.proofs = testData.proofs;
  dataset.numColumns = testData.numColumns;
  dataset.rowCount = testData.rows.length;

  await datasetRegistryContract
    .connect(datasetOwner)
    .commitDataset(dataset.id, dataset.rowCount, dataset.merkleRoot, dataset.numColumns, 0);

  return dataset;
}

// Job execution utilities
export async function executeJob(
  jobManagerContract: JobManager,
  dataset: TestDataset,
  jobParams: any,
  datasetOwner: HardhatEthersSigner,
  jobBuyer: HardhatEthersSigner,
): Promise<{ jobId: number; receipt: any }> {
  // Open job
  await jobManagerContract.connect(datasetOwner).openJob(dataset.id, jobBuyer.address, jobParams);
  const jobId = (await jobManagerContract.nextJobId()) - 1n; // Get the job ID (nextJobId was incremented)

  // Push all rows
  for (let i = 0; i < dataset.rows.length; i++) {
    await jobManagerContract.connect(datasetOwner).pushRow(jobId, dataset.rows[i], dataset.proofs[i], i);
  }

  // Finalize job
  const tx = await jobManagerContract.connect(datasetOwner).finalize(jobId);
  const receipt = await tx.wait();

  return { jobId: Number(jobId), receipt };
}

export async function executeJobAndDecryptResult(
  jobManagerContract: JobManager,
  jobManagerContractAddress: string,
  dataset: TestDataset,
  jobParams: any,
  datasetOwner: HardhatEthersSigner,
  jobBuyer: HardhatEthersSigner,
  fhevm: any,
  FhevmType: any,
): Promise<{ jobId: number; receipt: any; decryptedResult: bigint }> {
  const { jobId, receipt } = await executeJob(jobManagerContract, dataset, jobParams, datasetOwner, jobBuyer);

  // Parse event and decrypt result
  const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);
  const decryptedResult = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    jobFinalizedEvent?.result,
    jobManagerContractAddress,
    jobBuyer,
  );

  return { jobId, receipt, decryptedResult };
}

// Event parsing utilities
export function parseJobFinalizedEvent(jobManagerContract: JobManager, receipt: TransactionReceipt | null) {
  if (!receipt) {
    return undefined;
  }

  return receipt.logs.map((log) => jobManagerContract.interface.parseLog(log)).find((e) => e?.name === "JobFinalized")!
    .args;
}
