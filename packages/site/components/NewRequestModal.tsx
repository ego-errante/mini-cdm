"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewRequestForm } from "./NewRequestForm";

interface NewRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: bigint;
  datasetRowCount: number;
  datasetNumColumns: number;
  onSubmit: (params: {
    datasetId: bigint;
    baseFee: bigint;
    computeAllowance: bigint;
    jobParams: {
      op: any;
      targetField: number;
      weights: number[];
      divisor: number;
      clampMin: bigint;
      clampMax: bigint;
      roundBucket: number;
      filter: {
        bytecode: string;
        consts: bigint[];
      };
    };
  }) => Promise<void>;
}

export function NewRequestModal({
  open,
  onOpenChange,
  datasetId,
  datasetRowCount,
  datasetNumColumns,
  onSubmit,
}: NewRequestModalProps) {
  function handleSubmit(params: any) {
    onSubmit(params);
    onOpenChange(false);
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
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
