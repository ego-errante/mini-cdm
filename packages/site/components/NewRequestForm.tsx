"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { ethers } from "ethers";
import { Op, OpNames, OpName, estimateJobAllowance } from "@fhevm/shared";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FilterBuilder } from "./FilterBuilder";
import { CompiledFilter } from "@fhevm/shared";
import { InfoIcon } from "lucide-react";
import { useCDMContext } from "@/hooks/useCDMContext";

interface NewRequestFormProps {
  datasetId: bigint;
  datasetRowCount: number;
  datasetNumColumns: number;
  onSubmit: (params: {
    datasetId: bigint;
    baseFee: bigint;
    computeAllowance: bigint;
    jobParams: {
      op: Op;
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
  onCancel: () => void;
}

interface FormValues {
  operation: string;
  targetField: string;
  weights: string;
  divisor: string;
  clampMin: string;
  clampMax: string;
  roundBucket: string;
  baseFee: string;
  computeAllowance: string;
}

export function NewRequestForm({
  datasetId,
  datasetRowCount,
  datasetNumColumns,
  onSubmit,
  onCancel,
}: NewRequestFormProps) {
  const { gasPrice } = useCDMContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<{
    gas: bigint;
    cost: bigint;
  } | null>(null);
  const [compiledFilter, setCompiledFilter] = useState<CompiledFilter | null>(
    null
  );

  const form = useForm<FormValues>({
    defaultValues: {
      operation: Op.COUNT.toString(),
      targetField: "0",
      weights: "",
      divisor: "1",
      clampMin: "0",
      clampMax: "0",
      roundBucket: "0",
      baseFee: "0.01",
      computeAllowance: "0.1",
    },
  });

  const watchedOperation = form.watch("operation");
  const watchedBaseFee = form.watch("baseFee");
  const watchedComputeAllowance = form.watch("computeAllowance");

  // Get current gas price from context
  const { data: currentGasPrice } = gasPrice;

  // Calculate gas estimate when relevant fields change
  useEffect(() => {
    async function calculateEstimate() {
      // Don't calculate if we don't have a gas price yet
      if (!currentGasPrice) {
        return;
      }

      try {
        const operation = parseInt(watchedOperation);
        const filterBytecodeValue = compiledFilter?.bytecode || "0x";
        const filterBytes = (filterBytecodeValue.length - 2) / 2; // Convert hex string to byte count

        const operationName = OpNames[operation] as OpName;

        const requiredAllowance = estimateJobAllowance(
          datasetRowCount,
          datasetNumColumns,
          operationName,
          filterBytes,
          currentGasPrice
        );

        setGasEstimate({
          gas: requiredAllowance / currentGasPrice,
          cost: requiredAllowance,
        });
      } catch (error) {
        console.error("Failed to estimate gas:", error);
        setGasEstimate(null);
      }
    }

    calculateEstimate();
  }, [
    watchedOperation,
    compiledFilter,
    datasetRowCount,
    datasetNumColumns,
    currentGasPrice,
  ]);

  async function handleSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      const operation = parseInt(values.operation) as Op;

      // Parse weights (comma-separated)
      const weights =
        values.weights.trim() === ""
          ? []
          : values.weights.split(",").map((w) => parseInt(w.trim()));

      const baseFee = ethers.parseEther(values.baseFee);
      const computeAllowance = ethers.parseEther(values.computeAllowance);

      const requestParams = {
        datasetId,
        baseFee,
        computeAllowance,
        jobParams: {
          op: operation,
          targetField: parseInt(values.targetField),
          weights,
          divisor: parseInt(values.divisor),
          clampMin: BigInt(values.clampMin),
          clampMax: BigInt(values.clampMax),
          roundBucket: parseInt(values.roundBucket),
          filter: {
            bytecode: compiledFilter?.bytecode || "0x",
            consts: compiledFilter?.consts.map((c) => BigInt(c)) || [],
          },
        },
      };
      await onSubmit(requestParams);
    } catch (error) {
      console.error("Failed to submit request:", error);
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedOperation = parseInt(watchedOperation) as Op;
  const showTargetField = [Op.SUM, Op.AVG_P, Op.MIN, Op.MAX].includes(
    selectedOperation
  );
  const showDivisor = selectedOperation === Op.AVG_P;
  const showWeights = selectedOperation === Op.WEIGHTED_SUM;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {/* Operation Selection */}
        <FormField
          control={form.control}
          name="operation"
          rules={{ required: "Operation is required" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Operation</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select operation" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={Op.COUNT.toString()}>COUNT</SelectItem>
                  <SelectItem value={Op.SUM.toString()}>SUM</SelectItem>
                  <SelectItem value={Op.AVG_P.toString()}>AVG_P</SelectItem>
                  <SelectItem value={Op.WEIGHTED_SUM.toString()}>
                    WEIGHTED_SUM
                  </SelectItem>
                  <SelectItem value={Op.MIN.toString()}>MIN</SelectItem>
                  <SelectItem value={Op.MAX.toString()}>MAX</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                The computation to perform on the dataset
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Target Field - only for SUM, AVG_P, MIN, MAX */}
        {showTargetField && (
          <FormField
            control={form.control}
            name="targetField"
            rules={{
              required: "Target field is required",
              min: { value: 0, message: "Must be >= 0" },
              max: {
                value: datasetNumColumns - 1,
                message: `Must be < ${datasetNumColumns}`,
              },
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Target Field</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    {...field}
                    placeholder="0"
                    min="0"
                    max={datasetNumColumns - 1}
                  />
                </FormControl>
                <FormDescription>
                  Column index to operate on (0-{datasetNumColumns - 1})
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Divisor - only for AVG_P */}
        {showDivisor && (
          <FormField
            control={form.control}
            name="divisor"
            rules={{
              required: "Divisor is required",
              min: { value: 1, message: "Must be > 0" },
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Divisor</FormLabel>
                <FormControl>
                  <Input type="number" {...field} placeholder="1" min="1" />
                </FormControl>
                <FormDescription>
                  Plaintext divisor for averaging
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Weights - only for WEIGHTED_SUM */}
        {showWeights && (
          <FormField
            control={form.control}
            name="weights"
            rules={{
              required: "Weights are required",
              validate: (value) => {
                const weights = value.split(",").map((w) => w.trim());
                if (weights.length !== datasetNumColumns) {
                  return `Must provide ${datasetNumColumns} weights`;
                }
                return true;
              },
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Weights</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="1,2,3" />
                </FormControl>
                <FormDescription>
                  Comma-separated weights for each column (need{" "}
                  {datasetNumColumns})
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Optional Parameters */}
        <div className="grid grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="clampMin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Clamp Min</FormLabel>
                <FormControl>
                  <Input type="number" {...field} placeholder="0" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="clampMax"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Clamp Max</FormLabel>
                <FormControl>
                  <Input type="number" {...field} placeholder="0" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="roundBucket"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Round Bucket</FormLabel>
                <FormControl>
                  <Input type="number" {...field} placeholder="0" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Filter Builder */}
        <FilterBuilder
          numColumns={datasetNumColumns}
          onFilterChange={setCompiledFilter}
        />

        {/* Payment Parameters */}
        <FormField
          control={form.control}
          name="baseFee"
          rules={{
            required: "Base fee is required",
            min: { value: 0, message: "Must be >= 0" },
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Base Fee (ETH)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.001"
                  {...field}
                  placeholder="0.01"
                />
              </FormControl>
              <FormDescription>
                Fee paid to dataset owner upon completion
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="computeAllowance"
          rules={{
            required: "Compute allowance is required",
            min: { value: 0, message: "Must be >= 0" },
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Compute Allowance (ETH)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.001"
                  {...field}
                  placeholder="0.1"
                />
              </FormControl>
              <FormDescription>
                Allowance for gas costs during job execution
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Gas Estimate */}
        {gasEstimate && currentGasPrice && (
          <Alert>
            <AlertDescription>
              <div className="space-y-2 text-sm">
                <div className="text-xs text-muted-foreground flex items-start gap-2">
                  <InfoIcon className="size-4" /> These estimates are
                  suggestions. Use the estimated cost as a reference for setting
                  your compute allowance.
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="font-semibold">Current Gas Price:</span>
                    <span>
                      {ethers.formatUnits(currentGasPrice, "gwei")} gwei
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold">Estimated Gas:</span>
                    <span>{gasEstimate.gas.toString()} units</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold">Estimated Cost:</span>
                    <span>{ethers.formatEther(gasEstimate.cost)} ETH</span>
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between">
          <span className="font-semibold">Total Payment:</span>
          <span>
            {(
              parseFloat(watchedComputeAllowance || "0") +
              parseFloat(watchedBaseFee || "0")
            ).toFixed(4)}{" "}
            ETH
          </span>
        </div>
        <div className="text-xs text-muted-foreground pt-1 border-t">
          Total = Compute Allowance + Base Fee
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit Request"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
