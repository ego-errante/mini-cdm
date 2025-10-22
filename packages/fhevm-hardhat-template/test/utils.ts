import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { JobManager, JobManager__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { TransactionReceipt } from "ethers";

import {
  TestDataset,
  RowConfig,
  DatasetObject,
  OpCodes,
  KAnonymityLevels,
  Op,
  generateMerkleTreeFromRows,
  createPackedEncryptedRow,
  encryptValues,
  packEncryptedField,
  joinPacked,
} from "@fhevm/shared";

// Local type alias for compatibility with RowDecoder functions
type LocalRowConfig = {
  type: "euint8" | "euint32" | "euint64";
  value: number;
};

// Note: generateMerkleTreeFromRows and generateMerkleProof are now imported from @fhevm/shared

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
  const cellList = rowConfigs.flat() as LocalRowConfig[];
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

/**
 * Per-row encryption version - encrypts each row independently to avoid 2048-bit limit
 * Use this for datasets with many columns or rows
 */
export async function generateTestDatasetWithCustomConfigPerRow(
  contractAddress: string,
  signer: HardhatEthersSigner,
  rowConfigs: RowConfig[][],
  datasetId: number = 1,
) {
  const numColumns = rowConfigs[0].length;
  const rows: string[] = [];

  // Encrypt each row independently
  for (const rowConfig of rowConfigs) {
    const encryptedRow = await createPackedEncryptedRow(
      contractAddress,
      signer.address,
      fhevm,
      rowConfig as LocalRowConfig[],
    );
    rows.push(encryptedRow);
  }

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

async function commitDataset(
  datasetRegistry: DatasetRegistry,
  owner: HardhatEthersSigner,
  datasetId: number,
  testData: { rows: string[]; root: string; proofs: string[][]; numColumns: number },
): Promise<TestDataset> {
  return commitDatasetWithCooldown(datasetRegistry, owner, datasetId, testData, 0);
}

async function commitDatasetWithCooldown(
  datasetRegistry: DatasetRegistry,
  owner: HardhatEthersSigner,
  datasetId: number,
  testData: { rows: string[]; root: string; proofs: string[][]; numColumns: number },
  cooldownSec: number,
): Promise<TestDataset> {
  return commitDatasetWithKAnonymity(datasetRegistry, owner, datasetId, testData, KAnonymityLevels.NONE, cooldownSec);
}

async function commitDatasetWithKAnonymity(
  datasetRegistry: DatasetRegistry,
  owner: HardhatEthersSigner,
  datasetId: number,
  testData: { rows: string[]; root: string; proofs: string[][]; numColumns: number },
  kAnonymity: number,
  cooldownSec: number = 0,
): Promise<TestDataset> {
  const dataset = createDefaultDatasetParams(datasetId);
  const datasetRegistryAddress = await datasetRegistry.getAddress();

  // Populate dataset with generated test data
  dataset.rows = testData.rows;
  dataset.merkleRoot = testData.root;
  dataset.proofs = testData.proofs;
  dataset.numColumns = testData.numColumns;
  dataset.rowCount = testData.rows.length;

  // Encrypt the k-anonymity value for the JobManager contract
  const encryptedKAnonymity = await fhevm
    .createEncryptedInput(datasetRegistryAddress, owner.address)
    .add32(kAnonymity)
    .encrypt();

  await datasetRegistry
    .connect(owner)
    .commitDataset(
      datasetId,
      dataset.rowCount,
      dataset.merkleRoot,
      dataset.numColumns,
      encryptedKAnonymity.handles[0],
      encryptedKAnonymity.inputProof,
      cooldownSec,
    );

  return dataset;
}

export async function setupTestDataset(
  datasetRegistry: DatasetRegistry,
  jobManagerAddress: string,
  owner: HardhatEthersSigner,
  datasetId: number = 1,
  numRows: number = 4,
  numColumns: number = 1,
): Promise<TestDataset> {
  const testData = await generateTestDatasetWithEncryption(jobManagerAddress, owner, datasetId, numRows, numColumns);
  return commitDataset(datasetRegistry, owner, datasetId, testData);
}

export async function setupTestDatasetWithCooldown(
  datasetRegistry: DatasetRegistry,
  jobManagerAddress: string,
  owner: HardhatEthersSigner,
  datasetId: number,
  cooldownSec: number,
  numRows: number = 4,
  numColumns: number = 1,
): Promise<TestDataset> {
  const testData = await generateTestDatasetWithEncryption(jobManagerAddress, owner, datasetId, numRows, numColumns);
  return commitDatasetWithCooldown(datasetRegistry, owner, datasetId, testData, cooldownSec);
}

// Dataset creation and registration utilities
export async function createAndRegisterDataset(
  datasetRegistryContract: DatasetRegistry,
  jobManagerAddress: string,
  datasetOwner: HardhatEthersSigner,
  rowConfigs: RowConfig[][],
  datasetId: number,
  kAnonymity: number = KAnonymityLevels.NONE,
): Promise<TestDataset> {
  const testData = await generateTestDatasetWithCustomConfig(jobManagerAddress, datasetOwner, rowConfigs, datasetId);
  return commitDatasetWithKAnonymity(datasetRegistryContract, datasetOwner, datasetId, testData, kAnonymity);
}

/**
 * Per-row encryption version - use for datasets with many columns
 */
export async function createAndRegisterDatasetPerRow(
  datasetRegistryContract: DatasetRegistry,
  jobManagerAddress: string,
  datasetOwner: HardhatEthersSigner,
  rowConfigs: RowConfig[][],
  datasetId: number,
  kAnonymity: number = KAnonymityLevels.NONE,
): Promise<TestDataset> {
  const testData = await generateTestDatasetWithCustomConfigPerRow(
    jobManagerAddress,
    datasetOwner,
    rowConfigs,
    datasetId,
  );
  return commitDatasetWithKAnonymity(datasetRegistryContract, datasetOwner, datasetId, testData, kAnonymity);
}

// OpCodes and KAnonymityLevels now imported from @fhevm/shared

export function createDefaultJobParams() {
  return {
    op: OpCodes.SUM as Op,
    targetField: 0,
    weights: [] as number[],
    divisor: 0,
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

// DatasetObject now imported above

export async function getDatasetObject(
  datasetRegistryContract: DatasetRegistry,
  datasetId: number,
): Promise<DatasetObject> {
  const [merkleRoot, numColumns, rowCount, owner, exists, kAnonymity, cooldownSec] =
    await datasetRegistryContract.getDataset(datasetId);

  return {
    merkleRoot,
    numColumns,
    rowCount,
    owner,
    exists,
    kAnonymity: Number(kAnonymity),
    cooldownSec: Number(cooldownSec),
  };
}

export async function deployJobManagerFixture(datasetRegistryContractAddress: string) {
  const factory = (await ethers.getContractFactory("JobManager")) as JobManager__factory;
  const jobManagerContract = (await factory.deploy(datasetRegistryContractAddress)) as JobManager;
  const jobManagerContractAddress = await jobManagerContract.getAddress();

  return { jobManagerContract, jobManagerContractAddress };
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
    FhevmType.euint256,
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

export async function encryptKAnonymity(
  datasetRegistryAddress: string,
  signer: HardhatEthersSigner,
  kAnonymity: number,
) {
  const encryptedInput = await fhevm
    .createEncryptedInput(datasetRegistryAddress, signer.address)
    .add32(kAnonymity)
    .encrypt();

  return {
    handle: encryptedInput.handles[0],
    inputProof: encryptedInput.inputProof,
  };
}

export async function createPackedEncryptedTable(
  contractAddress: string,
  signer: HardhatEthersSigner,
  cells: {
    type: "euint8" | "euint32" | "euint64";
    value: number;
  }[],
  columns: number,
): Promise<string[]> {
  const { handles, inputProof, typeTags } = await encryptValues(contractAddress, signer.address, fhevm, cells);

  let packedMatrix: string[][] = [];
  for (let i = 0; i < cells.length; i++) {
    const rowIndex = Math.floor(i / columns);
    if (packedMatrix.length < rowIndex + 1) packedMatrix.push([]);
    packedMatrix[rowIndex].push(packEncryptedField(Number(typeTags[i]), handles[i], inputProof));
  }

  const packedRows: string[] = [];
  for (const row of packedMatrix) {
    packedRows.push(joinPacked(row));
  }

  return packedRows;
}
