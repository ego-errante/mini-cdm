import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { JobManager, JobManager__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { createPackedEncryptedTable } from "./RowDecoder";

// Test utilities
export async function generateMerkleTreeFromRows(rows: string[], datasetId: number) {
  if (rows.length === 0) {
    throw new Error("Cannot generate merkle tree from empty rows");
  }

  // Generate leaf hashes for merkle tree
  const leaves = rows.map((row, index) =>
    ethers.keccak256(ethers.solidityPacked(["uint256", "uint256", "bytes"], [datasetId, index, row])),
  );

  // Build merkle tree from bottom up
  let currentLevel = leaves;

  // Keep building levels until we have a single root
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    // Process pairs of nodes
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Combine two nodes
        const combined = ethers.keccak256(
          ethers.solidityPacked(["bytes32", "bytes32"], [currentLevel[i], currentLevel[i + 1]]),
        );
        nextLevel.push(combined);
      } else {
        // Odd number of nodes, duplicate the last one
        nextLevel.push(currentLevel[i]);
      }
    }

    currentLevel = nextLevel;
  }

  const root = currentLevel[0];

  // Generate proofs for each leaf
  const proofs = leaves.map((_, leafIndex) => generateMerkleProof(leaves, leafIndex));

  return {
    root,
    proofs: proofs.map((proof) => proof.map((p) => p.toString())),
  };
}

export function generateMerkleProof(leaves: string[], targetIndex: number): string[] {
  const proof: string[] = [];
  let currentLevel = leaves;
  let index = targetIndex;

  // Build proof from bottom up
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    const proofElements: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Two nodes - combine them
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const combined = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [left, right]));
        nextLevel.push(combined);

        // Add sibling to proof (the one we're not using for this path)
        if (i === index) {
          proofElements.push(right);
        } else if (i + 1 === index) {
          proofElements.push(left);
        }
      } else {
        // Odd number of nodes, just pass through
        nextLevel.push(currentLevel[i]);
      }
    }

    // Add the proof elements from this level
    proof.push(...proofElements);

    // Move to next level and update index
    currentLevel = nextLevel;
    index = Math.floor(index / 2);
  }

  return proof;
}

export async function generateTestDatasetWithEncryption(contractAddress: string, signer: HardhatEthersSigner) {
  // Define default test data for 4 rows
  const rowConfigs = [
    [{ type: "euint8" as const, value: 42 }],
    [{ type: "euint32" as const, value: 1337 }],
    [{ type: "euint64" as const, value: 999999 }],
    [{ type: "euint8" as const, value: 10 }],
  ];

  return generateTestDatasetWithCustomConfig(contractAddress, signer, rowConfigs);
}

export async function generateTestDatasetWithCustomConfig(
  contractAddress: string,
  signer: HardhatEthersSigner,
  rowConfigs: { type: "euint8" | "euint32" | "euint64"; value: number }[][],
) {
  const cellList = rowConfigs.flat();
  const columns = rowConfigs[0].length;
  const rows = await createPackedEncryptedTable(contractAddress, signer, cellList, columns);

  // Generate merkle tree from encrypted rows
  const merkleData = await generateMerkleTreeFromRows(rows, 1);

  // Compute schemaHash using same logic as DatasetRegistry.sol
  const schemaHash = ethers.keccak256(ethers.solidityPacked(["uint256"], [columns]));

  return {
    rows,
    root: merkleData.root,
    proofs: merkleData.proofs,
    schemaHash,
  };
}

export function createDefaultJobParams() {
  return {
    op: 1, // SUM
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
}

export type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

export async function deployDatasetRegistryFixture() {
  const factory = (await ethers.getContractFactory("DatasetRegistry")) as DatasetRegistry__factory;
  const datasetRegistryContract = (await factory.deploy()) as DatasetRegistry;
  const datasetRegistryContractAddress = await datasetRegistryContract.getAddress();

  return { datasetRegistryContract, datasetRegistryContractAddress };
}

export async function deployJobManagerFixture(datasetRegistryContractAddress: string) {
  const factory = (await ethers.getContractFactory("JobManager")) as JobManager__factory;
  const jobManagerContract = (await factory.deploy(datasetRegistryContractAddress)) as JobManager;
  const jobManagerContractAddress = await jobManagerContract.getAddress();

  return { jobManagerContract, jobManagerContractAddress };
}
