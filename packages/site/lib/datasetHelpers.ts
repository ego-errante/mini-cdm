import {
  JobData,
  JobRequest,
  JobManagerActivity,
  RequestStatus,
} from "@fhevm/shared";

/**
 * Count jobs for a specific dataset
 * Uses precomputed byDataset map for O(1) lookup
 */
export function getDatasetJobCount(
  datasetId: bigint,
  activity: JobManagerActivity
): number {
  const datasetIdStr = datasetId.toString();
  return activity.byDataset?.[datasetIdStr]?.jobs.length ?? 0;
}

/**
 * Count requests for a specific dataset
 * Uses precomputed byDataset map for O(1) lookup
 */
export function getDatasetRequestCount(
  datasetId: bigint,
  activity: JobManagerActivity
): number {
  const datasetIdStr = datasetId.toString();
  return activity.byDataset?.[datasetIdStr]?.requests.length ?? 0;
}

/**
 * Check if user has a pending or accepted request for a dataset
 * Uses precomputed byDataset map for O(1) lookup + O(n) filter on dataset-specific requests only
 */
export function userHasRequestForDataset(
  datasetId: bigint,
  activity: JobManagerActivity,
  userAddress: string | undefined
): boolean {
  if (!userAddress) return false;

  const datasetIdStr = datasetId.toString();
  const requests = activity.byDataset?.[datasetIdStr]?.requests ?? [];

  return requests.some(
    (request) =>
      request.buyer.toLowerCase() === userAddress.toLowerCase() &&
      (request.status === RequestStatus.PENDING ||
        request.status === RequestStatus.ACCEPTED)
  );
}

/**
 * Check if user is the dataset owner
 */
export function isDatasetOwner(
  datasetOwner: string,
  userAddress: string | undefined
): boolean {
  if (!userAddress) return false;
  return datasetOwner.toLowerCase() === userAddress.toLowerCase();
}

/**
 * Get all requests and jobs for a specific dataset
 * Uses precomputed byDataset map for O(1) lookup
 */
export function getDatasetActivity(
  datasetId: bigint,
  activity: JobManagerActivity
): { requests: JobRequest[]; jobs: JobData[] } {
  const datasetIdStr = datasetId.toString();
  const datasetActivity = activity.byDataset?.[datasetIdStr];

  return {
    requests: datasetActivity?.requests ?? [],
    jobs: datasetActivity?.jobs ?? [],
  };
}

/**
 * Truncate Ethereum address for display
 */
export function truncateAddress(
  address: string,
  startChars: number = 6,
  endChars: number = 4
): string {
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}
