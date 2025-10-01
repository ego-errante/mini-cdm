import { IJobManager, IJobManager__factory, JobManager, JobManager__factory } from "../types";
import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("JobManager", function () {
  let signers: Signers;
  let jobManagerContract: JobManager;
  let jobManagerContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    // Deploy a new instance of the contract before each test
    ({ jobManagerContract, jobManagerContractAddress } = await deployFixture());
  });

  it("should deploy the contract", async () => {
    console.log(`JobManager has been deployed at address ${jobManagerContractAddress}`);

    expect(jobManagerContract).to.not.be.null;
    expect(jobManagerContractAddress).to.not.be.null;
  });

  describe("openJob", () => {
    it("should open a job", async () => {
      const datasetId = 1;
      const jobParams = {
        op: JobOperations.SUM,
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
          bytecode: "0x", // Empty bytes instead of []
          consts: [],
        },
      };

      // Open the job and expect the JobOpened event to be emitted
      await expect(jobManagerContract.openJob(datasetId, jobParams))
        .to.emit(jobManagerContract, "JobOpened")
        .withArgs(0, datasetId, signers.deployer.address); // jobId should be 0 for first job

      const jobId = 0; // First job should have ID 0

      // Verify the job was properly created
      expect(await jobManagerContract.jobBuyer(jobId)).to.equal(signers.deployer.address);
      expect(await jobManagerContract.jobOpen(jobId)).to.be.true;
      expect(await jobManagerContract.nextJobId()).to.equal(1); // Should be incremented to 1
    });

    it("should initialize job state with zero values after openJob", async () => {
      const datasetId = 1;
      const jobParams = {
        op: JobOperations.SUM,
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
          bytecode: "0x", // Empty bytes instead of []
          consts: [],
        },
      };

      await jobManagerContract.connect(signers.alice).openJob(datasetId, jobParams);
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
      const jobParams1 = {
        op: JobOperations.SUM,
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

      await jobManagerContract.openJob(1, jobParams1);
      expect(await jobManagerContract.jobDataset(0)).to.equal(1);

      // Open second job with dataset 2
      await jobManagerContract.openJob(2, jobParams1);
      expect(await jobManagerContract.jobDataset(1)).to.equal(2);
    });

    // it("should track last use timestamp for cooldown", async () => {
    //   // Open job, finalize it
    //   // Verify _lastUse is updated with block.timestamp
    //   // Open another job on same dataset -> should respect cooldown
    // });
  });

  describe("pushRow", () => {
    it("should emit RowPushed event when pushing a row", async () => {
      // Create test dataset with proper merkle tree
      const datasetId = 1;
      const testRows = [ethers.toUtf8Bytes("test_row_data")];
      const testData = generateTestMerkleData(testRows, datasetId);
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      // Get the DatasetRegistry from JobManager
      const datasetRegistryAddress = await jobManagerContract.datasetRegistry();
      const datasetRegistryFactory = (await ethers.getContractFactory("DatasetRegistry")) as DatasetRegistry__factory;
      const datasetRegistry = datasetRegistryFactory.attach(datasetRegistryAddress) as DatasetRegistry;

      await datasetRegistry
        .connect(signers.deployer)
        .commitDataset(datasetId, testRows.length, testData.root, schemaHash);

      // Open a job
      const jobParams = {
        op: JobOperations.SUM,
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

      await jobManagerContract.openJob(datasetId, jobParams);
      const jobId = 0;

      // Push a row with valid merkle proof and expect RowPushed event
      const rowData = testRows[0];
      const merkleProof = testData.proofs[0];
      const rowIndex = 0;

      await expect(jobManagerContract.pushRow(jobId, rowData, merkleProof, rowIndex))
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    it("should ");
  });

  describe("finalize", () => {
    it("should emit JobFinalized event when finalizing a job", async () => {
      // First create a dataset in registry
      const datasetId = 1;
      const testRows = [ethers.toUtf8Bytes("test_row_data")];
      const testData = generateTestMerkleData(testRows, datasetId);
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      // Get the DatasetRegistry from JobManager
      const datasetRegistryAddress = await jobManagerContract.datasetRegistry();
      const datasetRegistryFactory = (await ethers.getContractFactory("DatasetRegistry")) as DatasetRegistry__factory;
      const datasetRegistry = datasetRegistryFactory.attach(datasetRegistryAddress) as DatasetRegistry;

      await datasetRegistry
        .connect(signers.deployer)
        .commitDataset(datasetId, testRows.length, testData.root, schemaHash);

      // Open a job
      const jobParams = {
        op: JobOperations.SUM,
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

      await jobManagerContract.openJob(datasetId, jobParams);
      const jobId = 0;

      // Finalize the job and expect JobFinalized event
      await expect(jobManagerContract.finalize(jobId))
        .to.emit(jobManagerContract, "JobFinalized")
        .withArgs(jobId, signers.deployer.address);

      // Verify job is closed after finalization
      expect(await jobManagerContract.jobOpen(jobId)).to.be.false;
    });
  });

  // describe("Step 2: Row Format + Decoder", () => {
  //   // NOTE: Using temporary test helper function 'testDecodeRowTo64'
  //   // TODO: Remove this test helper once we implement pushRow with filtering
  //   // Then test decoder indirectly through pushRow functionality
  //   it("should decode a row with single uint8 field", async () => {
  //     // TODO: This test uses a temporary public test helper
  //     // Future: Test indirectly through pushRow once filtering is implemented
  //     // Test decoding a row with one uint8 field
  //     // This requires creating proper FHE encrypted data which is complex in unit tests
  //     // For now, test the decoder structure validation

  //     // Create a minimal valid row structure (without real encryption)
  //     // Format: [typeTag:1][extLen:0x0002][extCipher:2bytes][proofLen:0x0002][proof:2bytes]
  //     const typeTag = "0x01"; // uint8
  //     const extLen = "0x0002"; // 2 bytes
  //     const extCipher = "0x1234"; // dummy 2 bytes
  //     const proofLen = "0x0002"; // 2 bytes
  //     const proof = "0x5678"; // dummy 2 bytes

  //     const rowPacked = typeTag + extLen.slice(2) + extCipher.slice(2) + proofLen.slice(2) + proof.slice(2);

  //     // This will fail with real FHE operations, but tests the structure parsing
  //     // In real FHE environment, we'd have proper encrypted data
  //     await expect(jobManagerContract.testDecodeRowTo64(rowPacked)).to.not.be.reverted;
  //   });

  //   it("should decode a row with multiple field types", async () => {
  //     // Test row with uint8, uint32, uint64 fields
  //     // This is a structure validation test

  //     // Field 1: uint8
  //     const field1 = "0x01" + "0002" + "1234" + "0002" + "5678";
  //     // Field 2: uint32
  //     const field2 = "0x02" + "0004" + "12345678" + "0002" + "9abc";
  //     // Field 3: uint64
  //     const field3 = "0x03" + "0008" + "1234567890abcdef" + "0002" + "fedc";

  //     const rowPacked = field1 + field2 + field3;

  //     // Should parse 3 fields without reverting on structure
  //     const fieldCount = await jobManagerContract.testDecodeRowTo64(rowPacked);
  //     expect(fieldCount).to.equal(3);
  //   });

  //   it("should reject malformed row data", async () => {
  //     // Test various malformed inputs

  //     // Empty row
  //     await expect(jobManagerContract.testDecodeRowTo64("0x")).to.be.revertedWith("Incomplete type tag");

  //     // Incomplete type tag
  //     await expect(jobManagerContract.testDecodeRowTo64("0x0")).to.be.revertedWith("Incomplete type tag");

  //     // Invalid type tag
  //     await expect(jobManagerContract.testDecodeRowTo64("0x040002123400025678")).to.be.revertedWith("Invalid type tag");

  //     // Incomplete ext length
  //     await expect(jobManagerContract.testDecodeRowTo64("0x010")).to.be.revertedWith("Incomplete ext length");

  //     // Incomplete proof length
  //     await expect(jobManagerContract.testDecodeRowTo64("0x0100021234")).to.be.revertedWith("Incomplete proof length");

  //     // Extra data at end
  //     await expect(jobManagerContract.testDecodeRowTo64("0x01000212340002567800")).to.be.revertedWith(
  //       "Extra data in row",
  //     );
  //   });

  //   it("should handle edge cases", async () => {
  //     // Test maximum reasonable field count (schema-dependent)
  //     // Test zero-length ext/proof (edge case)
  //     const zeroLenField = "0x01" + "0000" + "" + "0000" + "";
  //     const fieldCount = await jobManagerContract.testDecodeRowTo64(zeroLenField);
  //     expect(fieldCount).to.equal(1);
  //   });
  // });
});

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  // Deploy DatasetRegistry first
  const datasetRegistryFactory = (await ethers.getContractFactory("DatasetRegistry")) as DatasetRegistry__factory;
  const datasetRegistryContract = (await datasetRegistryFactory.deploy()) as DatasetRegistry;
  const datasetRegistryAddress = await datasetRegistryContract.getAddress();

  // Deploy JobManager with DatasetRegistry address
  const jobManagerFactory = (await ethers.getContractFactory("JobManager")) as JobManager__factory;
  const jobManagerContract = (await jobManagerFactory.deploy(datasetRegistryAddress)) as JobManager;
  const jobManagerContractAddress = await jobManagerContract.getAddress();

  return { jobManagerContract, jobManagerContractAddress };
}

// Define enum mapping
const JobOperations = {
  WEIGHTED_SUM: 0,
  SUM: 1,
  AVG_P: 2,
  COUNT: 3,
  MIN: 4,
  MAX: 5,
} as const;

// Merkle tree generation utility for tests
function generateTestMerkleData(rows: Uint8Array[], datasetId: number) {
  // Handle single row case (leaf is also root)
  if (rows.length === 1) {
    const leaf = ethers.keccak256(ethers.solidityPacked(["uint256", "uint256", "bytes"], [datasetId, 0, rows[0]]));

    return {
      root: leaf,
      proofs: [[]], // Empty proof for single-leaf tree
    };
  }

  // Generate leaf hashes for multiple rows
  const leaves = rows.map((row, index) =>
    ethers.keccak256(ethers.solidityPacked(["uint256", "uint256", "bytes"], [datasetId, index, row])),
  );

  // Build simple merkle tree (for 4 leaves max in tests)
  if (rows.length === 4) {
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

  throw new Error("Unsupported number of rows for test merkle generation");
}
