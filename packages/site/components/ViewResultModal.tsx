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
