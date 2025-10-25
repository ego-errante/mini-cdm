"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { truncateAddress } from "@/lib/datasetHelpers";
import { Button } from "./ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";

interface DatasetCardProps {
  id: bigint;
  owner: string;
  rowCount: number;
  numColumns: number;
  jobCount: number;
  requestCount: number;
  userRequestCount: number;
  userPendingRequestCount: number;
  userAcceptedRequestCount: number;
  description?: string;
  currentUserAddress?: string;
  onClick: () => void;
}

export function DatasetCard({
  id,
  owner,
  rowCount,
  numColumns,
  jobCount,
  requestCount,
  userRequestCount,
  userPendingRequestCount,
  userAcceptedRequestCount,
  description,
  currentUserAddress,
  onClick,
}: DatasetCardProps) {
  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-shadow"
      onClick={onClick}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div>
            <span className="text-lg mr-2">
              Dataset #{truncateAddress(id.toString(), 6)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(id.toString());
                toast.success("Copied to clipboard");
              }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {currentUserAddress &&
            owner.toLowerCase() === currentUserAddress.toLowerCase() && (
              <div className="mb-2">
                <Badge variant="secondary">Your dataset</Badge>
              </div>
            )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">Owner:</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">
                {truncateAddress(owner)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(owner);
                  toast.success("Owner address copied to clipboard");
                }}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {description && (
            <div className="flex flex-col items-start gap-2">
              <span className="text-muted-foreground text-sm">
                Description:
              </span>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {description.length > 100
                  ? `${description.substring(0, 100)}...`
                  : description}
              </p>
            </div>
          )}

          {userRequestCount > 0 && (
            <div className="flex flex-col items-start gap-2 bg-muted/50 p-2 rounded-md">
              <span className="text-muted-foreground text-sm">
                Your Requests:
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{userRequestCount} total</Badge>
                {userPendingRequestCount > 0 && (
                  <Badge
                    variant="outline"
                    className="border-yellow-500 text-yellow-600"
                  >
                    {userPendingRequestCount} Pending
                  </Badge>
                )}
                {userAcceptedRequestCount > 0 && (
                  <Badge variant="default" className="bg-green-600">
                    {userAcceptedRequestCount} Accepted
                  </Badge>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col items-start gap-2">
            <span className="text-muted-foreground text-sm">
              Dataset Summary:
            </span>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {rowCount} Rows
              </Badge>
              <Badge variant="outline" className="text-xs">
                {numColumns} Columns
              </Badge>
              <Badge variant="outline" className="text-xs">
                {jobCount} Jobs
              </Badge>
              <Badge variant="outline" className="text-xs">
                {requestCount} Requests
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
