"use client";

import { useState } from "react";
import { useMetaMaskEthersSigner } from "@/hooks/metamask/useMetaMaskEthersSigner";
import { useInMemoryStorage } from "@/hooks/useInMemoryStorage";
import { useFhevm } from "@fhevm/react";

import { StatusBadgesPopover } from "@/components/StatusBadgesPopover";
import { StatusBadgeProps } from "@/components/StatusBadgeTypes";
import { Button } from "./ui/button";
import { useJobManager } from "@/hooks/useJobManager";
import { useDatasetRegistry } from "@/hooks/useDatasetRegistry";
import { CreateDatasetModal } from "@/components/CreateDatasetModal";

// Mock data for demonstration purposes
// Alternative mock states for testing different scenarios:

// Loading state example:
// const mockStatusBadgeProps: StatusBadgeProps = {
//   chainId: 9000,
//   accounts: ["0x1234567890123456789012345678901234567890"],
//   ethersSigner: undefined,
//   contractAddress: "0xAbCdEf1234567890aBcDeF1234567890AbCdEf12",
//   isDeployed: true,
//   fhevmInstance: undefined,
//   fhevmStatus: "loading",
//   fhevmError: null,
// };

// Error state example:
// const mockStatusBadgeProps: StatusBadgeProps = {
//   chainId: undefined,
//   accounts: undefined,
//   ethersSigner: undefined,
//   contractAddress: undefined,
//   isDeployed: false,
//   fhevmInstance: undefined,
//   fhevmStatus: "error",
//   fhevmError: new Error("Failed to initialize FHEVM instance"),
// };

const mockStatusBadgeProps: StatusBadgeProps = {
  chainId: 9000, // Mock local chain ID
  accounts: [
    "0x1234567890123456789012345678901234567890",
    "0x0987654321098765432109876543210987654321",
  ],
  ethersSigner: undefined, // Mock signer - in real app, this would be from useMetaMaskEthersSigner
  contracts: [
    {
      name: "JobManager",
      address: "0xAbCdEf1234567890aBcDeF1234567890AbCdEf12",
      isDeployed: true,
    },
  ],
  fhevmInstance: {} as any, // Mock FHEVM instance - in real app, this would be from useFhevm
  fhevmStatus: "ready", // Can be: "loading", "ready", "error"
  fhevmError: null,
};

export default function ConfidentialDataMarketplace() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage();
  const {
    provider,
    chainId,
    accounts,
    isConnected,
    connect,
    ethersSigner,
    ethersReadonlyProvider,
    sameChain,
    sameSigner,
    initialMockChains,
  } = useMetaMaskEthersSigner();

  const {
    instance: fhevmInstance,
    status: fhevmStatus,
    error: fhevmError,
  } = useFhevm({
    provider,
    chainId,
    initialMockChains,
    enabled: true, // use enabled to dynamically create the instance on-demand
  });

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

  const handleDatasetCreated = () => {
    // Refresh dataset list or show success message
    console.log("Dataset created successfully!");
  };

  if (!isConnected) {
    return (
      <div className="flex justify-center items-center w-full">
        <Button
          size="lg"
          className="py-10"
          disabled={isConnected}
          onClick={connect}
        >
          <span className="text-2xl font-semibold">Connect to MetaMask</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 items-center sm:items-start w-full px-3 md:px-0">
      {/* <FHECounterDemo /> */}
      <StatusBadgesPopover
        className="absolute top-10 right-6"
        {...mockStatusBadgeProps}
        chainId={chainId}
        contracts={[
          {
            name: "datasetRegistry",
            address: datasetRegistry.contractAddress,
            isDeployed: datasetRegistry.isDeployed,
          },
        ]}
      />

      <div className="flex gap-2 items-center w-full justify-between">
        <h1>Confidential Data Marketplace</h1>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          Create Dataset
        </Button>
      </div>

      <CreateDatasetModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        contractAddress={datasetRegistry.contractAddress}
        fhevmInstance={fhevmInstance}
        ethersSigner={ethersSigner}
        contractAbi={datasetRegistry.datasetRegistry.abi}
        onSuccess={handleDatasetCreated}
      />
    </div>
  );
}
