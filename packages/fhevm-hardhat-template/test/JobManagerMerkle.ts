import { DatasetRegistry } from "../types";
import { JobManager } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  createDefaultJobParams,
  Signers,
  deployDatasetRegistryFixture,
  deployJobManagerFixture,
  setupTestDataset,
  TestDataset,
} from "./utils";

describe("Merkle Integration", function () {
  let signers: Signers;
  let datasetRegistryContract: DatasetRegistry;
  let jobManagerContract: JobManager;
  let datasetRegistryContractAddress: string;
  let jobManagerContractAddress: string;
  let testDataset: TestDataset;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerContractAddress } = await deployJobManagerFixture(datasetRegistryContractAddress));

    testDataset = await setupTestDataset(datasetRegistryContract, jobManagerContractAddress, signers.alice);
  });

  describe("pushRow with merkle proof", () => {
    it("should accept valid merkle proof for row 0", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams),
      ).to.emit(jobManagerContract, "JobOpened");

      const jobId = 0;

      // Push row 0 with valid proof
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex))
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    it("should reject invalid merkle proof", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
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
      await jobManagerContract.connect(signers.alice).openJob(wrongDatasetId, signers.bob.address, jobParams);
      const jobId = 0;

      // Try to push row from original dataset - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "MerkleVerificationFailed");
    });

    it("should reject out-of-order row in same job", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = 0;

      // Push row 0 first - should succeed
      const rowIndex0 = 0;
      const rowData0 = testDataset.rows[rowIndex0];
      const merkleProof0 = testDataset.proofs[rowIndex0];

      await jobManagerContract.connect(signers.alice).pushRow(jobId, rowData0, merkleProof0, rowIndex0);

      // Try to push row 0 again (out of order) - should fail
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData0, merkleProof0, rowIndex0),
      ).to.be.revertedWithCustomError(jobManagerContract, "RowOutOfOrder");
    });

    it("should accept sequential rows in ascending order", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = 0;

      // Push row 0 - should succeed
      await jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0);

      // Push row 1 - should succeed (next in sequence)
      await jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[1], testDataset.proofs[1], 1);

      // Push row 2 - should succeed (next in sequence)
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[2], testDataset.proofs[2], 2),
      )
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    it("should reject non-sequential row indices", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = 0;

      // Push row 0 - should succeed
      await jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0);

      // Try to skip to row 2 (skipping row 1) - should fail
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[2], testDataset.proofs[2], 2),
      ).to.be.revertedWithCustomError(jobManagerContract, "RowOutOfOrder");
    });

    it("should accept same row in different jobs", async () => {
      const jobParams = createDefaultJobParams();

      // Open first job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId1 = 0;

      // Open second job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
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
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
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

    it("should reject pushRow from non-dataset-owner", async () => {
      const jobParams = createDefaultJobParams();

      // Alice opens job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = 0;

      // Bob tries to push row - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.bob).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "NotDatasetOwner");
    });

    it("should handle empty proof array gracefully", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
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
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
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

    it("should successfully verify all elements of a dataset with odd number of rows", async () => {
      const jobParams = createDefaultJobParams();

      // Create a dataset with 3 rows (odd number)
      const oddRowDataset = await setupTestDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        signers.alice,
        2,
        3,
        1,
      );

      // Open job on the odd-row dataset
      await expect(
        jobManagerContract.connect(signers.alice).openJob(oddRowDataset.id, signers.bob.address, jobParams),
      ).to.emit(jobManagerContract, "JobOpened");

      const jobId = 0; // Second job since we already have jobId 0 from beforeEach

      // Push all rows in order (0, 1, 2)
      for (let rowIndex = 0; rowIndex < oddRowDataset.rows.length; rowIndex++) {
        const rowData = oddRowDataset.rows[rowIndex];
        const merkleProof = oddRowDataset.proofs[rowIndex];

        await expect(jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex))
          .to.emit(jobManagerContract, "RowPushed")
          .withArgs(jobId);
      }

      // Verify all 3 rows were processed
      expect(oddRowDataset.rows.length).to.equal(3);
    });
  });
});
