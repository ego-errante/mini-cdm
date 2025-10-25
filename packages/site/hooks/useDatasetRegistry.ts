import {
  FhevmDecryptionSignature,
  type FhevmInstance,
  type GenericStringStorage,
} from "@fhevm/react";
import { ethers } from "ethers";
import { RefObject, useMemo, useEffect } from "react";

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
  kAnonymity: string;
  cooldownSec: number;
  description?: string;
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
      DatasetRegistryAddresses
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
      description?: string;
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
        description,
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

      // If description is provided, set it after dataset creation
      if (description && description.trim()) {
        try {
          const descriptionTx = await contract.setDatasetDescription(
            datasetId,
            description.trim()
          );
          await descriptionTx.wait();
        } catch (error) {
          // Log error but don't fail the entire mutation since dataset was created successfully
          console.warn(
            "Failed to set dataset description after creation:",
            error
          );
        }
      }

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

  const setDatasetDescriptionMutation = useMutation({
    mutationFn: async (params: { datasetId: bigint; description: string }) => {
      if (!datasetRegistry.address || !ethersSigner) {
        throw new Error("Contract or signer not available");
      }

      const { datasetId, description } = params;

      const contract = new ethers.Contract(
        datasetRegistry.address,
        datasetRegistry.abi,
        ethersSigner
      );

      const tx = await contract.setDatasetDescription(datasetId, description);
      const receipt = await tx.wait();
      return receipt;
    },
    onSuccess: () => {
      // Refetch datasets after successful description update
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (error) => {
      console.error("Dataset description update failed:", error);
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

      // Fetch datasets and descriptions in parallel for better performance
      const [contractDatasets, contractDescriptions] = await Promise.all([
        contract.getAllDatasets(),
        contract.getAllDatasetDescriptions(),
      ]);

      // Convert descriptions array to a map for efficient lookup
      const descriptionMap = new Map<bigint, string>();
      contractDescriptions.forEach((desc: any) => {
        descriptionMap.set(BigInt(desc.datasetId), desc.description);
      });

      // Convert contract DatasetWithId[] to DatasetObject[] and merge descriptions
      const datasets: DatasetObject[] = contractDatasets.map(
        (dataset: any) => ({
          id: BigInt(dataset.id),
          merkleRoot: dataset.merkleRoot,
          numColumns: Number(dataset.numColumns),
          rowCount: Number(dataset.rowCount),
          owner: dataset.owner,
          exists: dataset.exists,
          kAnonymity: dataset.kAnonymity,
          cooldownSec: Number(dataset.cooldownSec),
          description: descriptionMap.get(BigInt(dataset.id)) || undefined,
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

  // Event listeners for automatic query invalidation
  useEffect(() => {
    if (!datasetRegistry.address || !ethersReadonlyProvider) {
      return;
    }

    const contract = new ethers.Contract(
      datasetRegistry.address,
      datasetRegistry.abi,
      ethersReadonlyProvider
    );

    const handleDatasetCommitted = (datasetId: bigint, owner: string) => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    };

    const handleDatasetDeleted = (datasetId: bigint, owner: string) => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    };

    const handleJobManagerSet = (jobManager: string) => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    };

    const handleDatasetDescriptionSet = (
      datasetId: bigint,
      description: string
    ) => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    };

    // Attach event listeners
    contract.on("DatasetCommitted", handleDatasetCommitted);
    contract.on("DatasetDeleted", handleDatasetDeleted);
    contract.on("JobManagerSet", handleJobManagerSet);
    contract.on("DatasetDescriptionSet", handleDatasetDescriptionSet);

    // Cleanup function
    return () => {
      contract.off("DatasetCommitted", handleDatasetCommitted);
      contract.off("DatasetDeleted", handleDatasetDeleted);
      contract.off("JobManagerSet", handleJobManagerSet);
      contract.off("DatasetDescriptionSet", handleDatasetDescriptionSet);
    };
  }, [datasetRegistry.address, ethersReadonlyProvider, queryClient]);

  return {
    datasetRegistry,
    isDeployed,
    contractAddress: datasetRegistry.address,
    commitDatasetMutation,
    deleteDatasetMutation,
    setDatasetDescriptionMutation,
    getDatasetsQuery,
  };
};
