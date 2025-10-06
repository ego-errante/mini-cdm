import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { getDatasetObject } from "./utils";

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
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;

      await expect(
        datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, merkleRoot, numColumns),
      )
        .to.emit(datasetRegistryContract, "DatasetCommitted")
        .withArgs(datasetId, merkleRoot, numColumns, rowCount, signers.alice.address);

      // Verify the dataset was stored correctly
      const dataset = await getDatasetObject(datasetRegistryContract, datasetId);
      expect(dataset.merkleRoot).to.equal(merkleRoot);
      expect(dataset.numColumns).to.equal(BigInt(numColumns));
      expect(dataset.rowCount).to.equal(BigInt(rowCount));
      expect(dataset.exists).to.be.true;

      // Verify ownership
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.bob.address)).to.be.false;
    });

    it("should update existing dataset when owner commits again", async () => {
      const datasetId = 1;
      const originalRowCount = 500;
      const originalRoot = ethers.keccak256(ethers.toUtf8Bytes("original_root"));
      const originalSchema = 2;
      const newRowCount = 750;
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));
      const newSchema = 4;

      // Initial commit
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(datasetId, originalRowCount, originalRoot, originalSchema);

      // Update by same owner
      await expect(
        datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, newRowCount, newRoot, newSchema),
      )
        .to.emit(datasetRegistryContract, "DatasetCommitted")
        .withArgs(datasetId, newRoot, newSchema, newRowCount, signers.alice.address);

      // Verify updated values
      const dataset = await getDatasetObject(datasetRegistryContract, datasetId);
      expect(dataset.merkleRoot).to.equal(newRoot);
      expect(dataset.numColumns).to.equal(BigInt(newSchema));
      expect(dataset.rowCount).to.equal(BigInt(newRowCount));
      expect(dataset.exists).to.be.true;
    });

    it("should reject commit with zero merkle root", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const zeroRoot = ethers.ZeroHash;
      const numColumns = 3;

      await expect(
        datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, zeroRoot, numColumns),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "InvalidMerkleRoot");
    });

    it("should reject commit with zero num columns", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const zeroColumns = 0;

      await expect(
        datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, merkleRoot, zeroColumns),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "InvalidNumColumns");
    });

    it("should reject update from non-owner", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;

      // Alice commits first
      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, merkleRoot, numColumns);

      // Bob tries to update - should fail
      const newRowCount = 1500;
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));
      const newSchema = 5;

      await expect(
        datasetRegistryContract.connect(signers.bob).commitDataset(datasetId, newRowCount, newRoot, newSchema),
      ).to.be.revertedWithCustomError(datasetRegistryContract, "NotDatasetOwner");
    });

    it("should handle multiple datasets from different providers", async () => {
      // Alice's dataset
      const aliceDatasetId = 1;
      const aliceRowCount = 1000;
      const aliceRoot = ethers.keccak256(ethers.toUtf8Bytes("alice_root"));
      const aliceSchema = 3;

      // Bob's dataset
      const bobDatasetId = 2;
      const bobRowCount = 2000;
      const bobRoot = ethers.keccak256(ethers.toUtf8Bytes("bob_root"));
      const bobSchema = 4;

      // Both commit their datasets
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(aliceDatasetId, aliceRowCount, aliceRoot, aliceSchema);
      await datasetRegistryContract.connect(signers.bob).commitDataset(bobDatasetId, bobRowCount, bobRoot, bobSchema);

      // Verify Alice's dataset
      const aliceDataset = await getDatasetObject(datasetRegistryContract, aliceDatasetId);
      expect(aliceDataset.merkleRoot).to.equal(aliceRoot);
      expect(aliceDataset.numColumns).to.equal(BigInt(aliceSchema));
      expect(aliceDataset.rowCount).to.equal(BigInt(aliceRowCount));
      expect(aliceDataset.exists).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(aliceDatasetId, signers.alice.address)).to.be.true;

      // Verify Bob's dataset
      const bobDataset = await getDatasetObject(datasetRegistryContract, bobDatasetId);
      expect(bobDataset.merkleRoot).to.equal(bobRoot);
      expect(bobDataset.numColumns).to.equal(BigInt(bobSchema));
      expect(bobDataset.rowCount).to.equal(BigInt(bobRowCount));
      expect(bobDataset.exists).to.be.true;
      expect(await datasetRegistryContract.isDatasetOwner(bobDatasetId, signers.bob.address)).to.be.true;
    });
  });

  describe("getDataset", () => {
    it("should return correct data for existing dataset", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;

      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, merkleRoot, numColumns);

      const dataset = await getDatasetObject(datasetRegistryContract, datasetId);
      expect(dataset.merkleRoot).to.equal(merkleRoot);
      expect(dataset.numColumns).to.equal(BigInt(numColumns));
      expect(dataset.rowCount).to.equal(BigInt(rowCount));
      expect(dataset.exists).to.be.true;
    });

    it("should return zero values for non-existent dataset", async () => {
      const nonExistentId = 999;

      const dataset = await getDatasetObject(datasetRegistryContract, nonExistentId);
      expect(dataset.merkleRoot).to.equal(ethers.ZeroHash);
      expect(dataset.rowCount).to.equal(BigInt(0));
      expect(dataset.numColumns).to.equal(BigInt(0));
      expect(dataset.exists).to.be.false;
    });
  });

  describe("deleteDataset", () => {
    it("should delete dataset successfully", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;

      // Create dataset
      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, merkleRoot, numColumns);

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
      expect(dataset.exists).to.be.false;

      // Verify ownership is cleared
      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.false;
    });

    it("should reject delete from non-owner", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;

      // Alice creates dataset
      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, merkleRoot, numColumns);

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

      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, merkleRoot, numColumns);

      expect(await datasetRegistryContract.isDatasetOwner(datasetId, signers.alice.address)).to.be.true;
    });

    it("should return false for non-owner", async () => {
      const datasetId = 1;
      const rowCount = 1000;
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
      const numColumns = 3;

      await datasetRegistryContract.connect(signers.alice).commitDataset(datasetId, rowCount, merkleRoot, numColumns);

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
