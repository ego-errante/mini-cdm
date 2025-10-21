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
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [acceptedRequestId, setAcceptedRequestId] = useState<bigint | null>(
    null
  );

  function handleRequestAccepted(requestId: bigint) {
    // Open the job processor modal with the accepted request ID
    // The modal will declaratively find and match the job when it becomes available
    setAcceptedRequestId(requestId);
  }

  function handleProcessJob(requestId: bigint) {
    // Open the job processor modal for processing an accepted job
    setAcceptedRequestId(requestId);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full md:min-w-[70vw] overflow-y-auto"
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
                onRequestAccepted={handleRequestAccepted}
                onProcessJob={handleProcessJob}
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
        onConfirm={async () => {}}
        confirmText="Delete"
        variant="destructive"
        datasetId={dataset.id}
      />

      {/* Job Processor Modal */}
      {acceptedRequestId !== null && (
        <JobProcessorModal
          open={acceptedRequestId !== null}
          onOpenChange={(open) => !open && setAcceptedRequestId(null)}
          requestId={acceptedRequestId}
          datasetId={dataset.id}
          requests={activity.requests}
          jobs={activity.jobs}
        />
      )}

      {/* New Request Modal */}
      <NewRequestModal
        open={showNewRequestModal}
        onOpenChange={setShowNewRequestModal}
        datasetId={dataset.id}
        datasetRowCount={dataset.rowCount}
        datasetNumColumns={dataset.numColumns}
      />
    </>
  );
}
