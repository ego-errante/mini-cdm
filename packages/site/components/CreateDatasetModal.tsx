"use client";

import { useState } from "react";
import { ethers } from "ethers";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { FhevmInstance } from "@fhevm/react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  processDatasetFile,
  saveEncryptedDatasetToStorage,
  type ParsedDataset,
} from "@/lib/datasetUtils";
import {
  createPackedEncryptedRow,
  parseRowToColumnConfigs,
  generateMerkleTreeFromRows,
  type EncryptedRow,
  type EncryptedDataset,
} from "@fhevm/shared";
import { uuidToUint256 } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useCDMContext } from "@/hooks/useCDMContext";

interface CreateDatasetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface DatasetFormValues {
  kAnonymity: number;
  cooldownSec: number;
}

export function CreateDatasetModal({
  open,
  onOpenChange,
  onSuccess,
}: CreateDatasetModalProps) {
  // Initialize form
  const form = useForm<DatasetFormValues>({
    defaultValues: {
      kAnonymity: 0,
      cooldownSec: 0,
    },
  });

  // Hooks
  const queryClient = useQueryClient();
  const { datasetRegistry, jobManager, fhevmInstance, ethersSigner } =
    useCDMContext();
  const { commitDatasetMutation, getDatasetsQuery } = datasetRegistry;

  // Encryption state
  const [encryptionProgress, setEncryptionProgress] = useState({
    current: 0,
    total: 0,
  });
  const [dataOwnershipConfirmed, setDataOwnershipConfirmed] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // File processing mutation
  const processFileMutation = useMutation({
    mutationFn: async (file: File) => {
      return await processDatasetFile(file);
    },
    onError: (err) => {
      console.error("File processing error:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to process file"
      );
    },
  });

  // File upload handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    // Clear previous encryption data when selecting a new file
    encryptDatasetMutation.reset();
    setDataOwnershipConfirmed(false);
    setEncryptionProgress({ current: 0, total: 0 });

    processFileMutation.mutate(selectedFile);
  };

  // Encryption mutation
  const encryptDatasetMutation = useMutation({
    mutationFn: async () => {
      if (
        !processFileMutation.data ||
        !fhevmInstance ||
        !datasetRegistry.contractAddress ||
        !jobManager.contractAddress ||
        !ethersSigner
      ) {
        throw new Error("Missing required data for encryption");
      }

      // Generate dataset ID
      const uuid = crypto.randomUUID();
      const id = uuidToUint256(uuid);

      const encryptedRows: EncryptedRow[] = [];
      const userAddress = await ethersSigner.getAddress();

      // Encrypt each row progressively.
      for (let i = 0; i < processFileMutation.data.rows.length; i++) {
        const rowData = processFileMutation.data.rows[i];
        const columnConfigs = parseRowToColumnConfigs(rowData);

        const encryptedData = await createPackedEncryptedRow(
          jobManager.contractAddress,
          userAddress,
          fhevmInstance,
          columnConfigs
        );

        encryptedRows.push({ rowIndex: i, encryptedData });

        // Update progress
        setEncryptionProgress({
          current: i + 1,
          total: processFileMutation.data.rows.length,
        });
      }

      // Compute merkle root from encrypted rows
      const rowStrings = encryptedRows.map((r) => r.encryptedData);
      const { root, proofs } = generateMerkleTreeFromRows(rowStrings, id);

      const encryptedDataset: EncryptedDataset = {
        datasetId: id.toString(),
        rows: encryptedRows,
        proofs,
        numColumns: processFileMutation.data.numColumns,
        rowCount: processFileMutation.data.rowCount,
        merkleRoot: root,
      };

      // Save to localStorage
      saveEncryptedDatasetToStorage(encryptedDataset);

      return encryptedDataset;
    },
    onError: (err) => {
      console.error(err);
      setError(err instanceof Error ? err.message : "Encryption failed");
    },
  });

  // Download encrypted rows
  const handleDownloadEncryptedRows = () => {
    if (!encryptDatasetMutation.data) return;

    const data = JSON.stringify(encryptDatasetMutation.data.rows, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `encrypted-dataset-${encryptDatasetMutation.data.datasetId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Submit handler
  const handleSubmit = async (values: DatasetFormValues) => {
    if (!encryptDatasetMutation.data) {
      toast.error("No encrypted dataset available");
      return;
    }

    try {
      await commitDatasetMutation.mutateAsync({
        datasetId: BigInt(encryptDatasetMutation.data.datasetId),
        rowCount: encryptDatasetMutation.data.rowCount,
        merkleRoot: encryptDatasetMutation.data.merkleRoot,
        numColumns: encryptDatasetMutation.data.numColumns,
        kAnonymity: values.kAnonymity,
        cooldownSec: values.cooldownSec,
      });

      // Invalidate and refetch datasets query
      await queryClient.invalidateQueries({
        queryKey: ["datasets"],
      });

      // Clear form
      form.reset();
      setEncryptionProgress({ current: 0, total: 0 });
      setDataOwnershipConfirmed(false);

      // Clear mutation data
      encryptDatasetMutation.reset();
      processFileMutation.reset();

      // Close modal and call success callback
      onOpenChange(false);
      onSuccess?.();

      toast.success("Dataset created successfully!");
    } catch (error) {
      console.error("Failed to create dataset:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create dataset"
      );
    }
  };

  // Validation
  const isValid =
    (encryptDatasetMutation.data?.rows.length ?? 0) > 0 &&
    encryptDatasetMutation.data?.merkleRoot &&
    encryptDatasetMutation.data?.merkleRoot !== ethers.ZeroHash &&
    dataOwnershipConfirmed &&
    !encryptDatasetMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Dataset</DialogTitle>
          <DialogDescription>
            Upload a CSV or JSON file, encrypt it with FHE, and prepare for
            on-chain registration.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="grid gap-4 py-4">
              {/* Section 1: File Upload */}
              <div className="grid gap-2">
                <Label htmlFor="file">Dataset File (CSV or JSON)</Label>
                <Input
                  id="file"
                  type="file"
                  accept=".csv,.json"
                  onChange={handleFileChange}
                  disabled={
                    processFileMutation.isPending ||
                    encryptDatasetMutation.isPending
                  }
                />
                {processFileMutation.isPending && (
                  <p className="text-sm text-muted-foreground">
                    Processing file...
                  </p>
                )}
              </div>

              {/* Display parsed data info */}
              {processFileMutation.data && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Rows</Label>
                      <Input
                        value={processFileMutation.data.rowCount}
                        readOnly
                        className="bg-muted"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Columns</Label>
                      <Input
                        value={processFileMutation.data.numColumns}
                        readOnly
                        className="bg-muted"
                      />
                    </div>
                  </div>

                  {/* Section 2: Configuration */}
                  <FormField
                    control={form.control}
                    name="kAnonymity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>K-Anonymity Level</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="0"
                            placeholder="Enter k-anonymity level (e.g., 5)"
                            disabled={encryptDatasetMutation.isPending}
                            onChange={(e) =>
                              field.onChange(Number(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          Minimum number of records that must match on
                          quasi-identifiers
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="cooldownSec"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cooldown Period (seconds)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="0"
                            placeholder="0"
                            disabled={encryptDatasetMutation.isPending}
                            onChange={(e) =>
                              field.onChange(Number(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          Time to wait before allowing access to the dataset
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Section 3: Encryption & Processing */}
                  {!(encryptDatasetMutation.data?.rows.length ?? 0) && (
                    <Button
                      type="button"
                      onClick={() => encryptDatasetMutation.mutate()}
                      disabled={
                        encryptDatasetMutation.isPending ||
                        !fhevmInstance ||
                        !datasetRegistry.contractAddress ||
                        !jobManager.contractAddress ||
                        !ethersSigner
                      }
                      className="w-full"
                      loading={encryptDatasetMutation.isPending}
                    >
                      {encryptDatasetMutation.isPending
                        ? "Processing..."
                        : "Process Dataset"}
                    </Button>
                  )}

                  {/* Progress Bar */}
                  {encryptDatasetMutation.isPending && (
                    <div className="grid gap-2">
                      <Label>Encryption Progress</Label>
                      <Progress
                        value={
                          (encryptionProgress.current /
                            encryptionProgress.total) *
                          100
                        }
                      />
                      <p className="text-sm text-muted-foreground">
                        {encryptionProgress.current} /{" "}
                        {encryptionProgress.total} rows encrypted
                      </p>
                    </div>
                  )}

                  {/* Dataset ID (shown after encryption starts) */}
                  {encryptDatasetMutation.data?.datasetId && (
                    <div className="grid gap-2">
                      <Label htmlFor="datasetId">
                        Dataset ID (auto-generated)
                      </Label>
                      <Input
                        id="datasetId"
                        value={encryptDatasetMutation.data.datasetId}
                        readOnly
                        className="bg-muted font-mono text-xs"
                      />
                    </div>
                  )}

                  {/* Section 4: Data Ownership Alert */}
                  {(encryptDatasetMutation.data?.rows.length ?? 0) > 0 &&
                    !dataOwnershipConfirmed && (
                      <Alert>
                        <AlertTitle>Your Data Ownership</AlertTitle>
                        <AlertDescription>
                          The encrypted dataset is persisted in your
                          browser&apos;s localStorage for convenience. However,
                          YOU own this encrypted data. We recommend downloading
                          it as a backup. We do not store this data on our
                          servers.
                        </AlertDescription>
                        <div className="mt-4 flex gap-2">
                          <Button
                            onClick={handleDownloadEncryptedRows}
                            variant="outline"
                            size="sm"
                          >
                            Download Encrypted Data
                          </Button>
                          <Button
                            onClick={() => setDataOwnershipConfirmed(true)}
                            size="sm"
                          >
                            Got it
                          </Button>
                        </div>
                      </Alert>
                    )}

                  {/* Section 5: Merkle Root (bottom of form) */}
                  {encryptDatasetMutation.data?.merkleRoot &&
                    dataOwnershipConfirmed && (
                      <div className="grid gap-2">
                        <Label>Merkle Root</Label>
                        <Input
                          value={encryptDatasetMutation.data.merkleRoot}
                          readOnly
                          className="bg-muted font-mono text-xs"
                        />
                        <p className="text-xs text-muted-foreground">
                          Computed from encrypted data
                        </p>
                      </div>
                    )}
                </>
              )}

              {/* Error message */}
              {error && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={encryptDatasetMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!isValid}>
                Create Dataset
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
