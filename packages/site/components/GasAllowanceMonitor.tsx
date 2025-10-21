"use client";

import { useState } from "react";
import { ethers } from "ethers";
import {
  JobData,
  JobRequest,
  RequestStatus,
  OpName,
  OpNames,
  estimateJobAllowance,
} from "@fhevm/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Info, TrendingUp, Fuel, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCDMContext } from "@/hooks/useCDMContext";
import { DEFAULT_GAS_PRICE } from "@fhevm/shared";

interface GasAllowanceMonitorProps {
  requestId: bigint;
  showTopUpForm?: boolean; // Only show for buyers
}

export function GasAllowanceMonitor({
  requestId,
  showTopUpForm = false,
}: GasAllowanceMonitorProps) {
  const { jobManager, gasPrice } = useCDMContext();
  const topUpMutation = jobManager.topUpAllowanceMutation;
  const [topUpAmount, setTopUpAmount] = useState<string>("0.01");

  // Get current gas price from context
  const { data: currentGasPrice } = gasPrice;

  // Get live data from the query (this will update automatically when invalidated)
  const activity = jobManager.getJobManagerActivity.data;
  const request = activity?.requests.find((r) => r.requestId === requestId);
  const job =
    request?.jobId && activity?.requestToJob
      ? activity.requestToJob[request.jobId.toString()]
      : null;

  // Don't render if we don't have the required data
  if (!request || !job) {
    return null;
  }

  // Calculate recommendation
  function getTopUpRecommendation(): {
    shouldTopUp: boolean;
    message: string;
    variant: "default" | "warning" | "destructive";
  } {
    if (!request || !job || request.status !== RequestStatus.ACCEPTED) {
      return {
        shouldTopUp: false,
        message: "Job not in progress",
        variant: "default",
      };
    }

    const allowance = request.computeAllowance;
    const remainingRows = Number(job.progress?.remainingRows || BigInt(0));

    // If no rows remaining, no need to top up
    if (remainingRows === 0) {
      return {
        shouldTopUp: false,
        message: `✅ All rows processed. Job ready for finalization.`,
        variant: "default",
      };
    }

    // Get job parameters for estimation
    // Note: We use a conservative default for numColumns since it's not stored in JobData
    // The 2x safety margin in estimateJobAllowance will compensate for this
    const numColumns = 5; // Conservative default
    const operation = OpNames[request.params.op] as OpName;
    const filterBytecode = request.params.filter?.bytecode || "0x";
    const filterBytes = (filterBytecode.length - 2) / 2;

    // Use current gas price from network, or fallback to default (20 gwei)
    const gasPrice = currentGasPrice || DEFAULT_GAS_PRICE;

    // Estimate required allowance for remaining rows (already includes 2x safety margin)
    const estimatedRemainingCost = estimateJobAllowance(
      remainingRows,
      numColumns,
      operation,
      filterBytes,
      gasPrice
    );

    if (allowance < estimatedRemainingCost / BigInt(2)) {
      // Less than actual cost (no safety margin)
      return {
        shouldTopUp: true,
        message: `⚠️ Critical! Estimated ${ethers.formatEther(estimatedRemainingCost / BigInt(2))} ETH needed for remaining ${remainingRows} rows, but only ${ethers.formatEther(allowance)} ETH available. Top up immediately to avoid job stalling.`,
        variant: "destructive",
      };
    } else if (allowance < estimatedRemainingCost) {
      // Less than recommended (with safety margin)
      return {
        shouldTopUp: true,
        message: `⚡ Allowance is getting low. Recommended ${ethers.formatEther(estimatedRemainingCost)} ETH (with 2x safety margin) for ${remainingRows} rows, but you have ${ethers.formatEther(allowance)} ETH. Consider topping up for safety.`,
        variant: "warning",
      };
    } else {
      return {
        shouldTopUp: false,
        message: `✅ Allowance looks sufficient. You have ${ethers.formatEther(allowance)} ETH for estimated ${ethers.formatEther(estimatedRemainingCost)} ETH (${remainingRows} rows with 2x safety margin).`,
        variant: "default",
      };
    }
  }

  const recommendation = getTopUpRecommendation();

  async function handleTopUp() {
    try {
      const amount = ethers.parseEther(topUpAmount);
      if (amount <= BigInt(0)) {
        toast.error("Top-up amount must be greater than 0");
        return;
      }

      await topUpMutation.mutateAsync({
        requestId,
        amount,
      });

      toast.success(`Successfully topped up ${topUpAmount} ETH`);
      setTopUpAmount("0.01");
    } catch (err) {
      console.error("Top-up error:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to top up allowance"
      );
    }
  }

  if (request.status !== RequestStatus.ACCEPTED) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Fuel className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-muted-foreground">
          Gas Allowance
        </h3>
      </div>

      {/* Allowance Info */}
      <div className="bg-muted/50 rounded-lg p-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Remaining Allowance:</span>
          <span className="font-mono font-semibold">
            {ethers.formatEther(request.computeAllowance)} ETH
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Gas Debt to Seller:</span>
          <span className="font-mono font-semibold">
            {ethers.formatEther(request.gasDebtToSeller)} ETH
          </span>
        </div>
      </div>

      {/* Recommendation Alert */}
      <Alert
        variant={
          recommendation.variant === "destructive" ? "destructive" : "default"
        }
      >
        {recommendation.shouldTopUp ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <Info className="h-4 w-4" />
        )}
        <AlertTitle>
          {recommendation.shouldTopUp ? "Action Recommended" : "Status Good"}
        </AlertTitle>
        <AlertDescription className="text-sm">
          {recommendation.message}
        </AlertDescription>
      </Alert>

      {/* Top-Up Form (only for buyers) */}
      {showTopUpForm && (
        <div className="space-y-2">
          <Label htmlFor="topUpAmount" className="text-sm">
            Top-Up Amount (ETH)
          </Label>
          <div className="flex gap-2">
            <Input
              id="topUpAmount"
              type="number"
              step="0.01"
              min="0"
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
              placeholder="0.01"
              className="flex-1"
            />
            <Button
              onClick={handleTopUp}
              disabled={
                topUpMutation.isPending ||
                !topUpAmount ||
                parseFloat(topUpAmount) <= 0
              }
              className="min-w-[100px]"
            >
              {topUpMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Topping Up...
                </>
              ) : (
                <>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Top Up
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Add more ETH to ensure the job can complete without running out of
            gas.
          </p>
        </div>
      )}
    </div>
  );
}
