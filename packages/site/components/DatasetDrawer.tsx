"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Trash2, Copy } from "lucide-react";
import { ActivityTable } from "./ActivityTable";
import { NewRequestModal } from "./NewRequestModal";
import { JobProcessorModal } from "./JobProcessorModal";
import { ConfirmationModal } from "./ConfirmationModal";
import { truncateAddress } from "@/lib/datasetHelpers";
import { JobData, JobRequest } from "@fhevm/shared";
import { useCDMContext } from "@/hooks/useCDMContext";

interface DatasetDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: {
    id: bigint;
    owner: string;
    rowCount: number;
    numColumns: number;
    merkleRoot: string;
    kAnonymity: number;
    cooldownSec: number;
  };
  activity: {
    requests: JobRequest[];
    jobs: JobData[];
  };
  isOwner: boolean;
  currentUserAddress: string | undefined;
}

export function DatasetDrawer({
  open,
  onOpenChange,
  dataset,
  activity,
  isOwner,
  currentUserAddress,
}: DatasetDrawerProps) {
  const { datasetRegistry, jobManager } = useCDMContext();

  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [processingJob, setProcessingJob] = useState<{
    requestId: bigint;
    jobId: bigint;
    totalRows: number;
    processedRows: number;
  } | null>(null);

  async function handleDeleteDataset(datasetId: bigint) {
    try {
      await datasetRegistry.deleteDatasetMutation.mutateAsync(datasetId);
      toast.success("Dataset deleted successfully");
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to delete dataset:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete dataset"
      );
    }
  }

  async function handleSubmitRequest(params: any) {
    try {
      await jobManager.submitRequestMutation.mutateAsync(params);
      toast.success("Request submitted successfully");
    } catch (error) {
      console.error("Failed to submit request:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to submit request"
      );
    }
  }

  async function handleAcceptRequest(requestId: bigint) {
    try {
      await jobManager.acceptRequestMutation.mutateAsync(requestId);
      toast.success("Request accepted");

      // After accepting, find the corresponding job and open processor modal
      const request = activity.requests.find(
        (r, idx) => BigInt(idx + 1) === requestId
      );
      if (request && request.jobId > BigInt(0)) {
        const job = activity.jobs.find((j) => j.id === request.jobId);
        if (job) {
          setProcessingJob({
            requestId,
            jobId: request.jobId,
            totalRows: Number(job.progress.totalRows),
            processedRows: Number(job.progress.processedRows),
          });
        }
      }
    } catch (error) {
      console.error("Failed to accept request:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to accept request"
      );
    }
  }

  async function handleRejectRequest(requestId: bigint) {
    try {
      await jobManager.rejectRequestMutation.mutateAsync(requestId);
      toast.success("Request rejected");
    } catch (error) {
      console.error("Failed to reject request:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to reject request"
      );
    }
  }

  async function handleCancelRequest(requestId: bigint) {
    try {
      await jobManager.cancelRequestMutation.mutateAsync(requestId);
      toast.success("Request cancelled");
    } catch (error) {
      console.error("Failed to cancel request:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to cancel request"
      );
    }
  }

  async function handlePushRow(
    jobId: bigint,
    rowData: string,
    merkleProof: string[],
    rowIndex: number
  ) {
    try {
      await jobManager.pushRowMutation.mutateAsync({
        jobId,
        rowData,
        merkleProof,
        rowIndex,
      });
      toast.success(`Row ${rowIndex} processed`);
    } catch (error) {
      console.error("Failed to push row:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to push row"
      );
      throw error; // Re-throw to let modal handle it
    }
  }

  async function handleFinalizeJob(jobId: bigint) {
    try {
      await jobManager.finalizeJobMutation.mutateAsync(jobId);
      toast.success("Job finalized successfully");
    } catch (error) {
      console.error("Failed to finalize job:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to finalize job"
      );
      throw error; // Re-throw to let modal handle it
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-1/2 min-w-[500px] overflow-y-auto"
        >
          <SheetHeader>
            <div>
              <div className="flex items-center gap-2">
                <SheetTitle>
                  Dataset #{truncateAddress(dataset.id.toString(), 6)}
                </SheetTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    navigator.clipboard.writeText(dataset.id.toString());
                    toast.success("Dataset ID copied to clipboard");
                  }}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <SheetDescription>
                  Owner: {truncateAddress(dataset.owner)}
                </SheetDescription>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    navigator.clipboard.writeText(dataset.owner);
                    toast.success("Owner address copied to clipboard");
                  }}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </SheetHeader>

          {/* Delete Button */}
          {isOwner && (
            <div className="mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteModal(true)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Dataset
              </Button>
            </div>
          )}

          <div className="mt-6 space-y-6">
            {/* Dataset Summary */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Dataset Summary</h3>
              <div className="space-y-2 text-sm">
                {isOwner && (
                  <div className="mb-2">
                    <Badge variant="secondary">You are the owner</Badge>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rows:</span>
                  <span>{dataset.rowCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Columns:</span>
                  <span>{dataset.numColumns}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">K-Anonymity:</span>
                  <span>{dataset.kAnonymity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cooldown:</span>
                  <span>{dataset.cooldownSec}s</span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-muted-foreground">Merkle Root:</span>
                  <span className="font-mono text-xs text-right break-all max-w-[300px]">
                    {dataset.merkleRoot}
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Activity Summary */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Activity Summary</h3>
                {!isOwner && (
                  <Button
                    size="sm"
                    onClick={() => setShowNewRequestModal(true)}
                  >
                    New Request
                  </Button>
                )}
              </div>

              <ActivityTable
                requests={activity.requests}
                jobs={activity.jobs}
                isOwner={isOwner}
                currentUserAddress={currentUserAddress}
                onAcceptRequest={handleAcceptRequest}
                onRejectRequest={handleRejectRequest}
                onCancelRequest={handleCancelRequest}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        title="Delete Dataset"
        description="Are you sure you want to delete this dataset? This action cannot be undone and all associated data will be lost."
        onConfirm={async () => {
          await handleDeleteDataset(dataset.id);
        }}
        confirmText="Delete"
        variant="destructive"
      />

      {/* Job Processor Modal */}
      {processingJob && (
        <JobProcessorModal
          open={!!processingJob}
          onOpenChange={(open) => !open && setProcessingJob(null)}
          requestId={processingJob.requestId}
          jobId={processingJob.jobId}
          datasetId={dataset.id}
          totalRows={processingJob.totalRows}
          processedRows={processingJob.processedRows}
          onPushRow={(rowData, merkleProof, rowIndex) =>
            handlePushRow(processingJob.jobId, rowData, merkleProof, rowIndex)
          }
          onFinalize={() => handleFinalizeJob(processingJob.jobId)}
        />
      )}

      {/* New Request Modal */}
      <NewRequestModal
        open={showNewRequestModal}
        onOpenChange={setShowNewRequestModal}
        datasetId={dataset.id}
        datasetRowCount={dataset.rowCount}
        datasetNumColumns={dataset.numColumns}
        onSubmit={handleSubmitRequest}
      />
    </>
  );
}
