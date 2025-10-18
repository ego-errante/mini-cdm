/**
 * Shared types for FHEVM packages
 */

/**
 * Supported encrypted data types in FHEVM
 */
export type EncryptedType =
  | "euint8"
  | "euint16"
  | "euint32"
  | "euint64"
  | "euint128"
  | "euint256"
  | "ebool"
  | "eaddress";

/**
 * Configuration for a single encrypted row field
 */
export interface RowConfig {
  type: EncryptedType;
  value: number | boolean | string;
}

/**
 * Dataset structure
 */
export interface Dataset {
  id: number;
  rows: string[];
  merkleRoot: string;
  proofs: string[][];
  numColumns: number;
  rowCount: number;
}

/**
 * Common FHEVM configuration options
 */
export interface FhevmConfig {
  network?: string;
  gatewayUrl?: string;
  kmsContractAddress?: string;
}
