"use client";

import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";
import { JobData, JobRequest, Op } from "@fhevm/shared";
import { FhevmDecryptionSignature } from "@fhevm/react";
import { useCDMContext } from "@/hooks/useCDMContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, AlertTriangle, CopyIcon } from "lucide-react";
import { truncateAddress } from "@/lib/datasetHelpers";
import { toast } from "sonner";

interface ViewResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: JobRequest | undefined;
  job: JobData | undefined;
}

interface DecryptedResult {
  result: bigint;
  isOverflow: boolean;
}

export function ViewResultModal({
  open,
  onOpenChange,
  request,
  job,
}: ViewResultModalProps) {
  const {
    fhevmInstance,
    fhevmDecryptionSignatureStorage,
    ethersSigner,
    jobManager,
  } = useCDMContext();

  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedResult, setDecryptedResult] = useState<
    DecryptedResult | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  // Reset state when modal opens/closes or job changes
  useEffect(() => {
    if (!open) {
      setDecryptedResult(undefined);
      setError(undefined);
      setIsDecrypting(false);
    }
  }, [open, job?.id]);

  const decryptResult = useCallback(async () => {
    if (
      !job?.result ||
      !fhevmInstance ||
      !ethersSigner ||
      !jobManager.contractAddress
    ) {
      setError("Missing required data for decryption");
      return;
    }

    setIsDecrypting(true);
    setError(undefined);

    try {
      // Load or create decryption signature
      const sig = await FhevmDecryptionSignature.loadOrSign(
        fhevmInstance,
        [jobManager.contractAddress as `0x${string}`],
        ethersSigner,
        fhevmDecryptionSignatureStorage
      );

      if (!sig) {
        throw new Error("Unable to build FHEVM decryption signature");
      }

      // Decrypt both result and overflow flag
      const decrypted = await fhevmInstance.userDecrypt(
        [
          {
            handle: job.result.result,
            contractAddress: jobManager.contractAddress,
          },
          {
            handle: job.result.isOverflow,
            contractAddress: jobManager.contractAddress,
          },
        ],
        sig.privateKey,
        sig.publicKey,
        sig.signature,
        sig.contractAddresses,
        sig.userAddress,
        sig.startTimestamp,
        sig.durationDays
      );

      setDecryptedResult({
        result: BigInt(decrypted[job.result.result]),
        isOverflow: Boolean(decrypted[job.result.isOverflow]),
      });
    } catch (err) {
      console.error("Decryption error:", err);
      setError(err instanceof Error ? err.message : "Failed to decrypt result");
    } finally {
      setIsDecrypting(false);
    }
  }, [
    job?.result,
    fhevmInstance,
    ethersSigner,
    fhevmDecryptionSignatureStorage,
    jobManager.contractAddress,
  ]);

  function formatJobParams(params: JobRequest["params"]) {
    const opLabels: Record<Op, string> = {
      [Op.COUNT]: "Count",
      [Op.SUM]: "Sum",
      [Op.AVG_P]: "Average (Predetermined Divisor)",
      [Op.WEIGHTED_SUM]: "Weighted Sum",
      [Op.MIN]: "Minimum",
      [Op.MAX]: "Maximum",
    };

    const items: Array<{ label: string; value: string | number | bigint }> = [
      { label: "Operation", value: opLabels[params.op] },
    ];

    // Add operation-specific fields
    if (
      params.op === Op.SUM ||
      params.op === Op.AVG_P ||
      params.op === Op.MIN ||
      params.op === Op.MAX
    ) {
      items.push({ label: "Target Field", value: params.targetField });
    }

    if (params.op === Op.AVG_P && params.divisor > 0) {
      items.push({ label: "Divisor", value: params.divisor });
    }

    if (params.op === Op.WEIGHTED_SUM && params.weights.length > 0) {
      items.push({
        label: "Weights",
        value: `[${params.weights.join(", ")}]`,
      });
    }

    // Post-processing parameters
    if (params.clampMin > BigInt(0) || params.clampMax > BigInt(0)) {
      items.push({
        label: "Clamp Range",
        value: `${params.clampMin} - ${params.clampMax}`,
      });
    }

    if (params.roundBucket > 0) {
      items.push({ label: "Round Bucket", value: params.roundBucket });
    }

    // Filter info
    if (params.filter.bytecode && params.filter.bytecode !== "0x") {
      items.push({
        label: "Filter",
        value: `${params.filter.bytecode.length / 2 - 1} bytes`,
      });
      if (params.filter.consts.length > 0) {
        items.push({
          label: "Filter Constants",
          value: params.filter.consts.length,
        });
      }
    }

    return items;
  }

  const canDecrypt =
    job?.result?.isFinalized &&
    fhevmInstance &&
    ethersSigner &&
    jobManager.contractAddress;

  // Check if result indicates k-anonymity failure (sentinel value: uint128.max)
  const K_ANONYMITY_SENTINEL = BigInt(2) ** BigInt(128) - BigInt(1);
  const isKAnonymityFailure =
    decryptedResult && decryptedResult.result === K_ANONYMITY_SENTINEL;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job Result</DialogTitle>
          <DialogDescription>
            View decrypted job result and parameters
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Job Info Section */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Job Information
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Job ID:</span>{" "}
                <span className="font-mono">#{job?.jobId.toString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Request ID:</span>{" "}
                <span className="font-mono">
                  #{request?.requestId.toString()}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Dataset ID:</span>{" "}
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    #{truncateAddress(job?.datasetId.toString() || "", 6)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        job?.datasetId.toString() || ""
                      );
                      toast.success("Dataset ID copied to clipboard");
                    }}
                  >
                    <CopyIcon size={16} />
                  </Button>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>{" "}
                <Badge variant="default">Completed</Badge>
              </div>
            </div>
          </div>

          {/* Progress Section */}
          {job?.progress && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Progress
              </h3>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Rows:</span>{" "}
                  <span className="font-semibold">
                    {job.progress.totalRows.toString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Processed:</span>{" "}
                  <span className="font-semibold">
                    {job.progress.processedRows.toString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Remaining:</span>{" "}
                  <span className="font-semibold">
                    {job.progress.remainingRows.toString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Job Parameters Section */}
          {request && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Job Parameters
              </h3>
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                {formatJobParams(request.params).map((item, index) => (
                  <div key={index} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}:</span>
                    <span className="font-mono font-medium">
                      {item.value.toString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Encrypted Result
            </h3>

            {!decryptedResult && !error && (
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <Button
                  onClick={decryptResult}
                  disabled={!canDecrypt || isDecrypting}
                  className="w-full"
                >
                  {isDecrypting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Decrypting...
                    </>
                  ) : (
                    <>
                      <Eye className="mr-2 h-4 w-4" />
                      Decrypt Result
                    </>
                  )}
                </Button>
                {!canDecrypt && !isDecrypting && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Connect your wallet to decrypt
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={decryptResult}
                  className="mt-2"
                >
                  Try Again
                </Button>
              </div>
            )}

            {decryptedResult && (
              <div className="space-y-3">
                {isKAnonymityFailure ? (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
                      <div>
                        <p className="font-semibold text-yellow-700 dark:text-yellow-400">
                          K-Anonymity Requirement Not Met
                        </p>
                        <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-1">
                          The result was suppressed because the query did not
                          meet the dataset&apos;s k-anonymity threshold.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                      <p className="text-sm text-muted-foreground mb-1">
                        Decrypted Result:
                      </p>
                      <p className="text-2xl font-bold font-mono">
                        {decryptedResult.result.toString()}
                      </p>
                    </div>

                    {decryptedResult.isOverflow && (
                      <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-orange-500" />
                          <p className="text-sm text-orange-700 dark:text-orange-400">
                            Overflow detected during computation. Result may be
                            inaccurate.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
