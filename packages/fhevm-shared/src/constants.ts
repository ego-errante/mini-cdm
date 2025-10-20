/**
 * Shared constants for FHEVM packages
 */

/**
 * Default network configuration
 */
export const DEFAULT_NETWORK = "localhost";

/**
 * FHEVM Contract addresses (can be overridden per network)
 */
export const CONTRACT_ADDRESSES = {
  LOCALHOST: {
    ACL: "0x2Fb4341f57900e98f1D9d8fAb6Fe2e3c93d88a35",
    TFHE_EXECUTOR: "0xc8c9303Cd7F337fab769686B593B87DC3403E0ce",
    KMS_VERIFIER: "0x12B064d9a7c2c5a6A5E99e7c8Ba8e44Ba8f7B04E",
  },
} as const;

/**
 * Gas limits for common operations
 */
export const GAS_LIMITS = {
  DEFAULT: 10000000,
  DATASET_REGISTER: 5000000,
  JOB_SUBMISSION: 3000000,
} as const;

/**
 * Encrypted type sizes in bits
 */
export const ENCRYPTED_TYPE_SIZES = {
  euint8: 8,
  euint16: 16,
  euint32: 32,
  euint64: 64,
  euint128: 128,
  euint256: 256,
  ebool: 1,
  eaddress: 160,
} as const;

/**
 * Job operation codes (corresponds to Op enum)
 */
export const OpCodes = {
  WEIGHTED_SUM: 0,
  SUM: 1,
  AVG_P: 2,
  COUNT: 3,
  MIN: 4,
  MAX: 5,
} as const;

/**
 * Job operation names (corresponds to Op enum)
 */
export const OpNames = [
  "WEIGHTED_SUM",
  "SUM",
  "AVG_P",
  "COUNT",
  "MIN",
  "MAX",
] as const;

/**
 * Type for operation names
 */
export type OpName = (typeof OpNames)[number];

/**
 * K-Anonymity privacy levels
 */
export const KAnonymityLevels = {
  NONE: 0,
  MINIMAL: 3,
  STANDARD: 5,
  HIGH: 10,
  MAXIMUM: 50,
} as const;
