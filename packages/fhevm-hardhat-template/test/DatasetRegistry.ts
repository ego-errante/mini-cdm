import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("DatasetRegistry", function () {
  let signers: Signers;
  let datasetRegistryContract: DatasetRegistry;
  let datasetRegistryContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployFixture());
  });

  it("should deploy the contract", async () => {
    console.log(`DatasetRegistry has been deployed at address ${datasetRegistryContractAddress}`);
    expect(datasetRegistryContract).to.not.be.null;
    expect(datasetRegistryContractAddress).to.not.be.null;
  });

  describe("commitDataset", () => {
    it("should commit new dataset successfully", async () => {
      const datasetId = 1;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      await expect(datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, merkleRoot, schemaHash))
        .to.emit(datasetRegistryContract, "DatasetCommitted")
        .withArgs(datasetId, merkleRoot, schemaHash, signers.alice.address);

      // Verify the dataset was stored correctly
      const [storedRoot, storedSchema, exists] = await datasetRegistryContract.getDataset(datasetId);
      expect(storedRoot).to.equal(merkleRoot);
      expect(storedSchema).to.equal(schemaHash);
      expect(exists).to.be.true;

      // Verify ownership
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.bob.address)).to.be.false;
    });

    it("should update existing dataset when owner commits again", async () => {
      const datasetId = 1;
      const originalRoot = ethers.keccak256(ethers.toUtf8Bytes("original_root"));
      const originalSchema = ethers.keccak256(ethers.toUtf8Bytes("original_schema"));
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));
      const newSchema = ethers.keccak256(ethers.toUtf8Bytes("new_schema"));

      // Initial commit
      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, originalRoot, originalSchema);

      // Update by same owner
      await expect(datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, newRoot, newSchema))
        .to.emit(datasetRegistryContract, "DatasetCommitted")
        .withArgs(datasetId, newRoot, newSchema, signers.alice.address);

      // Verify updated values
      const [storedRoot, storedSchema, exists] = await datasetRegistryContract.getDataset(datasetId);
      expect(storedRoot).to.equal(newRoot);
      expect(storedSchema).to.equal(newSchema);
      expect(exists).to.be.true;
    });

    it("should reject commit with zero merkle root", async () => {
      const datasetId = 1;
      const zeroRoot = ethers.ZeroHash;
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      await expect(
        datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, zeroRoot, schemaHash),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "InvalidMerkleRoot");
    });

    it("should reject commit with zero schema hash", async () => {
      const datasetId = 1;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const zeroSchema = ethers.ZeroHash;

      await expect(
        datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, merkleRoot, zeroSchema),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "InvalidSchemaHash");
    });

    it("should reject update from non-owner", async () => {
      const datasetId = 1;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      // Alice commits first
      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, merkleRoot, schemaHash);

      // Bob tries to update - should fail
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));
      const newSchema = ethers.keccak256(ethers.toUtf8Bytes("new_schema"));

      await expect(
        datasetRegistryContract.connect(signers.bob).commitDataset(datasetId, newRoot, newSchema),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "NotDatasetOwner");
    });

    it("should handle multiple datasets from different providers", async () => {
      // Alice's dataset
      const aliceDatasetId = 1;
      const aliceRoot = ethers.keccak256(ethers.toUtf8Bytes("alice_root"));
      const aliceSchema = ethers.keccak256(ethers.toUtf8Bytes("alice_schema"));

      // Bob's dataset
      const bobDatasetId = 2;
      const bobRoot = ethers.keccak256(ethers.toUtf8Bytes("bob_root"));
      const bobSchema = ethers.keccak256(ethers.toUtf8Bytes("bob_schema"));

      // Both commit their datasets
      await datasetRegistryContract.connect(signers.alice).commitDataset(aliceDatasetId, aliceRoot, aliceSchema);
      await datasetRegistryContract.connect(signers.bob).commitDataset(bobDatasetId, bobRoot, bobSchema);

      // Verify Alice's dataset
      const [aliceStoredRoot, aliceStoredSchema, aliceExists] =
        await datasetRegistryContract.getDataset(aliceDatasetId);
      expect(aliceStoredRoot).to.equal(aliceRoot);
      expect(aliceStoredSchema).to.equal(aliceSchema);
      expect(aliceExists).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(aliceDatasetId, signers.alice.address)).to.be.true;

      // Verify Bob's dataset
      const [bobStoredRoot, bobStoredSchema, bobExists] = await datasetRegistryContract.getDataset(bobDatasetId);
      expect(bobStoredRoot).to.equal(bobRoot);
      expect(bobStoredSchema).to.equal(bobSchema);
      expect(bobExists).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(bobDatasetId, signers.bob.address)).to.be.true;
    });
  });

  describe("getDataset", () => {
    it("should return correct data for existing dataset", async () => {
      const datasetId = 1;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, merkleRoot, schemaHash);

      const [storedRoot, storedSchema, exists] = await datasetRegistryContract.getDataset(datasetId);
      expect(storedRoot).to.equal(merkleRoot);
      expect(storedSchema).to.equal(schemaHash);
      // expect(storedSchema).to.equal(schemaHash);
      expect(exists).to.be.true;
    });

    it("should return zero values for non-existent dataset", async () => {
      const nonExistentId = 999;

      const [storedRoot, storedSchema, exists] = await datasetRegistryContract.getDataset(nonExistentId);
      expect(storedRoot).to.equal(ethers.ZeroHash);
      expect(storedSchema).to.equal(ethers.ZeroHash);
      expect(exists).to.be.false;
    });
  });

  describe("deleteDataset", () => {
    it("should delete dataset successfully", async () => {
      const datasetId = 1;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      // Create dataset
      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, merkleRoot, schemaHash);

      // Verify it exists
      let [storedRoot, storedSchema, exists] = await datasetRegistryContract.getDataset(datasetId);
      expect(exists).to.be.true;

      // Delete it
      await expect(datasetRegistryContract.connect(signers.alice).deleteDataset(datasetId))
        .to.emit(datasetRegistryContract, "DatasetDeleted")
        .withArgs(datasetId, signers.alice.address);

      // Verify it's deleted
      [storedRoot, storedSchema, exists] = await datasetRegistryContract.getDataset(datasetId);
      expect(storedRoot).to.equal(ethers.ZeroHash);
      expect(storedSchema).to.equal(ethers.ZeroHash);
      expect(exists).to.be.false;

      // Verify ownership is cleared
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.false;
    });

    it("should reject delete from non-owner", async () => {
      const datasetId = 1;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      // Alice creates dataset
      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, merkleRoot, schemaHash);

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
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, merkleRoot, schemaHash);

      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.true;
    });

    it("should return false for non-owner", async () => {
      const datasetId = 1;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, merkleRoot, schemaHash);

      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.bob.address)).to.be.false;
    });

    it("should return false for non-existent dataset", async () => {
      const nonExistentId = 999;

      expect(await datasetRegistryContract.isDatasetOwner(nonExistentId, signers.alice.address)).to.be.false;
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
