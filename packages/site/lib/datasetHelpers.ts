import {
  JobData,
  JobRequest,
  JobManagerActivity,
  RequestStatus,
} from "@fhevm/shared";

/**
 * Count jobs for a specific dataset
 */
export function getDatasetJobCount(datasetId: bigint, jobs: JobData[]): number {
  return jobs.filter((job) => job.datasetId === datasetId).length;
}

/**
 * Count requests for a specific dataset
 */
export function getDatasetRequestCount(
  datasetId: bigint,
  requests: JobRequest[]
): number {
  return requests.filter((request) => request.datasetId === datasetId).length;
}

/**
 * Check if user has a pending or accepted request for a dataset
 */
export function userHasRequestForDataset(
  datasetId: bigint,
  requests: JobRequest[],
  userAddress: string | undefined
): boolean {
  if (!userAddress) return false;

  return requests.some(
    (request) =>
      request.datasetId === datasetId &&
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
 */
export function getDatasetActivity(
  datasetId: bigint,
  activity: JobManagerActivity
): { requests: JobRequest[]; jobs: JobData[] } {
  const requests = activity.requests.filter(
    (request) => request.datasetId === datasetId
  );
  const jobs = activity.jobs.filter((job) => job.datasetId === datasetId);

  return { requests, jobs };
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
