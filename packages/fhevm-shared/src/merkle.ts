/**
 * Merkle tree utilities for dataset verification
 * Extracted from test/utils.ts:23-118
 */

import { ethers } from "ethers";

/**
 * Generate merkle tree from encrypted rows
 * From utils.ts:23-69
 */
export function generateMerkleTreeFromRows(
  rows: string[],
  datasetId: number | string | bigint
): {
  root: string;
  proofs: string[][];
} {
  if (rows.length === 0) {
    throw new Error("Cannot generate merkle tree from empty rows");
  }

  // Generate leaf hashes for merkle tree
  const leaves = rows.map((row, index) =>
    ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "uint256", "bytes"],
        [datasetId, index, row]
      )
    )
  );

  // Build merkle tree from bottom up
  let currentLevel = leaves;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const combined = ethers.keccak256(
          ethers.solidityPacked(
            ["bytes32", "bytes32"],
            [currentLevel[i], currentLevel[i + 1]]
          )
        );
        nextLevel.push(combined);
      } else {
        const duplicated = ethers.keccak256(
          ethers.solidityPacked(
            ["bytes32", "bytes32"],
            [currentLevel[i], currentLevel[i]]
          )
        );
        nextLevel.push(duplicated);
      }
    }

    currentLevel = nextLevel;
  }

  const root = currentLevel[0];
  const proofs = leaves.map((_, leafIndex) =>
    generateMerkleProof(leaves, leafIndex)
  );

  return {
    root,
    proofs: proofs.map((proof) => proof.map((p) => p.toString())),
  };
}

/**
 * Generate merkle proof for a specific leaf
 * From utils.ts:71-118
 */
export function generateMerkleProof(
  leaves: string[],
  targetIndex: number
): string[] {
  const proof: string[] = [];
  let currentLevel = leaves;
  let index = targetIndex;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    const proofElements: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const combined = ethers.keccak256(
          ethers.solidityPacked(["bytes32", "bytes32"], [left, right])
        );
        nextLevel.push(combined);

        if (i === index) {
          proofElements.push(right);
        } else if (i + 1 === index) {
          proofElements.push(left);
        }
      } else {
        const duplicated = ethers.keccak256(
          ethers.solidityPacked(
            ["bytes32", "bytes32"],
            [currentLevel[i], currentLevel[i]]
          )
        );
        nextLevel.push(duplicated);

        if (i === index) {
          proofElements.push(currentLevel[i]);
        }
      }
    }

    proof.push(...proofElements);
    currentLevel = nextLevel;
    index = Math.floor(index / 2);
  }

  return proof;
}
