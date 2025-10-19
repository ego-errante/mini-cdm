"use client";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Network,
  Shield,
  Info,
} from "lucide-react";
import { useState } from "react";
import { StatusBadgeProps } from "./StatusBadgeTypes";
import { cn } from "@/lib/utils";

/**
 * Clickable badges that open detailed information panels.
 */
export function StatusBadgesPopover({
  chainId,
  accounts,
  fhevmInstance,
  fhevmStatus,
  fhevmError,
  contracts,
  className,
}: StatusBadgeProps & { className?: string }) {
  const [chainOpen, setChainOpen] = useState(false);
  const [fhevmOpen, setFhevmOpen] = useState(false);

  const allContractsDeployed = contracts?.every((c) => c.isDeployed);
  const chainStatus = chainId && allContractsDeployed;
  const fhevmReady = fhevmInstance && !fhevmError;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Chain Popover Badge */}
      <Popover open={chainOpen} onOpenChange={setChainOpen}>
        <PopoverTrigger asChild>
          <Badge
            variant={chainStatus ? "default" : "destructive"}
            className="gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <Network className="h-3 w-3" />
            <span>{chainId || "?"}</span>
            <Info className="h-2.5 w-2.5 ml-0.5 opacity-60" />
          </Badge>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 ">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${chainStatus ? "bg-green-500" : "bg-red-500"}`}
              />
              <h4 className="font-semibold text-sm">Chain Status</h4>
            </div>

            <Separator />

            <div className="grid gap-2 text-xs">
              <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                <span className="text-muted-foreground">Chain ID</span>
                <span className="font-mono font-semibold">
                  {chainId || "Not connected"}
                </span>
              </div>

              <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                <span className="text-muted-foreground">Accounts</span>
                <span className="font-semibold">
                  {accounts?.length || 0} connected
                </span>
              </div>

              {contracts?.map((contract, index) => (
                <div
                  key={contract.name || index}
                  className="p-2 rounded-md bg-muted/50 space-y-2"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-semibold capitalize">
                      {contract.name}
                    </span>

                    <div className="flex gap-1">
                      {contract.isDeployed ? (
                        <span className="flex items-center gap-1.5 text-green-600 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Deployed</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-red-600 font-medium">
                          <XCircle className="h-3.5 w-3.5" />
                          <span className="sr-only">Not Deployed</span>
                        </span>
                      )}
                      <span
                        className="font-mono text-xs"
                        title={contract.address}
                      >
                        {contract.address
                          ? `${contract.address.slice(
                              0,
                              6
                            )}...${contract.address.slice(-4)}`
                          : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* FHEVM Popover Badge */}
      <Popover open={fhevmOpen} onOpenChange={setFhevmOpen}>
        <PopoverTrigger asChild>
          <Badge
            variant={
              fhevmReady
                ? "default"
                : fhevmStatus === "loading"
                  ? "secondary"
                  : "destructive"
            }
            className="gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
          >
            {fhevmStatus === "loading" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : fhevmReady ? (
              <Shield className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            <span>FHEVM</span>
            <Info className="h-2.5 w-2.5 ml-0.5 opacity-60" />
          </Badge>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 bg-white">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${
                  fhevmReady
                    ? "bg-green-500"
                    : fhevmStatus === "loading"
                      ? "bg-yellow-500 animate-pulse"
                      : "bg-red-500"
                }`}
              />
              <h4 className="font-semibold text-sm">FHEVM Status</h4>
            </div>

            <Separator />

            <div className="grid gap-2 text-xs">
              <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                <span className="text-muted-foreground">Status</span>
                <span className="font-semibold capitalize">{fhevmStatus}</span>
              </div>

              <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                <span className="text-muted-foreground">Instance</span>
                {fhevmInstance ? (
                  <span className="flex items-center gap-1.5 text-green-600 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Ready
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-red-600 font-medium">
                    <XCircle className="h-3.5 w-3.5" />
                    Not ready
                  </span>
                )}
              </div>

              {fhevmError && (
                <div className="p-2 rounded-md bg-destructive/10 border border-destructive/20">
                  <p className="text-destructive font-medium mb-1">Error:</p>
                  <p className="text-destructive/80">{fhevmError.message}</p>
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
