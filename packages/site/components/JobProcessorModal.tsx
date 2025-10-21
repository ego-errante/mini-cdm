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
import {
  EncryptedDataset,
  generateMerkleProof,
  JobData,
  JobRequest,
  RequestStatus,
} from "@fhevm/shared";
import { ethers } from "ethers";
import { useCDMContext } from "@/hooks/useCDMContext";
import { Loader2 } from "lucide-react";
import { GasAllowanceMonitor } from "./GasAllowanceMonitor";

interface JobProcessorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: bigint;
  datasetId: bigint;
  requests: JobRequest[];
  jobs: JobData[];
}

export function JobProcessorModal({
  open,
  onOpenChange,
  requestId,
  datasetId,
  requests,
  jobs,
}: JobProcessorModalProps) {
  const { jobManager } = useCDMContext();
  const pushRowMutation = jobManager.pushRowMutation;
  const finalizeJobMutation = jobManager.finalizeJobMutation;

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
          {!isJobAvailable && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertTitle>Loading Job...</AlertTitle>
              <AlertDescription>
                Waiting for the job to be created. This should only take a
                moment.
              </AlertDescription>
            </Alert>
          )}

          {/* Explanation */}
          {isJobAvailable && (
            <Alert>
              <AlertTitle>Job Processing</AlertTitle>
              <AlertDescription>
                Process each row of the dataset by clicking "Next Row". Once all
                rows are processed, click "Finalize" to complete the job and
                allow the buyer to retrieve the result.
              </AlertDescription>
            </Alert>
          )}

          {/* Progress Display */}
          {isJobAvailable && (
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
          {isJobAvailable && request && job && (
            <GasAllowanceMonitor requestId={requestId} showTopUpForm={false} />
          )}

          {/* Dataset Status */}
          {isJobAvailable && !encryptedDataset && (
            <Alert variant="destructive">
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                Dataset not found in local storage. Make sure you have the
                encrypted dataset available.
              </AlertDescription>
            </Alert>
          )}

          {/* Push Row Error Display */}
          {pushRowMutation.isError && (
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
          {finalizeJobMutation.isError && (
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
          {isJobAvailable && isComplete && (
            <Alert>
              <AlertTitle>Ready to Finalize</AlertTitle>
              <AlertDescription>
                All rows have been processed. Click "Finalize Job" to complete
                the job execution.
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
            {isJobAvailable ? "Cancel" : "Close"}
          </Button>
          {isJobAvailable && !isComplete && (
            <Button
              onClick={handleNextRow}
              disabled={pushRowMutation.isPending || !encryptedDataset}
            >
              {pushRowMutation.isPending ? "Processing..." : "Next Row"}
            </Button>
          )}
          {isJobAvailable && isComplete && (
            <Button
              onClick={handleFinalize}
              disabled={finalizeJobMutation.isPending}
            >
              {finalizeJobMutation.isPending ? "Finalizing..." : "Finalize Job"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
