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
  abi: ethers.InterfaceAbi;
};

/**
 * Complete contract information including deployment details and ABI
 */
export type ContractInfo = {
  address?: `0x${string}`;
  chainId?: number;
  chainName?: string;
  abi: ethers.InterfaceAbi;
};

/**
 * Generic function to get contract information by chain ID
 *
 * @param chainId - The chain ID to lookup
 * @param contractABI - The contract ABI object (e.g., JobManagerABI, DatasetRegistryABI)
 * @param contractAddresses - The contract addresses mapping (e.g., JobManagerAddresses, DatasetRegistryAddresses)
 * @returns Contract information including address, chainId, chainName, and ABI
 *
 * @example
 * ```ts
 * const jobManagerInfo = getContractByChainId(
 *   chainId,
 *   JobManagerABI,
 *   JobManagerAddresses
 * );
 * ```
 */
export function getContractByChainId(
  chainId: number | undefined,
  contractABI: ContractABI,
  contractAddresses: ContractAddressesMapping
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

/**
 * Mapping of common chain IDs to human-readable network names
 */
export const NETWORK_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  5: "Goerli",
  11155111: "Sepolia",
  31337: "Hardhat Local Network",
  1337: "Ganache Local Network",
  137: "Polygon Mainnet",
  80001: "Polygon Mumbai",
  42161: "Arbitrum One",
  421613: "Arbitrum Goerli",
  10: "Optimism",
  420: "Optimism Goerli",
  8453: "Base",
  84531: "Base Goerli",
};

/**
 * Get human-readable network name for a given chain ID
 *
 * @param chainId - The chain ID to lookup
 * @returns The network name or "Unknown Network" if not found
 */
export function getNetworkName(chainId: number | string | undefined): string {
  if (!chainId) return "Not connected";

  const id = typeof chainId === "string" ? parseInt(chainId, 10) : chainId;
  return NETWORK_NAMES[id] || `Chain ${id}`;
}

/**
 * Execute a contract transaction with gas estimation and safety margin
 *
 * @param contract - The ethers contract instance
 * @param functionName - The name of the contract function to call
 * @param args - The arguments to pass to the function
 * @param signer - The ethers signer to use for the transaction
 * @param options - Additional transaction options (e.g., value for payable functions)
 * @returns Promise resolving to the transaction receipt
 */
export async function executeContractTransaction(
  contract: ethers.Contract,
  functionName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
  signer: ethers.JsonRpcSigner,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: Record<string, any> = {}
): Promise<ethers.TransactionReceipt> {
  // Encode function data
  const data = contract.interface.encodeFunctionData(functionName, args);

  // Estimate gas using the signer
  const est = await signer.estimateGas({
    to: contract.target,
    data: data,
    ...options,
  });

  // Add 20% safety margin
  const gasLimit = (BigInt(est) * BigInt(120)) / BigInt(100);

  // Sanity check with static call
  await contract[functionName].staticCall(...args, { gasLimit, ...options });

  // Send transaction with explicit gas limit
  const tx = await contract[functionName](...args, { gasLimit, ...options });

  // Wait for receipt
  const receipt = await tx.wait();
  return receipt;
}
