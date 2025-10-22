import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { RowDecoderTestHelper, RowDecoderTestHelper__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { packEncryptedField, joinPacked, createPackedEncryptedRow, encryptValues } from "@fhevm/shared";
import { createPackedEncryptedTable } from "./utils";

describe("RowDecoder Library", function () {
  let signers: Signers;
  let decoderTestHelper: RowDecoderTestHelper;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    ({ decoderTestHelper } = await deployFixture());
  });

  describe("validateRowStructure", () => {
    it("should validate a single uint8 field structure", async () => {
      // Format: [typeTag:1][extLen:0x0002][extCipher:2bytes][proofLen:0x0002][proof:2bytes]
      const typeTag = "01"; // uint8
      const extLen = "0002"; // 2 bytes
      const extCipher = "1234"; // dummy 2 bytes
      const proofLen = "0002"; // 2 bytes
      const proof = "5678"; // dummy 2 bytes

      const rowPacked = "0x" + typeTag + extLen + extCipher + proofLen + proof;

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(1);
    });

    it("should validate a single uint32 field structure", async () => {
      // Format: [typeTag:2][extLen:0x0004][extCipher:4bytes][proofLen:0x0002][proof:2bytes]
      const typeTag = "02"; // uint32
      const extLen = "0004"; // 4 bytes
      const extCipher = "12345678"; // dummy 4 bytes
      const proofLen = "0002"; // 2 bytes
      const proof = "9abc"; // dummy 2 bytes

      const rowPacked = "0x" + typeTag + extLen + extCipher + proofLen + proof;

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(1);
    });

    it("should validate a single uint64 field structure", async () => {
      // Format: [typeTag:3][extLen:0x0008][extCipher:8bytes][proofLen:0x0002][proof:2bytes]
      const typeTag = "03"; // uint64
      const extLen = "0008"; // 8 bytes
      const extCipher = "1234567890abcdef"; // dummy 8 bytes
      const proofLen = "0002"; // 2 bytes
      const proof = "fedc"; // dummy 2 bytes

      const rowPacked = "0x" + typeTag + extLen + extCipher + proofLen + proof;

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(1);
    });

    it("should validate multiple field structures", async () => {
      // Field 1: uint8
      const field1 = "01" + "0002" + "1234" + "0002" + "5678";
      // Field 2: uint32
      const field2 = "02" + "0004" + "12345678" + "0002" + "9abc";
      // Field 3: uint64
      const field3 = "03" + "0008" + "1234567890abcdef" + "0002" + "fedc";

      const rowPacked = "0x" + field1 + field2 + field3;

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(3);
    });

    it("should handle empty data", async () => {
      // Empty data should return 0 fields (no revert)
      const fieldCount = await decoderTestHelper.validateRowStructure("0x");
      expect(fieldCount).to.equal(0);
    });

    it("should reject invalid type tag", async () => {
      // typeTag = 0 (invalid)
      const invalidTypeTag = "00" + "0002" + "1234" + "0002" + "5678";
      await expect(decoderTestHelper.validateRowStructure("0x" + invalidTypeTag)).to.be.revertedWith(
        "Invalid type tag",
      );
    });

    it("should reject invalid type tag", async () => {
      // typeTag = 0 (invalid)
      const invalidTypeTag = "00" + "0002" + "1234" + "0002" + "5678";
      await expect(decoderTestHelper.validateRowStructure("0x" + invalidTypeTag)).to.be.revertedWith(
        "Invalid type tag",
      );

      // typeTag = 4 (invalid)
      const invalidTypeTag2 = "04" + "0002" + "1234" + "0002" + "5678";
      await expect(decoderTestHelper.validateRowStructure("0x" + invalidTypeTag2)).to.be.revertedWith(
        "Invalid type tag",
      );
    });

    it("should reject incomplete ext length", async () => {
      // Valid type tag but incomplete ext length
      const incompleteExtLen = "01" + "00"; // Missing second byte of extLen
      await expect(decoderTestHelper.validateRowStructure("0x" + incompleteExtLen)).to.be.revertedWith(
        "Incomplete ext length",
      );
    });

    it("should reject incomplete proof length", async () => {
      // Valid type tag, extLen, extCipher but incomplete proof length
      const incompleteProofLen = "01" + "0002" + "1234" + "00"; // Missing second byte of proofLen
      await expect(decoderTestHelper.validateRowStructure("0x" + incompleteProofLen)).to.be.revertedWith(
        "Incomplete proof length",
      );
    });

    it("should reject extra data at end", async () => {
      // Valid field structure with extra data that gets interpreted as invalid type tag
      const validField = "01" + "0002" + "1234" + "0002" + "5678";
      const extraData = "ff"; // Extra byte (255 = invalid type tag)
      await expect(decoderTestHelper.validateRowStructure("0x" + validField + extraData)).to.be.revertedWith(
        "Invalid type tag",
      );
    });
  });

  describe("getFieldCount", () => {
    it("should return correct field count for single field", async () => {
      const singleField = "0x" + "01" + "0002" + "1234" + "0002" + "5678";
      const fieldCount = await decoderTestHelper.getFieldCount(singleField);
      expect(fieldCount).to.equal(1);
    });

    it("should return correct field count for multiple fields", async () => {
      // Three fields: uint8, uint32, uint64
      const threeFields =
        "0x" +
        "01" +
        "0002" +
        "1234" +
        "0002" +
        "5678" + // uint8
        "02" +
        "0004" +
        "12345678" +
        "0002" +
        "9abc" + // uint32
        "03" +
        "0008" +
        "1234567890abcdef" +
        "0002" +
        "fedc"; // uint64

      const fieldCount = await decoderTestHelper.getFieldCount(threeFields);
      expect(fieldCount).to.equal(3);
    });

    it("should handle empty data", async () => {
      // Empty data should return 0 fields
      const fieldCount = await decoderTestHelper.getFieldCount("0x");
      expect(fieldCount).to.equal(0);
    });
  });

  describe("decodeRowTo64", () => {
    it("should decode a single uint8 field", async () => {
      const contractAddress = await decoderTestHelper.getAddress();
      const rowPacked = await createPackedEncryptedRow(contractAddress, signers.alice.address, fhevm, [
        { type: "euint8", value: 123 },
      ]);

      // Use the same signer that was used to create the encrypted input
      const fields = await decoderTestHelper.connect(signers.alice).decodeRowTo64.staticCall(rowPacked);
      expect(fields.length).to.equal(1);
    });

    it("should decode multiple field types", async () => {
      const contractAddress = await decoderTestHelper.getAddress();

      const table = await createPackedEncryptedTable(
        contractAddress,
        signers.alice,
        [
          { type: "euint8", value: 10 },
          { type: "euint32", value: 2000 },
          { type: "euint64", value: 300000 },
        ],
        3,
      );

      const rowPacked = table[0];
      const fields = await decoderTestHelper.connect(signers.alice).decodeRowTo64.staticCall(rowPacked);
      expect(fields.length).to.equal(3);
    });

    it("should handle empty data in decodeRowTo64", async () => {
      // Empty data should return an empty array (no revert)
      const fields = await decoderTestHelper.decodeRowTo64.staticCall("0x");
      expect(fields.length).to.equal(0);
    });

    it("should reject malformed row data in decodeRowTo64", async () => {
      // Test malformed inputs
      await expect(decoderTestHelper.decodeRowTo64("0x0100")).to.be.revertedWith("Incomplete ext length");
    });
  });

  describe("Edge cases", () => {
    it("should handle zero-length ext and proof data", async () => {
      // Field with zero-length ext and proof
      const zeroLenField = "01" + "0000" + "" + "0000" + "";
      const rowPacked = joinPacked([zeroLenField]);

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(1);
    });

    it("should handle maximum reasonable field count", async () => {
      // Create 10 identical uint8 fields
      let rowData: string[] = [];
      for (let i = 0; i < 10; i++) {
        rowData.push("01" + "0002" + "1234" + "0002" + "5678");
      }
      const rowPacked = joinPacked(rowData);

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(10);
    });

    it("should handle different proof lengths", async () => {
      // Field with longer proof (4 bytes instead of 2)
      const longProofField = "01" + "0002" + "1234" + "0004" + "567890ab";
      const rowPacked = joinPacked([longProofField]);

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(1);
    });
  });
});

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  // Deploy a test helper contract that uses the RowDecoder library
  const factory = (await ethers.getContractFactory("RowDecoderTestHelper")) as RowDecoderTestHelper__factory;
  const decoderTestHelper = (await factory.deploy()) as RowDecoderTestHelper;

  return { decoderTestHelper };
}

// Note: joinPacked and packEncryptedField are now imported from @fhevm/shared
