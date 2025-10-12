import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { JobManager } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import {
  getDatasetObject,
  KAnonymityLevels,
  deployJobManagerFixture,
  setupTestDataset,
  createDefaultJobParams,
  OpCodes,
  executeJobAndDecryptResult,
  parseJobFinalizedEvent,
  createAndRegisterDataset,
  RowConfig,
  encryptKAnonymity,
} from "./utils";

describe("DatasetRegistry", function () {
  let signers: Signers;
  let datasetRegistryContract: DatasetRegistry;
  let datasetRegistryContractAddress: string;
  let jobManagerContract: JobManager;
  let jobManagerContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployFixture());
    ({ jobManagerContract, jobManagerContractAddress: jobManagerContractAddress } =
      await deployJobManagerFixture(datasetRegistryContractAddress));

    // Set the JobManager address on the DatasetRegistry so commitDataset can work
    await datasetRegistryContract.connect(signers.deployer).setJobManager(jobManagerContractAddress);
  });

  it("should deploy the contract", async () => {
    console.log(`DatasetRegistry has been deployed at address ${datasetRegistryContractAddress}`);
    expect(datasetRegistryContract).to.not.be.null;
    expect(datasetRegistryContractAddress).to.not.be.null;
  });

  describe("commitDataset", () => {
    it("should reject commit when JobManager is not set", async () => {
      // Deploy a fresh DatasetRegistry without setting JobManager
      const { datasetRegistryContract: freshRegistry, datasetRegistryContractAddress: freshRegistryAddress } =
        await deployFixture();

      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;
      const kAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      // Encrypt kAnonymity for the fresh registry address
      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        freshRegistryAddress,
        signers.alice,
        kAnonymity,
      );

      // Attempt to commit dataset should fail
      const datasetId = 1;
      await expect(
        freshRegistry
          .connect(signers.alice)
          .commitDataset(datasetId, rowCount, merkleRoot, numColumns, encryptedKAnonymity, inputProof, cooldownSec),
      ).to.be.revertedWithCustomError(freshRegistry, "JobManagerNotSet");
    });

    it("should commit new dataset successfully", async () => {
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;

      const kAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        kAnonymity,
      );

      const datasetId = 1;
      const tx = await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(datasetId, rowCount, merkleRoot, numColumns, encryptedKAnonymity, inputProof, cooldownSec);

      const receipt = await tx.wait();
      const datasetCommittedEvent = receipt!.logs
        .map((log) => datasetRegistryContract.interface.parseLog(log))
        .find((e) => e?.name === "DatasetCommitted")!.args;

      // Verify event emitted with correct values (excluding encrypted kAnonymity)
      expect(datasetCommittedEvent[0]).to.equal(datasetId); // datasetId
      expect(datasetCommittedEvent[1]).to.equal(merkleRoot); // merkleRoot
      expect(datasetCommittedEvent[2]).to.equal(BigInt(numColumns)); // numColumns
      expect(datasetCommittedEvent[3]).to.equal(BigInt(rowCount)); // rowCount
      expect(datasetCommittedEvent[4]).to.equal(signers.alice.address); // owner
      expect(datasetCommittedEvent[6]).to.equal(cooldownSec); // cooldownSec
      // Note: kAnonymity (index 5) is encrypted, so we can't check the exact value

      // Verify the dataset was stored correctly
      const dataset = await getDatasetObject(datasetRegistryContract, datasetId);
      expect(dataset.merkleRoot).to.equal(merkleRoot);
      expect(dataset.numColumns).to.equal(BigInt(numColumns));
      expect(dataset.rowCount).to.equal(BigInt(rowCount));
      // Note: kAnonymity is now encrypted, so we can't check the exact value
      expect(dataset.cooldownSec).to.equal(cooldownSec);
      expect(dataset.exists).to.be.true;

      // Verify ownership
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.bob.address)).to.be.false;
    });

    it("should reject commit with zero merkle root", async () => {
      const rowCount = 1000;
      const zeroRoot = ethers.ZeroHash;
      const numColumns = 3;

      const invalidMerkleKAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        invalidMerkleKAnonymity,
      );

      const datasetId = 1;
      await expect(
        datasetRegistryContract
          .connect(signers.alice)
          .commitDataset(datasetId, rowCount, zeroRoot, numColumns, encryptedKAnonymity, inputProof, cooldownSec),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "InvalidMerkleRoot");
    });

    it("should reject commit with zero num columns", async () => {
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const zeroColumns = 0;

      const zeroColumnsKAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        zeroColumnsKAnonymity,
      );

      const datasetId = 1;
      await expect(
        datasetRegistryContract
          .connect(signers.alice)
          .commitDataset(datasetId, rowCount, merkleRoot, zeroColumns, encryptedKAnonymity, inputProof, cooldownSec),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "InvalidNumColumns");
    });

    it("should reject commit with row count exceeding uint64 max", async () => {
      // uint64 max is 2^64 - 1
      const maxUint64RowCount = BigInt(2) ** BigInt(64) - BigInt(1);
      const exceedingRowCount = maxUint64RowCount + 1n;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;

      const kAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        kAnonymity,
      );

      const datasetId = 1;
      // This test should fail because the contract doesn't validate max row count
      // The row count exceeding uint64 max should be rejected to prevent overflow in aggregators
      await expect(
        datasetRegistryContract
          .connect(signers.alice)
          .commitDataset(
            datasetId,
            exceedingRowCount,
            merkleRoot,
            numColumns,
            encryptedKAnonymity,
            inputProof,
            cooldownSec,
          ),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "RowCountExceedsUint64Max");
    });

    it("should handle multiple datasets from different providers", async () => {
      // Alice's dataset
      const aliceRowCount = 1000;
      const aliceRoot = ethers.keccak256(ethers.toUtf8Bytes("alice_root"));
      const aliceSchema = 3;

      // Bob's dataset
      const bobRowCount = 2000;
      const bobRoot = ethers.keccak256(ethers.toUtf8Bytes("bob_root"));
      const bobSchema = 4;

      const aliceKAnonymity = KAnonymityLevels.NONE;
      const bobKAnonymity = KAnonymityLevels.NONE;
      const aliceCooldownSec = 0;
      const bobCooldownSec = 120;

      // Both commit their datasets
      const aliceDatasetId = 1;
      const bobDatasetId = 2;

      const { handle: aliceEncryptedKAnonymity, inputProof: aliceInputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        aliceKAnonymity,
      );
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(
          aliceDatasetId,
          aliceRowCount,
          aliceRoot,
          aliceSchema,
          aliceEncryptedKAnonymity,
          aliceInputProof,
          aliceCooldownSec,
        );

      const { handle: bobEncryptedKAnonymity, inputProof: bobInputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.bob,
        bobKAnonymity,
      );
      await datasetRegistryContract
        .connect(signers.bob)
        .commitDataset(
          bobDatasetId,
          bobRowCount,
          bobRoot,
          bobSchema,
          bobEncryptedKAnonymity,
          bobInputProof,
          bobCooldownSec,
        );

      // Verify Alice's dataset
      const aliceDataset = await getDatasetObject(datasetRegistryContract, aliceDatasetId);
      expect(aliceDataset.merkleRoot).to.equal(aliceRoot);
      expect(aliceDataset.numColumns).to.equal(BigInt(aliceSchema));
      expect(aliceDataset.rowCount).to.equal(BigInt(aliceRowCount));
      // Note: kAnonymity is now encrypted, so we can't check the exact value
      expect(aliceDataset.cooldownSec).to.equal(aliceCooldownSec);
      expect(aliceDataset.exists).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(aliceDatasetId, signers.alice.address)).to.be.true;

      // Verify Bob's dataset
      const bobDataset = await getDatasetObject(datasetRegistryContract, bobDatasetId);
      expect(bobDataset.merkleRoot).to.equal(bobRoot);
      expect(bobDataset.numColumns).to.equal(BigInt(bobSchema));
      expect(bobDataset.rowCount).to.equal(BigInt(bobRowCount));
      // Note: kAnonymity is now encrypted, so we can't check the exact value
      expect(bobDataset.cooldownSec).to.equal(bobCooldownSec);
      expect(bobDataset.exists).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(bobDatasetId, signers.bob.address)).to.be.true;
    });

    it("should accept external dataset IDs", async () => {
      const rowCount = 1000;
      const numColumns = 3;
      const kAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      // Commit first dataset with ID 10
      const datasetId1 = 10;
      const { handle: encryptedKAnonymity1, inputProof: inputProof1 } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        kAnonymity,
      );
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(
          datasetId1,
          rowCount,
          ethers.keccak256(ethers.toUtf8Bytes("root1")),
          numColumns,
          encryptedKAnonymity1,
          inputProof1,
          cooldownSec,
        );

      // Commit second dataset with ID 42
      const datasetId2 = 42;
      const { handle: encryptedKAnonymity2, inputProof: inputProof2 } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        kAnonymity,
      );
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(
          datasetId2,
          rowCount,
          ethers.keccak256(ethers.toUtf8Bytes("root2")),
          numColumns,
          encryptedKAnonymity2,
          inputProof2,
          cooldownSec,
        );

      // Commit third dataset with ID 100
      const datasetId3 = 100;
      const { handle: encryptedKAnonymity3, inputProof: inputProof3 } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        kAnonymity,
      );
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(
          datasetId3,
          rowCount,
          ethers.keccak256(ethers.toUtf8Bytes("root3")),
          numColumns,
          encryptedKAnonymity3,
          inputProof3,
          cooldownSec,
        );

      // Verify IDs are as specified
      expect(await datasetRegistryContract.doesDatasetExist(datasetId1)).to.be.true;
      expect(await datasetRegistryContract.doesDatasetExist(datasetId2)).to.be.true;
      expect(await datasetRegistryContract.doesDatasetExist(datasetId3)).to.be.true;
    });
  });

  describe("getDataset", () => {
    it("should return correct data for existing dataset", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;
      const datasetKAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        datasetKAnonymity,
      );

      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(datasetId, rowCount, merkleRoot, numColumns, encryptedKAnonymity, inputProof, cooldownSec);

      const dataset = await getDatasetObject(datasetRegistryContract, datasetId);
      expect(dataset.merkleRoot).to.equal(merkleRoot);
      expect(dataset.numColumns).to.equal(BigInt(numColumns));
      expect(dataset.rowCount).to.equal(BigInt(rowCount));
      // Note: kAnonymity is now encrypted, so we can't check the exact value
      expect(dataset.cooldownSec).to.equal(cooldownSec);
      expect(dataset.exists).to.be.true;
    });

    it("should return zero values for non-existent dataset", async () => {
      const nonExistentId = 999;

      const dataset = await getDatasetObject(datasetRegistryContract, nonExistentId);
      expect(dataset.merkleRoot).to.equal(ethers.ZeroHash);
      expect(dataset.rowCount).to.equal(BigInt(0));
      expect(dataset.numColumns).to.equal(BigInt(0));
      // Note: kAnonymity for non-existent datasets may not be 0 due to encryption
      expect(dataset.cooldownSec).to.equal(0);
      expect(dataset.exists).to.be.false;
    });
  });

  describe("deleteDataset", () => {
    it("should delete dataset successfully", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;
      const datasetKAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      // Create dataset
      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        datasetKAnonymity,
      );
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(datasetId, rowCount, merkleRoot, numColumns, encryptedKAnonymity, inputProof, cooldownSec);

      // Verify it exists
      let dataset = await getDatasetObject(datasetRegistryContract, datasetId);
      expect(dataset.exists).to.be.true;

      // Delete it
      await expect(datasetRegistryContract.connect(signers.alice).deleteDataset(datasetId))
        .to.emit(datasetRegistryContract, "DatasetDeleted")
        .withArgs(datasetId, signers.alice.address);

      // Verify it's deleted
      dataset = await getDatasetObject(datasetRegistryContract, datasetId);
      expect(dataset.merkleRoot).to.equal(ethers.ZeroHash);
      expect(dataset.numColumns).to.equal(BigInt(0));
      expect(dataset.rowCount).to.equal(BigInt(0));
      // Note: kAnonymity for deleted datasets may not be 0 due to encryption
      expect(dataset.cooldownSec).to.equal(0);
      expect(dataset.exists).to.be.false;

      // Verify ownership is cleared
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.false;
    });

    it("should reject delete from non-owner", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;
      const datasetKAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      // Alice creates dataset
      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        datasetKAnonymity,
      );
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(datasetId, rowCount, merkleRoot, numColumns, encryptedKAnonymity, inputProof, cooldownSec);

      // Bob tries to delete - should fail
      await expect(datasetRegistryContract.connect(signers.bob).deleteDataset(datasetId)).to.be.revertedWithCustomError(
        datasetRegistryContract,
        "NotDatasetOwner",
      );
    });

    it("should reject delete of non-existent dataset", async () => {
      const nonExistentId = 999;

      await expect(
        datasetRegistryContract.connect(signers.alice).deleteDataset(nonExistentId),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "DatasetNotFound");
    });
  });

  describe("isDatasetOwner", () => {
    it("should return true for dataset owner", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;
      const datasetKAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        datasetKAnonymity,
      );

      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(datasetId, rowCount, merkleRoot, numColumns, encryptedKAnonymity, inputProof, cooldownSec);

      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.true;
    });

    it("should return false for non-owner", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;
      const datasetKAnonymity = KAnonymityLevels.NONE;
      const cooldownSec = 0;

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        datasetKAnonymity,
      );

      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(datasetId, rowCount, merkleRoot, numColumns, encryptedKAnonymity, inputProof, cooldownSec);

      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.bob.address)).to.be.false;
    });

    it("should return false for non-existent dataset", async () => {
      const nonExistentId = 999;

      expect(await datasetRegistryContract.isDatasetOwner(nonExistentId, signers.alice.address)).to.be.false;
    });
  });

  describe("k-anonymity access", () => {
    it("should grant access to kAnonymity value during job finalization", async () => {
      // Create a test dataset with specific kAnonymity level
      const datasetId = 1;
      const kAnonymity = KAnonymityLevels.MINIMAL;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      const rowConfigs: RowConfig[][] = [
        [{ type: "euint32", value: 10 }],
        [{ type: "euint32", value: 20 }],
        [{ type: "euint32", value: 30 }],
        [{ type: "euint32", value: 40 }],
      ];

      const testDataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
        kAnonymity,
      );

      // Run a simple COUNT job to completion
      const jobParams = {
        ...createDefaultJobParams(),
        op: OpCodes.COUNT,
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      // Execute the job - this should succeed and grant access to kAnonymity
      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        testDataset,
        jobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Verify the job completed successfully
      expect(decryptedResult).to.equal(BigInt(testDataset.rows.length));

      // TODO: Once kAnonymity access is implemented, verify we can decrypt kAnonymity
      // const dataset = await getDatasetObject(datasetRegistryContract, testDataset.id);
      // const decryptedKAnonymity = await fhevm.userDecryptEuint(
      //   FhevmType.euint32,
      //   dataset.kAnonymity,
      //   datasetRegistryContractAddress,
      //   signers.bob, // job buyer should have access
      // );
      // expect(decryptedKAnonymity).to.equal(BigInt(kAnonymity));
    });
  });

  describe("setJobManager", () => {
    it("should reject setJobManager from non-owner", async () => {
      const fakeJobManagerAddress = "0x1234567890123456789012345678901234567890";

      await expect(
        datasetRegistryContract.connect(signers.alice).setJobManager(fakeJobManagerAddress),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "OwnableUnauthorizedAccount");
    });

    it("should allow owner to set JobManager", async () => {
      const newJobManagerAddress = "0x1234567890123456789012345678901234567890";

      // Set JobManager as owner
      await expect(datasetRegistryContract.connect(signers.deployer).setJobManager(newJobManagerAddress))
        .to.emit(datasetRegistryContract, "JobManagerSet")
        .withArgs(newJobManagerAddress);

      // Verify it was set correctly
      expect(await datasetRegistryContract.getJobManager()).to.equal(newJobManagerAddress);

      // Reset back to original JobManager for other tests
      await datasetRegistryContract.connect(signers.deployer).setJobManager(jobManagerContractAddress);
      expect(await datasetRegistryContract.getJobManager()).to.equal(jobManagerContractAddress);
    });

    it("should reject setting zero address as JobManager", async () => {
      await expect(
        datasetRegistryContract.connect(signers.deployer).setJobManager(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "InvalidJobManagerAddress");
    });
  });
});

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("DatasetRegistry")) as DatasetRegistry__factory;
  const datasetRegistryContract = (await factory.deploy()) as DatasetRegistry;
  const datasetRegistryContractAddress = await datasetRegistryContract.getAddress();

  return { datasetRegistryContract, datasetRegistryContractAddress };
}
