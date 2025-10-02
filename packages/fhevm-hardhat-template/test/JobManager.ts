import { IJobManager, IJobManager__factory, JobManager, JobManager__factory } from "../types";
import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  generateTestDatasetWithEncryption,
  createDefaultJobParams,
  Signers,
  deployDatasetRegistryFixture,
  deployJobManagerFixture,
  generateMerkleTreeFromRows,
} from "./utils";

describe("JobManager", function () {
  let signers: Signers;
  let jobManagerContract: JobManager;
  let jobManagerContractAddress: string;
  let datasetRegistryContract: DatasetRegistry;
  let datasetRegistryContractAddress: string;

  // Test dataset
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
    // Deploy a new instance of the contract before each test
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerContractAddress: jobManagerContractAddress } =
      await deployJobManagerFixture(datasetRegistryContractAddress));

    const testData = await generateTestDatasetWithEncryption(jobManagerContractAddress, signers.alice);
    testDataset.rows = testData.rows;
    testDataset.merkleRoot = testData.root;
    testDataset.proofs = testData.proofs;

    // Setup test dataset
    await datasetRegistryContract
      .connect(signers.alice)
      .commitDataset(testDataset.id, testDataset.rowCount, testDataset.merkleRoot, testDataset.schemaHash);
  });

  it("should deploy the contract", async () => {
    console.log(`JobManager has been deployed at address ${jobManagerContractAddress}`);

    expect(jobManagerContract).to.not.be.null;
    expect(jobManagerContractAddress).to.not.be.null;
  });

  describe("openJob", () => {
    it("should open a job", async () => {
      const jobParams = createDefaultJobParams();

      // Open the job and expect the JobOpened event to be emitted
      await expect(jobManagerContract.openJob(testDataset.id, signers.alice, jobParams))
        .to.emit(jobManagerContract, "JobOpened")
        .withArgs(0, testDataset.id, signers.alice); // jobId should be 0 for first job

      const jobId = 0; // First job should have ID 0

      // Verify the job was properly created
      expect(await jobManagerContract.jobBuyer(jobId)).to.equal(signers.alice.address);
      expect(await jobManagerContract.jobOpen(jobId)).to.be.true;
      expect(await jobManagerContract.nextJobId()).to.equal(1); // Should be incremented to 1
    });

    it("should initialize job state with zero values after openJob", async () => {
      const datasetId = 1;
      const jobParams = createDefaultJobParams();

      await jobManagerContract.connect(signers.alice).openJob(datasetId, signers.alice.address, jobParams);
      const jobId = 0;

      // Verify dataset is stored
      expect(await jobManagerContract.jobDataset(jobId)).to.equal(datasetId);

      // Verify job buyer is set to alice
      expect(await jobManagerContract.jobBuyer(jobId)).to.equal(signers.alice.address);

      // Verify job is open
      expect(await jobManagerContract.jobOpen(jobId)).to.be.true;

      // Verify next job ID is incremented
      expect(await jobManagerContract.nextJobId()).to.equal(1);
    });

    it("should store different dataset IDs for different jobs", async () => {
      // Open first job with dataset 1
      const jobParams1 = createDefaultJobParams();

      await jobManagerContract.openJob(1, signers.deployer.address, jobParams1);
      expect(await jobManagerContract.jobDataset(0)).to.equal(1);

      // Open second job with dataset 2
      await jobManagerContract.openJob(2, signers.deployer.address, jobParams1);
      expect(await jobManagerContract.jobDataset(1)).to.equal(2);
    });

    it("should reject openJob for non-existent dataset", async () => {
      const jobParams = createDefaultJobParams();

      // Open job on non-existent dataset
      const nonExistentDatasetId = 999;
      await expect(
        jobManagerContract.connect(signers.alice).openJob(nonExistentDatasetId, signers.alice.address, jobParams),
      ).to.be.revertedWithCustomError(jobManagerContract, "DatasetNotFound");
    });
  });

  describe("pushRow", () => {
    it("should emit RowPushed event when pushing a row", async () => {
      // Create test dataset with proper merkle tree
      const datasetId = 1;
      const testRows = ["0x" + Buffer.from("test_row_data").toString("hex")]; // Convert to hex strings
      const testData = await generateMerkleTreeFromRows(testRows, datasetId);
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      await datasetRegistryContract
        .connect(signers.deployer)
        .commitDataset(datasetId, testRows.length, testData.root, schemaHash);

      // Open a job
      const jobParams = createDefaultJobParams();

      await jobManagerContract.openJob(datasetId, signers.deployer.address, jobParams);
      const jobId = 0;

      // Push a row with valid merkle proof and expect RowPushed event
      const rowData = ethers.toUtf8Bytes("test_row_data");
      const merkleProof = testData.proofs[0];
      const rowIndex = 0;

      await expect(jobManagerContract.pushRow(jobId, rowData, merkleProof, rowIndex))
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    // it("should reject pushRow for non-existent dataset", async () => {
    //   const jobParams = createDefaultJobParams();

    //   // Open job on non-existent dataset
    //   const nonExistentDatasetId = 999;
    //   await jobManagerContract.connect(signers.alice).openJob(nonExistentDatasetId, signers.bob.address, jobParams);
    //   const jobId = 0;

    //   // Try to push row - should fail
    //   const rowIndex = 0;
    //   const rowData = testDataset.rows[rowIndex]; // Now a hex string
    //   const merkleProof = testDataset.proofs[rowIndex];

    //   await expect(
    //     jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
    //   ).to.be.revertedWithCustomError(jobManagerContract, "DatasetNotFound");
    // });

    // it("should ");
    // });
  });

  describe("finalize", () => {
    it("should emit JobFinalized event when finalizing a job", async () => {
      // First create a dataset in registry
      const datasetId = 1;
      const testRows = ["0x" + Buffer.from("test_row_data").toString("hex")]; // Convert to hex strings
      const testData = await generateMerkleTreeFromRows(testRows, datasetId);
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      await datasetRegistryContract
        .connect(signers.deployer)
        .commitDataset(datasetId, testRows.length, testData.root, schemaHash);

      // Open a job
      const jobParams = createDefaultJobParams();

      await jobManagerContract.openJob(datasetId, signers.deployer.address, jobParams);
      const jobId = 0;

      // Finalize the job and expect JobFinalized event
      await expect(jobManagerContract.finalize(jobId))
        .to.emit(jobManagerContract, "JobFinalized")
        .withArgs(jobId, signers.deployer.address);

      // Verify job is closed after finalization
      expect(await jobManagerContract.jobOpen(jobId)).to.be.false;
    });
  });

  // it("should track last use timestamp for cooldown", async () => {
  //   // Open job, finalize it
  //   // Verify _lastUse is updated with block.timestamp
  //   // Open another job on same dataset -> should respect cooldown
  // });
});
