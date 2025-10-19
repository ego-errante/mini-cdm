import {
  FhevmDecryptionSignature,
  type FhevmInstance,
  type GenericStringStorage,
} from "@fhevm/react";
import { ethers } from "ethers";
import { RefObject, useMemo } from "react";

import { DatasetRegistryAddresses } from "@/abi/DatasetRegistryAddresses";
import { DatasetRegistryABI } from "@/abi/DatasetRegistryABI";
import { getContractByChainId, isContractDeployed } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";

export const useDatasetRegistry = (parameters: {
  instance: FhevmInstance | undefined;
  fhevmDecryptionSignatureStorage: GenericStringStorage;
  eip1193Provider: ethers.Eip1193Provider | undefined;
  chainId: number | undefined;
  ethersSigner: ethers.JsonRpcSigner | undefined;
  ethersReadonlyProvider: ethers.ContractRunner | undefined;
  sameChain: RefObject<(chainId: number | undefined) => boolean>;
  sameSigner: RefObject<
    (ethersSigner: ethers.JsonRpcSigner | undefined) => boolean
  >;
}) => {
  const {
    instance,
    fhevmDecryptionSignatureStorage,
    chainId,
    ethersSigner,
    ethersReadonlyProvider,
    sameChain,
    sameSigner,
  } = parameters;

  const datasetRegistry = useMemo(() => {
    const contractInfo = getContractByChainId(
      chainId,
      DatasetRegistryABI,
      DatasetRegistryAddresses,
      "DatasetRegistry"
    );

    if (!contractInfo.address) {
      console.warn(
        `DatasetRegistry deployment not found for chainId=${chainId}.`
      );
    }

    return contractInfo;
  }, [chainId]);

  const isDeployed = useMemo(() => {
    return isContractDeployed(datasetRegistry);
  }, [datasetRegistry]);

  const commitDatasetMutation = useMutation({
    mutationFn: async (params: {
      datasetId: number;
      rowCount: number;
      merkleRoot: string;
      numColumns: number;
      kAnonymity: number;
      cooldownSec: number;
    }) => {
      if (!datasetRegistry.address || !instance || !ethersSigner) {
        throw new Error("Contract, instance, or signer not available");
      }

      const {
        datasetId,
        rowCount,
        merkleRoot,
        numColumns,
        kAnonymity,
        cooldownSec,
      } = params;

      // Encrypt kAnonymity value
      const encryptedInput = await instance
        .createEncryptedInput(datasetRegistry.address, ethersSigner.address)
        .add32(kAnonymity)
        .encrypt();

      const contract = new ethers.Contract(
        datasetRegistry.address,
        datasetRegistry.abi,
        ethersSigner
      );

      const tx = await contract.commitDataset(
        datasetId,
        rowCount,
        merkleRoot,
        numColumns,
        `0x${Buffer.from(encryptedInput.handles[0]).toString("hex")}`,
        `0x${Buffer.from(encryptedInput.inputProof).toString("hex")}`,
        cooldownSec
      );

      const receipt = await tx.wait();
      return receipt;
    },
    onError: (error) => {
      console.error("Dataset commit failed:", error);
    },
  });

  return {
    datasetRegistry,
    isDeployed,
    contractAddress: datasetRegistry.address,
  };
};
