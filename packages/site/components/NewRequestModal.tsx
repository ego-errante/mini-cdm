"use client";

import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewRequestForm } from "./NewRequestForm";
import { useCDMContext } from "@/hooks/useCDMContext";

interface NewRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: bigint;
  datasetRowCount: number;
  datasetNumColumns: number;
}

export function NewRequestModal({
  open,
  onOpenChange,
  datasetId,
  datasetRowCount,
  datasetNumColumns,
}: NewRequestModalProps) {
  const { jobManager } = useCDMContext();
  const submitMutation = jobManager.submitRequestMutation;

  function handleSubmitRequest(params: any): Promise<void> {
    return new Promise((resolve, reject) => {
      submitMutation.mutate(params, {
        onSuccess: () => {
          toast.success("Request submitted successfully");
          onOpenChange(false);
          resolve();
        },
        onError: (error) => {
          console.error("Failed to submit request:", error);
          toast.error(
            error instanceof Error ? error.message : "Failed to submit request"
          );
          reject(error);
        },
      });
    });
  }

  function handleCancel() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit New Request</DialogTitle>
          <DialogDescription>
            Create a new computation request for this dataset. Fill out the form
            below to specify the operation and parameters.
          </DialogDescription>
        </DialogHeader>
        <NewRequestForm
          datasetId={datasetId}
          datasetRowCount={datasetRowCount}
          datasetNumColumns={datasetNumColumns}
          onSubmit={handleSubmitRequest}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
