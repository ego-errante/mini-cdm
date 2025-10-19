import { ethers } from "ethers";
import { FhevmInstance } from "@fhevm/react";

export interface ContractStatus {
  name: string;
  address: string | undefined;
  isDeployed?: boolean;
}

export interface StatusBadgeProps {
  chainId: number | undefined;
  accounts: string[] | undefined;
  ethersSigner: ethers.Signer | undefined;
  contracts: ContractStatus[];
  fhevmInstance: FhevmInstance | undefined;
  fhevmStatus: string;
  fhevmError: Error | null;
}
