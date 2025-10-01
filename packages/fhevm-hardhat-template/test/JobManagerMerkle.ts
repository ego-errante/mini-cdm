import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { JobManager, JobManager__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("JobManager - Merkle Integration", function () {
  let signers: Signers;
  let datasetRegistryContract: DatasetRegistry;
  let jobManagerContract: JobManager;
  let datasetRegistryAddress: string;
  let jobManagerAddress: string;

  // Test dataset: 4 rows for simplicity
  const testDataset = {
    id: 1,
    rows: [
      ethers.toUtf8Bytes("row0_data_encrypted_values"),
      ethers.toUtf8Bytes("row1_data_encrypted_values"),
      ethers.toUtf8Bytes("row2_data_encrypted_values"),
      ethers.toUtf8Bytes("row3_data_encrypted_values"),
    ] as Uint8Array[],
    merkleRoot: "0x" as string,
    proofs: [] as string[][],
    schemaHash: ethers.keccak256(ethers.toUtf8Bytes("test_schema")),
  };

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };

    // Generate test merkle tree
    const testData = generateTestMerkleData(testDataset.rows, testDataset.id);
    testDataset.merkleRoot = testData.root;
    testDataset.proofs = testData.proofs;
  });

  beforeEach(async () => {
    ({ datasetRegistryContract, datasetRegistryAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerAddress } = await deployJobManagerFixture(datasetRegistryAddress));

    // Setup test dataset
    await datasetRegistryContract
      .connect(signers.alice)
      .commitDataset(testDataset.id, testDataset.merkleRoot, testDataset.schemaHash);
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
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
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
      const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes("wrong_root"));
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(wrongDatasetId, wrongRoot, testDataset.schemaHash);

      // Open job on different dataset
      await jobManagerContract.connect(signers.alice).openJob(wrongDatasetId, jobParams);
      const jobId = 0;

      // Try to push row from original dataset - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
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
      const rowData = testDataset.rows[rowIndex];
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "DatasetNotFound");
    });
  });
});

// Test utilities
function generateTestMerkleData(rows: Uint8Array[], datasetId: number) {
  // Generate leaf hashes
  const leaves = rows.map((row, index) =>
    ethers.keccak256(ethers.solidityPacked(["uint256", "uint256", "bytes"], [datasetId, index, row])),
  );

  // Build simple merkle tree (for 4 leaves)
  // Level 2: leaves
  const level1 = [
    ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [leaves[0], leaves[1]])),
    ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [leaves[2], leaves[3]])),
  ];

  // Level 1: root
  const root = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [level1[0], level1[1]]));

  // Generate proofs for each leaf
  const proofs = [
    // Proof for leaf 0: [leaves[1], level1[1]]
    [leaves[1], level1[1]],
    // Proof for leaf 1: [leaves[0], level1[1]]
    [leaves[0], level1[1]],
    // Proof for leaf 2: [leaves[3], level1[0]]
    [leaves[3], level1[0]],
    // Proof for leaf 3: [leaves[2], level1[0]]
    [leaves[2], level1[0]],
  ];

  return {
    root,
    proofs: proofs.map((proof) => proof.map((p) => p.toString())),
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
