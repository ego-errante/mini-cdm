"use client";

import { useEffect, useState } from "react";
import { JobData, JobRequest, Op, RequestStatus } from "@fhevm/shared";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2,
  Eye,
  AlertTriangle,
  CopyIcon,
  Info,
  Clock,
} from "lucide-react";
import { truncateAddress } from "@/lib/datasetHelpers";
import { toast } from "sonner";
import { GasAllowanceMonitor } from "./GasAllowanceMonitor";
import { useMutation } from "@tanstack/react-query";

interface ViewResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: JobRequest | undefined;
  job: JobData | undefined;
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

  const reclaimStalledMutation = jobManager.reclaimStalledMutation;

  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));

  // Update current time every second to show accurate countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Check if job is stalled (24 hours = 86400 seconds)
  const STALL_TIMEOUT = 86400;
  const isStalled =
    request?.status === RequestStatus.ACCEPTED &&
    request?.timestamp !== undefined &&
    currentTime > Number(request.timestamp) + STALL_TIMEOUT;

  const timeUntilStalled =
    request?.status === RequestStatus.ACCEPTED &&
    request?.timestamp !== undefined
      ? Math.max(0, Number(request.timestamp) + STALL_TIMEOUT - currentTime)
      : 0;

  function handleReclaimStalled() {
    if (!request) return;

    reclaimStalledMutation.mutate(request.requestId, {
      onSuccess: () => {
        toast.success("Funds reclaimed successfully");
        onOpenChange(false);
      },
      onError: (error) => {
        console.error("Failed to reclaim stalled funds:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to reclaim funds"
        );
      },
    });
  }

  const decryptMutation = useMutation({
    mutationFn: async () => {
      if (
        !job?.result ||
        !fhevmInstance ||
        !ethersSigner ||
        !jobManager.contractAddress
      ) {
        throw new Error("Missing required data for decryption");
      }

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

      return {
        result: BigInt(decrypted[job.result.result]),
        isOverflow: Boolean(decrypted[job.result.isOverflow]),
      };
    },
    onError: (error) => {
      console.error("Decryption error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to decrypt result"
      );
    },
  });

  // Reset mutation when modal closes or job result changes
  useEffect(() => {
    if (!open) {
      decryptMutation.reset();
    }
  }, [open, job?.id, job?.result, decryptMutation]);

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
      const dsl = bytecodeToDSL(
        params.filter.bytecode,
        params.filter.consts.map((c) => Number(c))
      );
      items.push({
        label: "Filter DSL",
        value: dsl,
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

  // Filter DSL bytecode opcodes (reverse mapping)
  const reverseOpcodes: Record<number, string> = {
    0x01: "PUSH_FIELD",
    0x02: "PUSH_CONST",
    0x10: "GT",
    0x11: "GE",
    0x12: "LT",
    0x13: "LE",
    0x14: "EQ",
    0x15: "NE",
    0x20: "AND",
    0x21: "OR",
    0x22: "NOT",
  };

  type FilterDSL =
    | ["GT" | "GE" | "LT" | "LE" | "EQ" | "NE", number, number]
    | ["AND" | "OR", FilterDSL, FilterDSL]
    | ["NOT", FilterDSL];

  function bytecodeToDSL(bytecode: string, consts: number[]): string {
    try {
      if (!bytecode || bytecode === "0x") {
        return "No filter";
      }

      // Remove 0x prefix and convert to byte array
      const bytes = bytecode.startsWith("0x")
        ? bytecode
            .slice(2)
            .match(/.{2}/g)
            ?.map((b) => parseInt(b, 16)) || []
        : [];

      let pc = 0; // Program counter
      const stack: (number | FilterDSL)[] = []; // Can contain field indices or DSL expressions

      while (pc < bytes.length) {
        const opcode = bytes[pc++];
        const opName = reverseOpcodes[opcode];

        if (!opName) {
          throw new Error(`Unknown opcode: 0x${opcode.toString(16)}`);
        }

        switch (opcode) {
          case 0x01: {
            // PUSH_FIELD
            if (pc + 1 >= bytes.length)
              throw new Error("Incomplete PUSH_FIELD");
            const fieldIndex = (bytes[pc] << 8) | bytes[pc + 1];
            pc += 2;
            stack.push(fieldIndex); // Push field index as number
            break;
          }
          case 0x02: {
            // PUSH_CONST
            if (pc + 1 >= bytes.length)
              throw new Error("Incomplete PUSH_CONST");
            const constIndex = (bytes[pc] << 8) | bytes[pc + 1];
            pc += 2;
            if (constIndex >= consts.length)
              throw new Error(`Invalid const index: ${constIndex}`);
            stack.push(consts[constIndex]); // Push constant value as number
            break;
          }
          case 0x10: // GT
          case 0x11: // GE
          case 0x12: // LT
          case 0x13: // LE
          case 0x14: // EQ
          case 0x15: {
            // NE
            if (stack.length < 2)
              throw new Error(`Not enough operands for ${opName}`);
            const value = stack.pop()!;
            const fieldIndex = stack.pop()!;

            if (typeof fieldIndex !== "number" || typeof value !== "number") {
              throw new Error(
                `Invalid operands for ${opName}: expected numbers`
              );
            }

            stack.push([
              opName as "GT" | "GE" | "LT" | "LE" | "EQ" | "NE",
              fieldIndex,
              value,
            ]);
            break;
          }
          case 0x20: // AND
          case 0x21: {
            // OR
            if (stack.length < 2)
              throw new Error(`Not enough operands for ${opName}`);
            const right = stack.pop()!;
            const left = stack.pop()!;

            if (typeof left === "number" || typeof right === "number") {
              throw new Error(
                `Invalid operands for ${opName}: expected DSL expressions`
              );
            }

            stack.push([opcode === 0x20 ? "AND" : "OR", left, right]);
            break;
          }
          case 0x22: {
            // NOT
            if (stack.length < 1)
              throw new Error(`Not enough operands for ${opName}`);
            const operand = stack.pop()!;

            if (typeof operand === "number") {
              throw new Error(
                `Invalid operand for ${opName}: expected DSL expression`
              );
            }

            stack.push(["NOT", operand]);
            break;
          }
          default:
            throw new Error(`Unhandled opcode: ${opName}`);
        }
      }

      if (stack.length !== 1) {
        throw new Error(
          `Invalid bytecode: stack should have exactly 1 element, got ${stack.length}`
        );
      }

      const result = stack[0];
      if (typeof result === "number") {
        throw new Error(
          "Invalid bytecode: final result should be a DSL expression"
        );
      }

      return prettyPrintDSL(result);
    } catch (error) {
      console.error("Failed to parse filter bytecode:", error);
      return `Error parsing bytecode: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  function prettyPrintDSL(dsl: FilterDSL): string {
    function format(expr: FilterDSL, indent: number = 0): string {
      const spaces = "  ".repeat(indent);

      if (expr[0] === "NOT") {
        return `${spaces}NOT (\n${format(expr[1] as FilterDSL, indent + 1)}\n${spaces})`;
      } else if (expr[0] === "AND" || expr[0] === "OR") {
        const left = format(expr[1] as FilterDSL, indent + 1);
        const right = format(expr[2] as FilterDSL, indent + 1);
        return `${spaces}(\n${left}\n${spaces}${expr[0]}\n${right}\n${spaces})`;
      } else {
        // Comparison: [op, fieldIndex, value]
        const [op, fieldIndex, value] = expr;
        const opSymbols: Record<string, string> = {
          GT: ">",
          GE: ">=",
          LT: "<",
          LE: "<=",
          EQ: "==",
          NE: "!=",
        };
        return `${spaces}field[${fieldIndex}] ${opSymbols[op]} ${value}`;
      }
    }

    return format(dsl, 0);
  }

  function formatTimeRemaining(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  const canDecrypt =
    job?.result?.isFinalized &&
    fhevmInstance &&
    ethersSigner &&
    jobManager.contractAddress;

  // Check if result indicates k-anonymity failure (sentinel value: uint128.max)
  const K_ANONYMITY_SENTINEL = BigInt(2) ** BigInt(128) - BigInt(1);
  const isKAnonymityFailure =
    decryptMutation.data &&
    decryptMutation.data.result === K_ANONYMITY_SENTINEL;

  // Calculate progress percentage
  const progressPercentage =
    job?.progress && job.progress.totalRows > BigInt(0)
      ? Number(
          (job.progress.processedRows * BigInt(100)) / job.progress.totalRows
        )
      : 0;

  function getStatusBadge(status: RequestStatus) {
    const variants: Record<
      RequestStatus,
      {
        variant: "default" | "secondary" | "destructive" | "outline";
        label: string;
      }
    > = {
      [RequestStatus.PENDING]: { variant: "secondary", label: "Pending" },
      [RequestStatus.ACCEPTED]: { variant: "default", label: "In Progress" },
      [RequestStatus.COMPLETED]: { variant: "default", label: "Completed" },
      [RequestStatus.REJECTED]: { variant: "destructive", label: "Rejected" },
    };

    const config = variants[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job Status</DialogTitle>
          <DialogDescription>
            {request?.status === RequestStatus.PENDING &&
              "Waiting for seller to accept your request"}
            {request?.status === RequestStatus.ACCEPTED &&
              "Job in progress - Monitor and manage allowance"}
            {request?.status === RequestStatus.COMPLETED &&
              "View decrypted job result and parameters"}
            {request?.status === RequestStatus.REJECTED &&
              "This request was rejected by the seller"}
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
                <span className="text-muted-foreground">Request ID:</span>{" "}
                <span className="font-mono">
                  #{request?.requestId.toString()}
                </span>
              </div>
              {job && (
                <div>
                  <span className="text-muted-foreground">Job ID:</span>{" "}
                  <span className="font-mono">#{job.jobId.toString()}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Dataset ID:</span>{" "}
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    #{truncateAddress(request?.datasetId.toString() || "", 6)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        request?.datasetId.toString() || ""
                      );
                      toast.success("Dataset ID copied to clipboard");
                    }}
                  >
                    <CopyIcon size={12} />
                  </Button>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>{" "}
                {request?.status !== undefined &&
                  getStatusBadge(request.status)}
              </div>
            </div>
          </div>

          {/* Pending Status Message */}
          {request?.status === RequestStatus.PENDING && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Waiting for Seller</AlertTitle>
              <AlertDescription>
                Your request is pending. The dataset owner needs to accept it
                before processing can begin.
              </AlertDescription>
            </Alert>
          )}

          {/* Rejected Status Message */}
          {request?.status === RequestStatus.REJECTED && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Request Rejected</AlertTitle>
              <AlertDescription>
                The dataset owner has rejected this request or buyer has
                cancelled since request processing timeout has been reached.
                Your payment has been refunded.
              </AlertDescription>
            </Alert>
          )}

          {/* Progress Section */}
          {job?.progress && request?.status === RequestStatus.ACCEPTED && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Progress
                </h3>
                <span className="text-sm font-semibold text-primary">
                  {progressPercentage.toFixed(1)}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-secondary rounded-full h-2.5">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Rows:</span>{" "}
                  <span className="font-semibold">
                    {job.progress.totalRows.toString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Processed:</span>{" "}
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {job.progress.processedRows.toString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Remaining:</span>{" "}
                  <span className="font-semibold text-orange-600 dark:text-orange-400">
                    {job.progress.remainingRows.toString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Gas Allowance & Top-Up Section */}
          {request && job && request.status === RequestStatus.ACCEPTED && (
            <GasAllowanceMonitor requestId={request.requestId} showTopUpForm />
          )}

          {/* Stalled Job Alert and Reclaim Button */}
          {request?.status === RequestStatus.ACCEPTED && (
            <>
              {isStalled ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Job Stalled</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-3">
                      <p>
                        This job has been inactive for more than 24 hours. You
                        can reclaim your remaining funds (base fee + unused
                        allowance).
                      </p>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleReclaimStalled}
                        disabled={reclaimStalledMutation.isPending}
                      >
                        {reclaimStalledMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Reclaiming...
                          </>
                        ) : (
                          <>
                            <Clock className="mr-2 h-4 w-4" />
                            Reclaim Stalled Funds
                          </>
                        )}
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                timeUntilStalled > 0 && (
                  <Alert>
                    <Clock className="h-4 w-4" />
                    <AlertTitle>Job Timer</AlertTitle>
                    <AlertDescription>
                      <p className="text-sm">
                        Time until you can reclaim funds if job stalls:{" "}
                        <span className="font-mono font-semibold">
                          {formatTimeRemaining(timeUntilStalled)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        If the seller doesn&apos;t complete the job within 24
                        hours, you can reclaim your funds.
                      </p>
                    </AlertDescription>
                  </Alert>
                )
              )}
            </>
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

          {/* Result Section - Only for completed jobs */}
          {request?.status === RequestStatus.COMPLETED && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Encrypted Result
              </h3>

              {!decryptMutation.data && !decryptMutation.isError && (
                <div className="bg-muted/50 rounded-lg p-4 text-center">
                  <Button
                    onClick={() => decryptMutation.mutate()}
                    disabled={!canDecrypt || decryptMutation.isPending}
                    className="w-full"
                  >
                    {decryptMutation.isPending ? (
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
                  {!canDecrypt && !decryptMutation.isPending && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Connect your wallet to decrypt
                    </p>
                  )}
                </div>
              )}

              {decryptMutation.isError && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                  <p className="text-sm text-destructive">
                    {decryptMutation.error instanceof Error
                      ? decryptMutation.error.message
                      : "Failed to decrypt result"}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => decryptMutation.mutate()}
                    className="mt-2"
                  >
                    Try Again
                  </Button>
                </div>
              )}

              {decryptMutation.data && (
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
                          {decryptMutation.data.result.toString()}
                        </p>
                      </div>

                      {decryptMutation.data.isOverflow && (
                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-orange-500" />
                            <p className="text-sm text-orange-700 dark:text-orange-400">
                              Overflow detected during computation. Result may
                              be inaccurate.
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
