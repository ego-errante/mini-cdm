import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ethers } from "ethers";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Contract deployment information for a specific chain
 */
export type ContractDeployment = {
  address: string;
  chainId: number;
  chainName: string;
};

/**
 * Mapping of chainId (as string) to contract deployment info
 */
export type ContractAddressesMapping = Record<string, ContractDeployment>;

/**
 * Contract ABI wrapper type
 */
export type ContractABI = {
  abi: readonly any[] | any[];
};

/**
 * Complete contract information including deployment details and ABI
 */
export type ContractInfo = {
  address?: `0x${string}`;
  chainId?: number;
  chainName?: string;
  abi: readonly any[] | any[];
};

/**
 * Generic function to get contract information by chain ID
 *
 * @param chainId - The chain ID to lookup
 * @param contractABI - The contract ABI object (e.g., JobManagerABI, DatasetRegistryABI)
 * @param contractAddresses - The contract addresses mapping (e.g., JobManagerAddresses, DatasetRegistryAddresses)
 * @param contractName - Optional name for error messages
 * @returns Contract information including address, chainId, chainName, and ABI
 *
 * @example
 * ```ts
 * const jobManagerInfo = getContractByChainId(
 *   chainId,
 *   JobManagerABI,
 *   JobManagerAddresses,
 *   "JobManager"
 * );
 * ```
 */
export function getContractByChainId(
  chainId: number | undefined,
  contractABI: ContractABI,
  contractAddresses: ContractAddressesMapping,
  contractName?: string
): ContractInfo {
  // If no chainId provided, return just the ABI
  if (!chainId) {
    return { abi: contractABI.abi };
  }

  // Lookup the contract deployment for this chain
  const entry = contractAddresses[chainId.toString()];

  // If no entry found or address is zero address, return ABI with chainId
  if (!entry || !("address" in entry) || entry.address === ethers.ZeroAddress) {
    return { abi: contractABI.abi, chainId };
  }

  // Return full contract information
  return {
    address: entry.address as `0x${string}`,
    chainId: entry.chainId ?? chainId,
    chainName: entry.chainName,
    abi: contractABI.abi,
  };
}

/**
 * Check if a contract is deployed on the given chain
 *
 * @param contractInfo - The contract information object
 * @returns true if deployed, false if not, undefined if contract info is missing
 */
export function isContractDeployed(
  contractInfo: ContractInfo | undefined
): boolean | undefined {
  if (!contractInfo) {
    return undefined;
  }
  return (
    Boolean(contractInfo.address) && contractInfo.address !== ethers.ZeroAddress
  );
}

export function uuidToUint256(uuid: string) {
  // Remove hyphens and convert to hex string
  const hex = uuid.replace(/-/g, "");
  // Convert to BigInt (uint256)
  return BigInt("0x" + hex);
}
