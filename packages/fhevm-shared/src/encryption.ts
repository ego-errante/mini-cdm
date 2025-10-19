/**
 * Encryption utilities for FHEVM dataset processing
 * Adapted from test/RowDecoder.ts
 */

import { ethers } from "ethers";

export interface ColumnConfig {
  type: "euint8" | "euint16" | "euint32" | "euint64";
  value: number;
}

/**
 * Auto-detect euint type based on value range
 */
export function detectEuintType(
  value: number
): "euint8" | "euint16" | "euint32" | "euint64" {
  const numValue = Number(value);
  if (numValue >= 0 && numValue <= 255) return "euint8";
  if (numValue >= 0 && numValue <= 65535) return "euint16";
  if (numValue >= 0 && numValue <= 4294967295) return "euint32";
  return "euint64";
}

/**
 * Convert row data to column configs with auto-detected types
 */
export function parseRowToColumnConfigs(rowData: any[]): ColumnConfig[] {
  return rowData.map((value) => ({
    type: detectEuintType(value),
    value: Number(value),
  }));
}

/**
 * Create a packed encrypted row from column configs
 * Adapted from RowDecoder.ts:284-300
 */
export async function createPackedEncryptedRow(
  contractAddress: string,
  userAddress: string,
  fhevmInstance: any, // FhevmInstance type
  columns: ColumnConfig[]
): Promise<string> {
  const { handles, inputProof, typeTags } = await encryptValues(
    contractAddress,
    userAddress,
    fhevmInstance,
    columns
  );

  let packed: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    packed.push(
      packEncryptedField(Number(typeTags[i]), handles[i], inputProof)
    );
  }

  return joinPacked(packed);
}

/**
 * Encrypt values using FHEVM instance
 * Adapted from RowDecoder.ts:302-333
 */
async function encryptValues(
  contractAddress: string,
  userAddress: string,
  fhevmInstance: any,
  values: ColumnConfig[]
): Promise<{
  handles: Uint8Array[];
  inputProof: Uint8Array;
  typeTags: string[];
}> {
  const input = fhevmInstance.createEncryptedInput(
    contractAddress,
    userAddress
  );

  const typeTags: string[] = [];
  for (const item of values) {
    switch (item.type) {
      case "euint8":
        input.add8(item.value);
        typeTags.push("01");
        break;
      case "euint16":
        input.add16(item.value);
        typeTags.push("04"); // Type tag for euint16
        break;
      case "euint32":
        input.add32(item.value);
        typeTags.push("02");
        break;
      case "euint64":
        input.add64(item.value);
        typeTags.push("03");
        break;
    }
  }

  const encrypted = await input.encrypt();
  return {
    handles: encrypted.handles,
    inputProof: encrypted.inputProof,
    typeTags,
  };
}

/**
 * Pack encrypted field data with metadata
 * From RowDecoder.ts:339-352
 */
function packEncryptedField(
  typeTag: number,
  handle: Uint8Array,
  proof: Uint8Array
): string {
  const extCipherHex = ethers.hexlify(handle);
  const proofHex = ethers.hexlify(proof);

  const extCipherBytes = extCipherHex.substring(2);
  const proofBytes = proofHex.substring(2);

  const extLen = (extCipherBytes.length / 2).toString(16).padStart(4, "0");
  const proofLen = (proofBytes.length / 2).toString(16).padStart(4, "0");

  const typeTagHex = typeTag.toString(16).padStart(2, "0");

  return typeTagHex + extLen + extCipherBytes + proofLen + proofBytes;
}

/**
 * Join packed field data into a single hex string
 */
function joinPacked(packed: string[]): string {
  return "0x" + packed.join("");
}
