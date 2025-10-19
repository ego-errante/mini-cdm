/**
 * Shared types for FHEVM packages
 */

/**
 * Supported encrypted data types in FHEVM
 */
export type EncryptedType = "euint8" | "euint16" | "euint32" | "euint64";

/**
 * Configuration for a single encrypted row field
 */
export interface RowConfig {
  type: EncryptedType;
  value: number;
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
 * Test dataset structure (used in test utilities)
 */
export interface TestDataset {
  id: number;
  rows: string[];
  merkleRoot: string;
  proofs: string[][];
  numColumns: number;
  rowCount: number;
}

/**
 * Dataset object from contract view
 */
export interface DatasetObject {
  merkleRoot: string;
  numColumns: bigint;
  rowCount: bigint;
  owner: string;
  exists: boolean;
  kAnonymity: number;
  cooldownSec: number;
}

/**
 * Job operation types
 */
export enum Op {
  WEIGHTED_SUM,
  SUM,
  AVG_P,
  COUNT,
  MIN,
  MAX,
}

/**
 * Request status types
 */
export enum RequestStatus {
  PENDING,
  ACCEPTED,
  REJECTED,
  COMPLETED,
}

/**
 * Filter program structure
 */
export interface FilterProg {
  bytecode: string;
  consts: readonly bigint[];
}

/**
 * Job parameters structure
 */
export interface JobParams {
  op: Op;
  targetField: number;
  weights: readonly number[];
  divisor: number;
  clampMin: bigint;
  clampMax: bigint;
  roundBucket: number;
  filter: FilterProg;
}

/**
 * Job request structure
 */
export interface JobRequest {
  datasetId: bigint;
  buyer: `0x${string}`;
  params: JobParams;
  status: RequestStatus;
  timestamp: bigint;
  jobId: bigint;
  baseFee: bigint;
  computeAllowance: bigint;
  gasDebtToSeller: bigint;
}

/**
 * Job data structure
 */
export interface JobData {
  id: bigint;
  buyer: `0x${string}`;
  datasetId: bigint;
  isOpen: boolean;
  progress: {
    totalRows: bigint;
    processedRows: bigint;
    remainingRows: bigint;
  };
  result?: {
    isFinalized: boolean;
    result: string; // euint256 as bytes32
    isOverflow: string; // ebool as bytes32
  };
}

/**
 * Job manager activity structure
 */
export interface JobManagerActivity {
  jobs: JobData[];
  requests: JobRequest[];
  matched: Record<string, { job?: JobData; request?: JobRequest }>;
}

/**
 * Common FHEVM configuration options
 */
export interface FhevmConfig {
  network?: string;
  gatewayUrl?: string;
  kmsContractAddress?: string;
}

/**
 * Encrypted row data structure
 */
export interface EncryptedRow {
  rowIndex: number;
  encryptedData: string;
}

/**
 * Complete encrypted dataset structure
 */
export interface EncryptedDataset {
  datasetId: string;
  rows: EncryptedRow[];
  numColumns: number;
  rowCount: number;
  merkleRoot: string;
}
