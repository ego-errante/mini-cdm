import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { RowDecoderTestHelper, RowDecoderTestHelper__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";

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
    // it("should test direct FHE approach first", async () => {
    //   // Test the exact FHECounter approach - create fresh encrypted input every time
    //   const clearValue = 123;
    //   const contractAddress = await decoderTestHelper.getAddress();

    //   console.log("=== DIRECT FHE TEST ===");
    //   console.log("Contract address:", contractAddress);
    //   console.log("Signer address:", signers.alice.address);

    //   const encryptedInput = await fhevm
    //     .createEncryptedInput(contractAddress, signers.alice.address)
    //     .add8(clearValue)
    //     .encrypt();

    //   console.log("Handle:", encryptedInput.handles[0]);
    //   console.log("Proof length:", encryptedInput.inputProof.length);

    //   // Call the direct function that mimics FHECounter exactly - try non-static first
    //   const tx = await decoderTestHelper
    //     .connect(signers.alice)
    //     .testDirectFHE(encryptedInput.handles[0], encryptedInput.inputProof);
    //   await tx.wait();
    //   console.log("Direct FHE test succeeded with transaction");
    // });

    it("should decode a single uint8 field", async () => {
      const contractAddress = await decoderTestHelper.getAddress();
      const rowPacked = await createPackedEncryptedRow(contractAddress, signers.alice, "euint8", 123);

      // Use the same signer that was used to create the encrypted input
      const fields = await decoderTestHelper.connect(signers.alice).decodeRowTo64.staticCall(rowPacked);
      expect(fields.length).to.equal(1);
    });

    it("should decode multiple field types", async () => {
      const contractAddress = await decoderTestHelper.getAddress();

      // Create separate encrypted inputs for different types
      const euint8Input = await fhevm.createEncryptedInput(contractAddress, signers.alice.address).add8(10).encrypt();

      const euint32Input = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add32(2000)
        .encrypt();

      const euint64Input = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(300000n)
        .encrypt();

      // Pack each field individually
      const field1 = await packEncryptedField(1, euint8Input.handles[0], euint8Input.inputProof);
      const field2 = await packEncryptedField(2, euint32Input.handles[0], euint32Input.inputProof);
      const field3 = await packEncryptedField(3, euint64Input.handles[0], euint64Input.inputProof);

      // Combine all fields into one row
      const rowPacked = "0x" + field1 + field2 + field3;

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

    it("should grant permission using decodeRowTo64WithBuyer then buyer should be able to decodeRowTo64 too", async () => {
      // it.only("should grant permission using decodeRowTo64WithBuyer then buyer should be able to decodeRowTo64 too", async () => {
      const contractAddress = await decoderTestHelper.getAddress();

      // Alice (data provider) creates encrypted uint8 data
      const clearValue = 123;
      const encryptedInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add8(clearValue)
        .encrypt();

      // Pack the encrypted data into row format
      const field1 = await packEncryptedField(1, encryptedInput.handles[0], encryptedInput.inputProof);
      const rowPacked = "0x" + field1;

      console.log("=== ACL PERMISSION TEST ===");
      console.log("Alice (provider) address:", signers.alice.address);
      console.log("Bob (buyer) address:", signers.bob.address);

      // Step 1: Alice calls decodeRowTo64WithBuyer, granting permission to Bob and contract
      console.log("Step 1: Alice calls decodeRowTo64WithBuyer...");
      const aliceFields = await decoderTestHelper
        .connect(signers.alice)
        .decodeRowTo64WithBuyer.staticCall(rowPacked, signers.bob.address);
      expect(aliceFields.length).to.equal(1);
      console.log("✓ Alice successfully decoded and granted permissions");

      // Actually execute the transaction to persist the ACL changes
      const tx = await decoderTestHelper.connect(signers.alice).decodeRowTo64WithBuyer(rowPacked, signers.bob.address);
      await tx.wait();
      console.log("✓ ACL permissions persisted");

      // Step 2: Bob should now be able to call decodeRowTo64 with the same data
      // This should work because the contract now has permission from step 1
      console.log("Step 2: Bob calls decodeRowTo64...");
      const bobFields = await decoderTestHelper.connect(signers.bob).decodeRowTo64.staticCall(rowPacked);
      expect(bobFields.length).to.equal(1);
      console.log("✓ Bob successfully decoded using contract's permission");

      console.log("=== ACL PERMISSION TEST PASSED ===");
    });
  });

  describe("Edge cases", () => {
    it("should handle zero-length ext and proof data", async () => {
      // Field with zero-length ext and proof
      const zeroLenField = "01" + "0000" + "" + "0000" + "";
      const rowPacked = "0x" + zeroLenField;

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(1);
    });

    it("should handle maximum reasonable field count", async () => {
      // Create 10 identical uint8 fields
      let rowData = "";
      for (let i = 0; i < 10; i++) {
        rowData += "01" + "0002" + "1234" + "0002" + "5678";
      }
      const rowPacked = "0x" + rowData;

      const fieldCount = await decoderTestHelper.validateRowStructure(rowPacked);
      expect(fieldCount).to.equal(10);
    });

    it("should handle different proof lengths", async () => {
      // Field with longer proof (4 bytes instead of 2)
      const longProofField = "01" + "0002" + "1234" + "0004" + "567890ab";
      const rowPacked = "0x" + longProofField;

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

async function createPackedEncryptedRow(
  contractAddress: string,
  signer: HardhatEthersSigner,
  type: "euint8" | "euint32" | "euint64",
  value: number,
): Promise<string> {
  const input = fhevm.createEncryptedInput(contractAddress, signer.address);

  let typeTag: string;
  switch (type) {
    case "euint8":
      input.add8(value);
      typeTag = "01";
      break;
    case "euint32":
      input.add32(value);
      typeTag = "02";
      break;
    case "euint64":
      input.add64(value);
      typeTag = "03";
      break;
  }

  const { handles, inputProof } = await input.encrypt();
  const extCipher = handles[0];
  const proof = inputProof;

  // Use the raw handle directly (not ABI-encoded)
  const extCipherHex = ethers.hexlify(extCipher);
  const proofHex = ethers.hexlify(proof);

  // console.log("=== TEST: Creating encrypted data ===");
  // console.log("  Raw handle:", extCipherHex);
  // console.log("  Raw handle length:", extCipherHex.length);
  // console.log("  Proof:", proofHex);

  const extCipherBytes = extCipherHex.substring(2);
  const proofBytes = proofHex.substring(2);

  const extLen = (extCipherBytes.length / 2).toString(16).padStart(4, "0");

  const proofLen = (proofBytes.length / 2).toString(16).padStart(4, "0");

  const packed = typeTag + extLen + extCipherBytes + proofLen + proofBytes;
  // console.log("  Packed Row Fragment:", packed);
  // console.log("--------------------------------------");

  return "0x" + packed;
}

async function packEncryptedField(typeTag: number, handle: Uint8Array, proof: Uint8Array): Promise<string> {
  const extCipherHex = ethers.hexlify(handle);
  const proofHex = ethers.hexlify(proof);

  const extCipherBytes = extCipherHex.substring(2);
  const proofBytes = proofHex.substring(2);

  const extLen = (extCipherBytes.length / 2).toString(16).padStart(4, "0");
  const proofLen = (proofBytes.length / 2).toString(16).padStart(4, "0");

  const typeTagHex = typeTag.toString(16).padStart(2, "0");

  return typeTagHex + extLen + extCipherBytes + proofLen + proofBytes;
}
