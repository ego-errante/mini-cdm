import { type FhevmInstance, type GenericStringStorage } from "@fhevm/react";
import { ethers } from "ethers";
import { RefObject, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { JobManagerAddresses } from "@/abi/JobManagerAddresses";
import { JobManagerABI } from "@/abi/JobManagerABI";
import { getContractByChainId, isContractDeployed } from "@/lib/utils";
import {
  Op,
  RequestStatus,
  FilterProg,
  JobParams,
  JobRequest,
  JobData,
  JobManagerActivity,
} from "@fhevm/shared";

// Types imported from @fhevm/shared

export const useJobManager = (parameters: {
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

  const jobManager = useMemo(() => {
    const contractInfo = getContractByChainId(
      chainId,
      JobManagerABI,
      JobManagerAddresses,
      "JobManager"
    );

    if (!contractInfo.address) {
      console.warn(`JobManager deployment not found for chainId=${chainId}.`);
    }

    return contractInfo;
  }, [chainId]);

  const isDeployed = useMemo(() => {
    return isContractDeployed(jobManager);
  }, [jobManager]);

  const getJobManagerActivity = useQuery({
    queryKey: ["job-manager", "activity", chainId, jobManager.address],
    queryFn: async (): Promise<JobManagerActivity> => {
      if (!jobManager.address || !ethersReadonlyProvider) {
        throw new Error("JobManager contract not available");
      }

      const contract = new ethers.Contract(
        jobManager.address,
        jobManager.abi,
        ethersReadonlyProvider
      );

      // Get total counts
      const [nextJobId, nextRequestId] = await Promise.all([
        contract.nextJobId(),
        contract.nextRequestId(),
      ]);

      const totalJobs = Number(nextJobId) - 1;
      const totalRequests = Number(nextRequestId) - 1;

      // Fetch all requests
      const requestPromises = Array.from(
        { length: totalRequests },
        async (_, i) => {
          const requestId = BigInt(i + 1);
          try {
            const requestResult = await contract.getRequest(requestId);

            // Convert ethers.Result to JobRequest
            const request: JobRequest = {
              datasetId: requestResult[0],
              buyer: requestResult[1],
              params: {
                op: Number(requestResult[2][0]),
                targetField: Number(requestResult[2][1]),
                weights: requestResult[2][2].map((w: any) => Number(w)),
                divisor: Number(requestResult[2][3]),
                clampMin: requestResult[2][4],
                clampMax: requestResult[2][5],
                roundBucket: Number(requestResult[2][6]),
                filter: {
                  bytecode: requestResult[2][7][0],
                  consts: requestResult[2][7][1],
                },
              },
              status: Number(requestResult[3]),
              timestamp: requestResult[4],
              jobId: requestResult[5],
              baseFee: requestResult[6],
              computeAllowance: requestResult[7],
              gasDebtToSeller: requestResult[8],
              requestId: requestId, // Assign global unique ID
            };

            return request;
          } catch (error) {
            console.error(`Failed to fetch request ${requestId}:`, error);
            return null;
          }
        }
      );

      // Fetch all jobs
      const jobPromises = Array.from({ length: totalJobs }, async (_, i) => {
        const jobId = BigInt(i + 1);
        try {
          const [buyer, datasetId, isOpen, progress, result] =
            await Promise.all([
              contract.jobBuyer(jobId),
              contract.jobDataset(jobId),
              contract.jobOpen(jobId),
              contract.getJobProgress(jobId),
              contract.getJobResult(jobId).catch(() => null), // Result might not be available
            ]);

          const jobData: JobData = {
            id: jobId,
            buyer,
            datasetId,
            isOpen,
            progress: {
              totalRows: progress[0],
              processedRows: progress[1],
              remainingRows: progress[2],
            },
            jobId: jobId, // Assign global unique ID
          };

          // Only include result if job is finalized
          if (result && result[0]) {
            jobData.result = {
              isFinalized: result[0],
              result: result[1],
              isOverflow: result[2],
            };
          }

          return jobData;
        } catch (error) {
          console.error(`Failed to fetch job ${jobId}:`, error);
          return null;
        }
      });

      // Wait for all promises and filter out nulls
      const [requests, jobs] = await Promise.all([
        Promise.all(requestPromises),
        Promise.all(jobPromises),
      ]);

      const filteredRequests = requests.filter(
        (r): r is JobRequest => r !== null
      );
      const filteredJobs = jobs.filter((j): j is JobData => j !== null);

      // Create job lookup map by jobId for O(1) access
      const jobsById: Record<string, JobData> = {};
      filteredJobs.forEach((job) => {
        jobsById[job.id.toString()] = job;
      });

      // Group requests and jobs by datasetId for enumeration
      const byDataset: Record<
        string,
        { requests: JobRequest[]; jobs: JobData[] }
      > = {};

      filteredRequests.forEach((request, idx) => {
        const datasetIdStr = request.datasetId.toString();
        if (!byDataset[datasetIdStr]) {
          byDataset[datasetIdStr] = { requests: [], jobs: [] };
        }
        byDataset[datasetIdStr].requests.push(request);
      });

      filteredJobs.forEach((job) => {
        const datasetIdStr = job.datasetId.toString();
        if (!byDataset[datasetIdStr]) {
          byDataset[datasetIdStr] = { requests: [], jobs: [] };
        }
        byDataset[datasetIdStr].jobs.push(job);
      });

      // Create requestId -> job lookup for O(1) access in JobProcessorModal
      // requestId is 1-indexed position in the requests array
      const requestToJob: Record<string, JobData | null> = {};
      filteredRequests.forEach((request, idx) => {
        const requestId = (idx + 1).toString();
        // Find the job linked to this request via jobId
        const job =
          request.jobId > BigInt(0)
            ? jobsById[request.jobId.toString()] || null
            : null;
        requestToJob[requestId] = job;
      });

      return {
        requests: filteredRequests,
        jobs: filteredJobs,
        byDataset,
        requestToJob,
      };
    },
    enabled: !!jobManager.address && !!ethersReadonlyProvider && isDeployed,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  // Mutations
  const submitRequestMutation = useMutation({
    mutationFn: async (params: {
      datasetId: bigint;
      baseFee: bigint;
      computeAllowance: bigint;
      jobParams: JobParams;
    }) => {
      if (!jobManager.address || !ethersSigner) {
        throw new Error("Contract or signer not available");
      }

      const contract = new ethers.Contract(
        jobManager.address,
        jobManager.abi,
        ethersSigner
      );

      const totalValue = params.baseFee + params.computeAllowance;
      const tx = await contract.submitRequest(
        params.datasetId,
        params.jobParams,
        params.baseFee,
        { value: totalValue }
      );

      const receipt = await tx.wait();
      return receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    },
  });

  const acceptRequestMutation = useMutation({
    mutationFn: async (requestId: bigint) => {
      if (!jobManager.address || !ethersSigner) {
        throw new Error("Contract or signer not available");
      }

      const contract = new ethers.Contract(
        jobManager.address,
        jobManager.abi,
        ethersSigner
      );

      const tx = await contract.acceptRequest(requestId);
      const receipt = await tx.wait();
      return receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    },
  });

  const rejectRequestMutation = useMutation({
    mutationFn: async (requestId: bigint) => {
      if (!jobManager.address || !ethersSigner) {
        throw new Error("Contract or signer not available");
      }

      const contract = new ethers.Contract(
        jobManager.address,
        jobManager.abi,
        ethersSigner
      );

      const tx = await contract.rejectRequest(requestId);
      const receipt = await tx.wait();
      return receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    },
  });

  const cancelRequestMutation = useMutation({
    mutationFn: async (requestId: bigint) => {
      if (!jobManager.address || !ethersSigner) {
        throw new Error("Contract or signer not available");
      }

      const contract = new ethers.Contract(
        jobManager.address,
        jobManager.abi,
        ethersSigner
      );

      const tx = await contract.cancelRequest(requestId);
      const receipt = await tx.wait();
      return receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    },
  });

  const pushRowMutation = useMutation({
    mutationFn: async (params: {
      jobId: bigint;
      rowData: string;
      merkleProof: string[];
      rowIndex: number;
    }) => {
      if (!jobManager.address || !ethersSigner) {
        throw new Error("Contract or signer not available");
      }

      const contract = new ethers.Contract(
        jobManager.address,
        jobManager.abi,
        ethersSigner
      );

      const tx = await contract.pushRow(
        params.jobId,
        params.rowData,
        params.merkleProof,
        params.rowIndex
      );

      const receipt = await tx.wait();
      return receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    },
  });

  const finalizeJobMutation = useMutation({
    mutationFn: async (jobId: bigint) => {
      if (!jobManager.address || !ethersSigner) {
        throw new Error("Contract or signer not available");
      }

      const contract = new ethers.Contract(
        jobManager.address,
        jobManager.abi,
        ethersSigner
      );

      const tx = await contract.finalize(jobId);
      const receipt = await tx.wait();
      return receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    },
  });

  // Event listeners for automatic query invalidation
  useEffect(() => {
    if (!jobManager.address || !ethersReadonlyProvider) {
      return;
    }

    const contract = new ethers.Contract(
      jobManager.address,
      jobManager.abi,
      ethersReadonlyProvider
    );

    const handleRequestSubmitted = (
      requestId: bigint,
      buyer: string,
      datasetId: bigint
    ) => {
      console.log("RequestSubmitted event:", { requestId, buyer, datasetId });
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    };

    const handleRequestAccepted = (requestId: bigint, jobId: bigint) => {
      console.log("RequestAccepted event:", { requestId, jobId });
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    };

    const handleRequestRejected = (requestId: bigint) => {
      console.log("RequestRejected event:", { requestId });
      queryClient.invalidateQueries({ queryKey: ["job-manager", "activity"] });
    };

    // Attach event listeners
    contract.on("RequestSubmitted", handleRequestSubmitted);
    contract.on("RequestAccepted", handleRequestAccepted);
    contract.on("RequestRejected", handleRequestRejected);

    // Cleanup function
    return () => {
      contract.off("RequestSubmitted", handleRequestSubmitted);
      contract.off("RequestAccepted", handleRequestAccepted);
      contract.off("RequestRejected", handleRequestRejected);
    };
  }, [jobManager.address, ethersReadonlyProvider, queryClient]);

  return {
    jobManager,
    isDeployed,
    contractAddress: jobManager.address,
    getJobManagerActivity,
    submitRequestMutation,
    acceptRequestMutation,
    rejectRequestMutation,
    cancelRequestMutation,
    pushRowMutation,
    finalizeJobMutation,
  };
};

// All types now imported from @fhevm/shared
