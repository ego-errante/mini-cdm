import { DatasetRegistry } from "../../types";
import { JobManager } from "../../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  createDefaultJobParams,
  Signers,
  deployDatasetRegistryFixture,
  deployJobManagerFixture,
  setupTestDataset,
  encryptKAnonymity,
} from "../utils";
import { TestDataset, KAnonymityLevels } from "@fhevm/shared";

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

    await datasetRegistryContract.connect(signers.deployer).setJobManager(jobManagerContractAddress);

    testDataset = await setupTestDataset(datasetRegistryContract, jobManagerContractAddress, signers.alice);
  });

  describe("pushRow with merkle proof", () => {
    it("should accept valid merkle proof for row 0", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      const jobId = await jobManagerContract.nextJobId();
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams),
      ).to.emit(jobManagerContract, "JobOpened");

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
      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

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

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        KAnonymityLevels.NONE,
      );

      // Create different dataset
      const wrongDatasetId = 999;
      const wrongRowCount = 1;
      const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes("wrong_root"));
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(
          wrongDatasetId,
          wrongRowCount,
          wrongRoot,
          testDataset.numColumns,
          encryptedKAnonymity,
          inputProof,
          0,
        );

      // Open job on different dataset
      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(wrongDatasetId, signers.bob.address, jobParams);

      // Try to push row from original dataset - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "MerkleVerificationFailed");
    });

    it("should handle empty proof array gracefully", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

      // Push row with empty proof
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const emptyProof: string[] = [];

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, emptyProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "MerkleVerificationFailed");
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
      const jobId = await jobManagerContract.nextJobId();
      await expect(
        jobManagerContract.connect(signers.alice).openJob(oddRowDataset.id, signers.bob.address, jobParams),
      ).to.emit(jobManagerContract, "JobOpened");

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
