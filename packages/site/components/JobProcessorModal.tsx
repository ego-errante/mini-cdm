"use client";

import { useState, useEffect } from "react";
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
import { EncryptedDataset, generateMerkleProof } from "@fhevm/shared";
import { ethers } from "ethers";

interface JobProcessorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: bigint;
  jobId: bigint;
  datasetId: bigint;
  totalRows: number;
  processedRows: number;
  onPushRow: (
    rowData: string,
    merkleProof: string[],
    rowIndex: number
  ) => Promise<void>;
  onFinalize: () => Promise<void>;
}

export function JobProcessorModal({
  open,
  onOpenChange,
  requestId,
  jobId,
  datasetId,
  totalRows,
  processedRows,
  onPushRow,
  onFinalize,
}: JobProcessorModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentRowIndex, setCurrentRowIndex] = useState(processedRows);
  const [encryptedDataset, setEncryptedDataset] =
    useState<EncryptedDataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load dataset from localStorage when modal opens
  useEffect(() => {
    if (open) {
      const dataset = loadEncryptedDatasetFromStorage(datasetId.toString());
      if (!dataset) {
        setError(`Dataset ${datasetId.toString()} not found in local storage`);
      } else {
        setEncryptedDataset(dataset);
        setCurrentRowIndex(processedRows);
      }
    }
  }, [open, datasetId, processedRows]);

  async function handleNextRow() {
    if (!encryptedDataset) {
      setError("Dataset not loaded");
      return;
    }

    if (currentRowIndex >= totalRows) {
      setError("All rows have been processed");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Get the row data for the current index
      const rowData = encryptedDataset.rows[currentRowIndex].encryptedData;

      // Generate merkle proof for this row
      const allRows = encryptedDataset.rows.map((r) => r.encryptedData);

      // Compute leaf hashes
      const leaves = allRows.map((row, index) =>
        ethers.keccak256(
          ethers.solidityPacked(
            ["uint256", "uint256", "bytes"],
            [datasetId, index, row]
          )
        )
      );

      const merkleProof = generateMerkleProof(leaves, currentRowIndex);

      // Push the row
      await onPushRow(rowData, merkleProof, currentRowIndex);

      // Increment row index
      setCurrentRowIndex((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to push row:", err);
      setError(err instanceof Error ? err.message : "Failed to push row");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleFinalize() {
    if (currentRowIndex < totalRows) {
      setError("Cannot finalize: not all rows have been processed");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      await onFinalize();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to finalize job:", err);
      setError(err instanceof Error ? err.message : "Failed to finalize job");
    } finally {
      setIsProcessing(false);
    }
  }

  const progress = totalRows > 0 ? (currentRowIndex / totalRows) * 100 : 0;
  const isComplete = currentRowIndex >= totalRows;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Processing Request #{requestId.toString()}</DialogTitle>
          <DialogDescription>
            Job ID: {jobId.toString()} | Dataset ID: {datasetId.toString()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Explanation */}
          <Alert>
            <AlertTitle>Job Processing</AlertTitle>
            <AlertDescription>
              Process each row of the dataset by clicking "Next Row". Once all
              rows are processed, click "Finalize" to complete the job and allow
              the buyer to retrieve the result.
            </AlertDescription>
          </Alert>

          {/* Progress Display */}
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

          {/* Dataset Status */}
          {!encryptedDataset && !error && (
            <Alert variant="destructive">
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                Dataset not found in local storage. Make sure you have the
                encrypted dataset available.
              </AlertDescription>
            </Alert>
          )}

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Completion Message */}
          {isComplete && (
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
            disabled={isProcessing}
          >
            Cancel
          </Button>
          {!isComplete ? (
            <Button
              onClick={handleNextRow}
              disabled={isProcessing || !encryptedDataset}
            >
              {isProcessing ? "Processing..." : "Next Row"}
            </Button>
          ) : (
            <Button onClick={handleFinalize} disabled={isProcessing}>
              {isProcessing ? "Finalizing..." : "Finalize Job"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
