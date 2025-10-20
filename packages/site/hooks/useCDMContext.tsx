"use client";

import {
  createContext,
  ReactNode,
  useContext,
  RefObject,
  useMemo,
} from "react";
import { ethers } from "ethers";
import { type FhevmInstance, type GenericStringStorage } from "@fhevm/react";

// Import hooks
import { useInMemoryStorage } from "./useInMemoryStorage";
import { useMetaMaskEthersSigner } from "./metamask/useMetaMaskEthersSigner";
import { useFhevm } from "@fhevm/react";
import { useJobManager } from "./useJobManager";
import { useDatasetRegistry } from "./useDatasetRegistry";

export interface CDMContextValue {
  // MetaMask/Ethers state
  provider: ethers.Eip1193Provider | undefined;
  chainId: number | undefined;
  accounts: string[] | undefined;
  isConnected: boolean;
  ethersSigner: ethers.JsonRpcSigner | undefined;
  ethersReadonlyProvider: ethers.ContractRunner | undefined;
  connect: () => void;
  sameChain: RefObject<(chainId: number | undefined) => boolean>;
  sameSigner: RefObject<
    (ethersSigner: ethers.JsonRpcSigner | undefined) => boolean
  >;

  // FHEVM state
  fhevmInstance: FhevmInstance | undefined;
  fhevmStatus: string;
  fhevmError: Error | null | undefined;

  // Storage
  fhevmDecryptionSignatureStorage: GenericStringStorage;

  // Contract hooks
  jobManager: ReturnType<typeof useJobManager>;
  datasetRegistry: ReturnType<typeof useDatasetRegistry>;
}

const CDMContext = createContext<CDMContextValue | undefined>(undefined);

interface CDMProviderProps {
  children: ReactNode;
}

export function CDMProvider({ children }: CDMProviderProps) {
  // Base hooks
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage();

  const metamaskState = useMetaMaskEthersSigner();

  const {
    provider,
    chainId,
    ethersSigner,
    ethersReadonlyProvider,
    sameChain,
    sameSigner,
    initialMockChains,
  } = metamaskState;

  const fhevmState = useFhevm({
    provider,
    chainId,
    initialMockChains,
    enabled: true,
  });

  const {
    instance: fhevmInstance,
    status: fhevmStatus,
    error: fhevmError,
  } = fhevmState;

  // Contract hooks - only initialize if dependencies are available
  const jobManager = useJobManager({
    instance: fhevmInstance,
    fhevmDecryptionSignatureStorage,
    eip1193Provider: provider,
    chainId,
    ethersSigner,
    ethersReadonlyProvider,
    sameChain,
    sameSigner,
  });

  const datasetRegistry = useDatasetRegistry({
    instance: fhevmInstance,
    fhevmDecryptionSignatureStorage,
    eip1193Provider: provider,
    chainId,
    ethersSigner,
    ethersReadonlyProvider,
    sameChain,
    sameSigner,
  });

  const contextValue = useMemo<CDMContextValue>(
    () => ({
      // MetaMask/Ethers state
      provider,
      chainId,
      accounts: metamaskState.accounts,
      isConnected: metamaskState.isConnected,
      ethersSigner,
      ethersReadonlyProvider,
      connect: metamaskState.connect,
      sameChain,
      sameSigner,

      // FHEVM state
      fhevmInstance,
      fhevmStatus,
      fhevmError,

      // Storage
      fhevmDecryptionSignatureStorage,

      // Contract hooks
      jobManager,
      datasetRegistry,
    }),
    [
      provider,
      chainId,
      metamaskState.accounts,
      metamaskState.isConnected,
      metamaskState.connect,
      ethersSigner,
      ethersReadonlyProvider,
      sameChain,
      sameSigner,
      fhevmInstance,
      fhevmStatus,
      fhevmError,
      fhevmDecryptionSignatureStorage,
      jobManager,
      datasetRegistry,
    ]
  );

  return (
    <CDMContext.Provider value={contextValue}>{children}</CDMContext.Provider>
  );
}

export function useCDMContext(): CDMContextValue {
  const context = useContext(CDMContext);
  if (!context) {
    throw new Error("useCDMContext must be used within a CDMProvider");
  }
  return context;
}
