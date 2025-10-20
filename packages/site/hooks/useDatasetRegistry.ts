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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DatasetObject = {
  id: bigint;
  merkleRoot: string;
  numColumns: number;
  rowCount: number;
  owner: string;
  exists: boolean;
  kAnonymity: number;
  cooldownSec: number;
};

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

  const queryClient = useQueryClient();

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
      datasetId: bigint;
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
    onSuccess: () => {
      // Refetch datasets after successful commit
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (error) => {
      console.error("Dataset commit failed:", error);
    },
  });

  const deleteDatasetMutation = useMutation({
    mutationFn: async (datasetId: bigint) => {
      if (!datasetRegistry.address || !ethersSigner) {
        throw new Error("Contract or signer not available");
      }

      const contract = new ethers.Contract(
        datasetRegistry.address,
        datasetRegistry.abi,
        ethersSigner
      );

      const tx = await contract.deleteDataset(datasetId);
      const receipt = await tx.wait();
      return receipt;
    },
    onSuccess: () => {
      // Refetch datasets after successful deletion
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (error) => {
      console.error("Dataset deletion failed:", error);
    },
  });

  const getDatasetsQuery = useQuery({
    queryKey: ["datasets", datasetRegistry.address],
    queryFn: async (): Promise<DatasetObject[]> => {
      if (!datasetRegistry.address || !ethersReadonlyProvider) {
        throw new Error("Contract or provider not available");
      }

      const contract = new ethers.Contract(
        datasetRegistry.address,
        datasetRegistry.abi,
        ethersReadonlyProvider
      );

      // Get all datasets at once
      const contractDatasets = await contract.getAllDatasets();

      // Convert contract DatasetWithId[] to DatasetObject[]
      const datasets: DatasetObject[] = contractDatasets.map(
        (dataset: any) => ({
          id: BigInt(dataset.id),
          merkleRoot: dataset.merkleRoot,
          numColumns: Number(dataset.numColumns),
          rowCount: Number(dataset.rowCount),
          owner: dataset.owner,
          exists: dataset.exists,
          kAnonymity: Number(dataset.kAnonymity),
          cooldownSec: Number(dataset.cooldownSec),
        })
      );

      return datasets;
    },
    enabled: !!datasetRegistry.address && !!ethersReadonlyProvider,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  return {
    datasetRegistry,
    isDeployed,
    contractAddress: datasetRegistry.address,
    commitDatasetMutation,
    deleteDatasetMutation,
    getDatasetsQuery,
  };
};
