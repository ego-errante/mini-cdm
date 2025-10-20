"use client";

import { useState } from "react";
import { JobData, JobRequest, RequestStatus } from "@fhevm/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, X, Ban } from "lucide-react";
import { ConfirmationModal } from "./ConfirmationModal";
import { truncateAddress } from "@/lib/datasetHelpers";

interface ActivityTableProps {
  requests: JobRequest[];
  jobs: JobData[];
  isOwner: boolean;
  currentUserAddress: string | undefined;
  onAcceptRequest: (requestId: bigint) => Promise<void>;
  onRejectRequest: (requestId: bigint) => Promise<void>;
  onCancelRequest: (requestId: bigint) => Promise<void>;
}

interface ActivityRow {
  requestId?: bigint;
  jobId?: bigint;
  buyer?: string;
  status?: RequestStatus;
  timestamp?: bigint;
  request?: JobRequest;
  job?: JobData;
}

export function ActivityTable({
  requests,
  jobs,
  isOwner,
  currentUserAddress,
  onAcceptRequest,
  onRejectRequest,
  onCancelRequest,
}: ActivityTableProps) {
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
    variant: "default" | "destructive";
  }>({
    open: false,
    title: "",
    description: "",
    onConfirm: async () => {},
    variant: "default",
  });

  // Create activity rows by matching requests and jobs
  const activityRows: ActivityRow[] = [];
  const processedJobIds = new Set<string>();

  // Add all requests and match with their jobs
  requests.forEach((request) => {
    const matchedJob = jobs.find((job) => job.id === request.jobId);

    activityRows.push({
      requestId: BigInt(requests.indexOf(request) + 1),
      jobId: matchedJob?.id,
      buyer: request.buyer,
      status: request.status,
      timestamp: request.timestamp,
      request,
      job: matchedJob,
    });

    if (matchedJob) {
      processedJobIds.add(matchedJob.id.toString());
    }
  });

  // Add jobs that don't have matching requests
  jobs.forEach((job) => {
    if (!processedJobIds.has(job.id.toString())) {
      activityRows.push({
        jobId: job.id,
        buyer: job.buyer,
        job,
      });
    }
  });

  function getStatusBadge(status: RequestStatus) {
    const variants: Record<RequestStatus, { variant: any; label: string }> = {
      [RequestStatus.PENDING]: { variant: "secondary", label: "Pending" },
      [RequestStatus.ACCEPTED]: { variant: "default", label: "Accepted" },
      [RequestStatus.COMPLETED]: { variant: "default", label: "Completed" },
      [RequestStatus.REJECTED]: { variant: "destructive", label: "Rejected" },
    };

    const config = variants[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  }

  function handleRejectClick(requestId: bigint) {
    setConfirmModal({
      open: true,
      title: "Reject Request",
      description:
        "Are you sure you want to reject this request? This action cannot be undone.",
      onConfirm: async () => onRejectRequest(requestId),
      variant: "destructive",
    });
  }

  function handleCancelClick(requestId: bigint) {
    setConfirmModal({
      open: true,
      title: "Cancel Request",
      description:
        "Are you sure you want to cancel this request? Your payment will be refunded.",
      onConfirm: async () => onCancelRequest(requestId),
      variant: "default",
    });
  }

  if (activityRows.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No activity yet for this dataset
      </div>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Request ID</TableHead>
              <TableHead>Job ID</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activityRows.map((row, index) => (
              <TableRow key={index}>
                <TableCell>
                  {row.requestId ? `#${row.requestId.toString()}` : "-"}
                </TableCell>
                <TableCell>
                  {row.jobId ? `#${row.jobId.toString()}` : "-"}
                </TableCell>
                <TableCell className="font-mono">
                  {row.buyer ? truncateAddress(row.buyer) : "-"}
                </TableCell>
                <TableCell>
                  {row.status !== undefined ? getStatusBadge(row.status) : "-"}
                </TableCell>
                <TableCell>
                  {row.timestamp
                    ? new Date(
                        Number(row.timestamp) * 1000
                      ).toLocaleDateString()
                    : "-"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {/* Owner actions for pending requests */}
                    {isOwner &&
                      row.request &&
                      row.status === RequestStatus.PENDING && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => onAcceptRequest(row.requestId!)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Accept Request</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() =>
                                  handleRejectClick(row.requestId!)
                                }
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Reject Request</TooltipContent>
                          </Tooltip>
                        </>
                      )}

                    {/* Buyer actions for pending requests */}
                    {!isOwner &&
                      row.request &&
                      row.status === RequestStatus.PENDING &&
                      currentUserAddress &&
                      row.buyer.toLowerCase() ===
                        currentUserAddress.toLowerCase() && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => handleCancelClick(row.requestId!)}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Cancel Request</TooltipContent>
                        </Tooltip>
                      )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TooltipProvider>

      <ConfirmationModal
        open={confirmModal.open}
        onOpenChange={(open) => setConfirmModal({ ...confirmModal, open })}
        title={confirmModal.title}
        description={confirmModal.description}
        onConfirm={confirmModal.onConfirm}
        variant={confirmModal.variant}
      />
    </>
  );
}
