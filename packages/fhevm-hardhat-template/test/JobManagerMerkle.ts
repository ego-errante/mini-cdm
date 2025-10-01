import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { JobManager, JobManager__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { createPackedEncryptedRow, createPackedEncryptedTable } from "./RowDecoder";

describe("JobManager - Merkle Integration", function () {
  let signers: Signers;
  let datasetRegistryContract: DatasetRegistry;
  let jobManagerContract: JobManager;
  let datasetRegistryAddress: string;
  let jobManagerAddress: string;

  // Test dataset: 4 rows for simplicity
  const testDataset = {
    id: 1,
    rows: [] as string[], // Will be populated with encrypted hex strings
    merkleRoot: "0x" as string,
    proofs: [] as string[][],
    schemaHash: ethers.keccak256(ethers.toUtf8Bytes("test_schema")),
    rowCount: 4,
  };

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    ({ datasetRegistryContract, datasetRegistryAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerAddress } = await deployJobManagerFixture(datasetRegistryAddress));

    // Generate test dataset with proper encrypted rows
    const testData = await generateTestDatasetWithEncryption(jobManagerAddress, signers.alice);
    testDataset.rows = testData.rows;
    testDataset.merkleRoot = testData.root;
    testDataset.proofs = testData.proofs;

    // Setup test dataset
    await datasetRegistryContract
      .connect(signers.alice)
      .commitDataset(testDataset.id, testDataset.rowCount, testDataset.merkleRoot, testDataset.schemaHash);
  });

  describe("pushRow with merkle proof", () => {
    it("should accept valid merkle proof for row 0", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await expect(jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams)).to.emit(
        jobManagerContract,
        "JobOpened",
      );

      const jobId = 0;

      // Push row 0 with valid proof
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex))
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    it("should accept valid merkle proof for row 1", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId = 0;

      // Push row 1 with valid proof
      const rowIndex = 1;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex))
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    it("should reject invalid merkle proof", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId = 0;

      // Push row with invalid proof (wrong proof elements)
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const invalidProof = [
        ethers.keccak256(ethers.toUtf8Bytes("invalid")),
        ethers.keccak256(ethers.toUtf8Bytes("proof")),
      ];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, invalidProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "MerkleVerificationFailed");
    });

    it("should reject proof for wrong dataset", async () => {
      const jobParams = createDefaultJobParams();

      // Create different dataset
      const wrongDatasetId = 999;
      const wrongRowCount = 1;
      const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes("wrong_root"));
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(wrongDatasetId, wrongRowCount, wrongRoot, testDataset.schemaHash);

      // Open job on different dataset
      await jobManagerContract.connect(signers.alice).openJob(wrongDatasetId, jobParams);
      const jobId = 0;

      // Try to push row from original dataset - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "MerkleVerificationFailed");
    });

    it("should reject duplicate row in same job", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId = 0;

      // Push row 0 first time - should succeed
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex);

      // Push same row again - should fail
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "RowAlreadyConsumed");
    });

    it("should accept same row in different jobs", async () => {
      const jobParams = createDefaultJobParams();

      // Open first job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId1 = 0;

      // Open second job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId2 = 1;

      // Push row 0 to first job
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await jobManagerContract.connect(signers.alice).pushRow(jobId1, rowData, merkleProof, rowIndex);

      // Push same row to second job - should succeed (different job)
      await expect(jobManagerContract.connect(signers.alice).pushRow(jobId2, rowData, merkleProof, rowIndex))
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId2);
    });

    it("should reject pushRow on closed job", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId = 0;

      // Finalize job
      await jobManagerContract.connect(signers.alice).finalize(jobId);

      // Try to push row - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "JobClosed");
    });

    it("should reject pushRow from non-job-buyer", async () => {
      const jobParams = createDefaultJobParams();

      // Alice opens job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId = 0;

      // Bob tries to push row - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.bob).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "NotJobBuyer");
    });

    it("should handle empty proof array gracefully", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId = 0;

      // Push row with empty proof
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const emptyProof: string[] = [];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, emptyProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "MerkleVerificationFailed");
    });

    it("should validate rowIndex bounds (must be >= 0)", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, jobParams);
      const jobId = 0;

      // This should work with rowIndex = 0
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex)).to.emit(
        jobManagerContract,
        "RowPushed",
      );
    });
  });

  describe("Dataset validation", () => {
    it("should reject pushRow for non-existent dataset", async () => {
      const jobParams = createDefaultJobParams();

      // Open job on non-existent dataset
      const nonExistentDatasetId = 999;
      await jobManagerContract.connect(signers.alice).openJob(nonExistentDatasetId, jobParams);
      const jobId = 0;

      // Try to push row - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "DatasetNotFound");
    });
  });
});

// Test utilities
async function generateMerkleTreeFromRows(rows: string[], datasetId: number) {
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
        // Odd number of nodes, duplicate the last one
        nextLevel.push(currentLevel[i]);
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

function generateMerkleProof(leaves: string[], targetIndex: number): string[] {
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
        // Odd number of nodes, just pass through
        nextLevel.push(currentLevel[i]);
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

async function generateTestDatasetWithEncryption(contractAddress: string, signer: HardhatEthersSigner) {
  // Define default test data for 4 rows
  const rowConfigs = [
    [{ type: "euint8" as const, value: 42 }],
    [{ type: "euint32" as const, value: 1337 }],
    [{ type: "euint64" as const, value: 999999 }],
    [{ type: "euint8" as const, value: 10 }],
  ];

  return generateTestDatasetWithCustomConfig(contractAddress, signer, rowConfigs);
}

async function generateTestDatasetWithCustomConfig(
  contractAddress: string,
  signer: HardhatEthersSigner,
  rowConfigs: { type: "euint8" | "euint32" | "euint64"; value: number }[][],
) {
  const cellList = rowConfigs.flat();
  const columns = rowConfigs[0].length;
  const rows = await createPackedEncryptedTable(contractAddress, signer, cellList, columns);

  // Generate merkle tree from encrypted rows
  const merkleData = await generateMerkleTreeFromRows(rows, 1);

  return {
    rows,
    root: merkleData.root,
    proofs: merkleData.proofs,
  };
}

function createDefaultJobParams() {
  return {
    op: 1, // SUM
    targetField: 0,
    weightFieldIdx: [],
    weightVals: [],
    divisor: 0,
    k: 0,
    cooldownSec: 0,
    clampMin: 0,
    clampMax: 0,
    roundBucket: 0,
    filter: {
      bytecode: "0x",
      consts: [],
    },
  };
}

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployDatasetRegistryFixture() {
  const factory = (await ethers.getContractFactory("DatasetRegistry")) as DatasetRegistry__factory;
  const datasetRegistryContract = (await factory.deploy()) as DatasetRegistry;
  const datasetRegistryAddress = await datasetRegistryContract.getAddress();

  return { datasetRegistryContract, datasetRegistryAddress };
}

async function deployJobManagerFixture(datasetRegistryAddress: string) {
  const factory = (await ethers.getContractFactory("JobManager")) as JobManager__factory;
  const jobManagerContract = (await factory.deploy(datasetRegistryAddress)) as JobManager;
  const jobManagerAddress = await jobManagerContract.getAddress();

  return { jobManagerContract, jobManagerAddress };
}
