"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadEncryptedDatasetFromStorage } from "@/lib/datasetUtils";
import { EncryptedDataset, JobRequest, RequestStatus } from "@fhevm/shared";
import { ethers } from "ethers";
import { useCDMContext } from "@/hooks/useCDMContext";
import { Loader2, DollarSign, AlertTriangle } from "lucide-react";
import { GasAllowanceMonitor } from "./GasAllowanceMonitor";

interface JobProcessorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: bigint;
  datasetId: bigint;
  requests: JobRequest[];
}

export function JobProcessorModal({
  open,
  onOpenChange,
  requestId,
  datasetId,
  requests,
}: JobProcessorModalProps) {
  const { jobManager } = useCDMContext();
  const pushRowMutation = jobManager.pushRowMutation;
  const finalizeJobMutation = jobManager.finalizeJobMutation;
  const requestPayoutMutation = jobManager.requestPayoutMutation;

  const [encryptedDataset, setEncryptedDataset] =
    useState<EncryptedDataset | null>(null);

  // Get the request by requestId
  const request = useMemo(() => {
    return requests.find((r) => r.requestId === requestId) || null;
  }, [requests, requestId]);

  // Get the matching job from the precomputed map - O(1) lookup
  const job = useMemo(() => {
    const activity = jobManager.getJobManagerActivity.data;
    if (!activity?.requestToJob) return null;
    return activity.requestToJob[requestId.toString()] || null;
  }, [jobManager.getJobManagerActivity.data, requestId]);

  // Derive job details from the matched job
  const jobId = job?.id ?? BigInt(0);
  const totalRows = job ? Number(job.progress.totalRows) : 0;
  const processedRows = job ? Number(job.progress.processedRows) : 0;

  const [currentRowIndex, setCurrentRowIndex] = useState(processedRows);

  // Update currentRowIndex when processedRows changes
  useEffect(() => {
    if (job) {
      setCurrentRowIndex(Number(job.progress.processedRows));
    }
  }, [job]);

  // Load dataset from localStorage when modal opens
  useEffect(() => {
    if (open) {
      const dataset = loadEncryptedDatasetFromStorage(datasetId.toString());
      setEncryptedDataset(dataset);
    }
  }, [open, datasetId]);

  function handleNextRow() {
    if (!encryptedDataset) {
      toast.error("Dataset not loaded");
      return;
    }

    if (currentRowIndex >= totalRows) {
      toast.error("All rows have been processed");
      return;
    }

    // Get the row data for the current index
    const rowData = encryptedDataset.rows[currentRowIndex].encryptedData;
    const merkleProof = encryptedDataset.proofs[currentRowIndex];

    // Push the row with success callback to increment index
    pushRowMutation.mutate(
      {
        jobId,
        rowData,
        merkleProof,
        rowIndex: currentRowIndex,
      },
      {
        onSuccess: () => {
          toast.success(`Row ${currentRowIndex} processed`);
          // Increment row index
          setCurrentRowIndex((prev) => prev + 1);
        },
        onError: (error) => {
          console.error("Failed to push row:", error);
          toast.error(
            error instanceof Error ? error.message : "Failed to push row"
          );
        },
      }
    );
  }

  function handleFinalize() {
    if (currentRowIndex < totalRows) {
      toast.error("Cannot finalize: not all rows have been processed");
      return;
    }

    finalizeJobMutation.mutate(jobId, {
      onSuccess: () => {
        toast.success("Job finalized successfully");
        onOpenChange(false);
      },
      onError: (error) => {
        console.error("Failed to finalize job:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to finalize job"
        );
      },
    });
  }

  function handleRequestPayout() {
    requestPayoutMutation.mutate(requestId, {
      onSuccess: () => {
        toast.success("Payout requested successfully");
      },
      onError: (error) => {
        console.error("Failed to request payout:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to request payout"
        );
      },
    });
  }

  const progress = totalRows > 0 ? (currentRowIndex / totalRows) * 100 : 0;
  const isComplete = currentRowIndex >= totalRows;
  const isJobAvailable = job !== null && jobId > BigInt(0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Processing Request #{requestId.toString()}</DialogTitle>
          <DialogDescription>
            {isJobAvailable ? (
              <>
                Job ID: {jobId.toString()} | Dataset ID: {datasetId.toString()}
              </>
            ) : (
              <>Dataset ID: {datasetId.toString()}</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-auto">
          {/* Job Loading State */}
          {!isJobAvailable && request?.status !== RequestStatus.REJECTED && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertTitle>Loading Job...</AlertTitle>
              <AlertDescription>
                Waiting for the job to be created. This should only take a
                moment.
              </AlertDescription>
            </Alert>
          )}

          {/* Request Cancelled/Rejected Alert */}
          {request?.status === RequestStatus.REJECTED && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Request Cancelled</AlertTitle>
              <AlertDescription>
                This request has been cancelled. The buyer may have cancelled it
                or reclaimed funds after the 24-hour timeout. Any gas costs you
                incurred should have been paid out.
              </AlertDescription>
            </Alert>
          )}

          {/* Explanation */}
          {isJobAvailable && request?.status !== RequestStatus.REJECTED && (
            <Alert>
              <AlertTitle>Job Processing</AlertTitle>
              <AlertDescription>
                Process each row of the dataset by clicking &quot;Next
                Row&quot;. Once all rows are processed, click
                &quot;Finalize&quot; to complete the job and allow the buyer to
                retrieve the result.
              </AlertDescription>
            </Alert>
          )}

          {/* Progress Display */}
          {isJobAvailable && request?.status !== RequestStatus.REJECTED && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Progress:</span>
                <span>
                  {currentRowIndex} / {totalRows} rows
                </span>
              </div>
              <Progress value={progress} className="w-full" />
              <p className="text-xs text-muted-foreground text-right">
                {progress.toFixed(1)}% complete
              </p>
            </div>
          )}

          {/* Gas Allowance Monitor (for seller to see buyer's allowance status) */}
          {isJobAvailable &&
            request &&
            job &&
            request.status !== RequestStatus.REJECTED && (
              <>
                <GasAllowanceMonitor
                  requestId={requestId}
                  showTopUpForm={false}
                />

                {/* Manual Payout Button for Seller */}
                {request.gasDebtToSeller > BigInt(0) && (
                  <Alert>
                    <DollarSign className="h-4 w-4" />
                    <AlertTitle>Gas Debt Owed</AlertTitle>
                    <AlertDescription>
                      <div className="space-y-2">
                        <p>
                          Accumulated gas debt:{" "}
                          <span className="font-mono font-semibold">
                            {ethers.formatEther(request.gasDebtToSeller)} ETH
                          </span>
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRequestPayout}
                          disabled={requestPayoutMutation.isPending}
                        >
                          {requestPayoutMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Requesting Payout...
                            </>
                          ) : (
                            <>
                              <DollarSign className="mr-2 h-4 w-4" />
                              Request Payout
                            </>
                          )}
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

          {/* Dataset Status */}
          {isJobAvailable &&
            !encryptedDataset &&
            request?.status !== RequestStatus.REJECTED && (
              <Alert variant="destructive">
                <AlertTitle>Warning</AlertTitle>
                <AlertDescription>
                  Dataset not found in local storage. Make sure you have the
                  encrypted dataset available.
                </AlertDescription>
              </Alert>
            )}

          {/* Push Row Error Display */}
          {pushRowMutation.isError &&
            request?.status !== RequestStatus.REJECTED && (
              <Alert variant="destructive" className="max-w-full overflow-auto">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  {pushRowMutation.error instanceof Error
                    ? pushRowMutation.error.message
                    : "Failed to push row"}
                </AlertDescription>
              </Alert>
            )}

          {/* Finalize Job Error Display */}
          {finalizeJobMutation.isError &&
            request?.status !== RequestStatus.REJECTED && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  {finalizeJobMutation.error instanceof Error
                    ? finalizeJobMutation.error.message
                    : "Failed to finalize job"}
                </AlertDescription>
              </Alert>
            )}

          {/* Completion Message */}
          {isJobAvailable &&
            isComplete &&
            request?.status !== RequestStatus.REJECTED && (
              <Alert>
                <AlertTitle>Ready to Finalize</AlertTitle>
                <AlertDescription>
                  All rows have been processed. Click &quot;Finalize Job&quot;
                  to complete the job execution.
                </AlertDescription>
              </Alert>
            )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={
              pushRowMutation.isPending || finalizeJobMutation.isPending
            }
          >
            {isJobAvailable && request?.status !== RequestStatus.REJECTED
              ? "Cancel"
              : "Close"}
          </Button>
          {isJobAvailable &&
            !isComplete &&
            request?.status !== RequestStatus.REJECTED && (
              <Button
                onClick={handleNextRow}
                disabled={pushRowMutation.isPending || !encryptedDataset}
              >
                {pushRowMutation.isPending ? "Processing..." : "Next Row"}
              </Button>
            )}
          {isJobAvailable &&
            isComplete &&
            request?.status !== RequestStatus.REJECTED && (
              <Button
                onClick={handleFinalize}
                disabled={finalizeJobMutation.isPending}
              >
                {finalizeJobMutation.isPending
                  ? "Finalizing..."
                  : "Finalize Job"}
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
