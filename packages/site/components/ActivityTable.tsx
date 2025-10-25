"use client";

import { useState } from "react";
import { toast } from "sonner";
import { JobData, JobRequest, RequestStatus } from "@fhevm/shared";
import { useCDMContext } from "@/hooks/useCDMContext";
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
import { Check, X, Ban, Play, Eye, Loader2 } from "lucide-react";
import { ConfirmationModal } from "./ConfirmationModal";
import { ViewResultModal } from "./ViewResultModal";
import { truncateAddress } from "@/lib/datasetHelpers";

interface ActivityTableProps {
  requests: JobRequest[];
  jobs: JobData[];
  isOwner: boolean;
  currentUserAddress: string | undefined;
  onRequestAccepted?: (requestId: bigint) => void;
  onProcessJob?: (requestId: bigint) => void;
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
  onRequestAccepted,
  onProcessJob,
}: ActivityTableProps) {
  const { jobManager } = useCDMContext();
  const acceptMutation = jobManager.acceptRequestMutation;
  const rejectMutation = jobManager.rejectRequestMutation;
  const cancelMutation = jobManager.cancelRequestMutation;
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

  const [viewResultModal, setViewResultModal] = useState<{
    open: boolean;
    requestId: bigint | undefined;
    jobId: bigint | undefined;
  }>({
    open: false,
    requestId: undefined,
    jobId: undefined,
  });

  // Keep modal data in sync with current requests/jobs when modal is open
  const currentModalRequest = viewResultModal.requestId
    ? requests.find((r) => r.requestId === viewResultModal.requestId)
    : undefined;
  const currentModalJob = viewResultModal.jobId
    ? jobs.find((j) => j.jobId === viewResultModal.jobId)
    : undefined;

  // Create activity rows by matching requests and jobs
  const activityRows: ActivityRow[] = [];
  const processedJobIds = new Set<string>();

  // Add all requests and match with their jobs
  requests.forEach((request) => {
    const matchedJob = jobs.find((job) => job.id === request.jobId);

    activityRows.push({
      requestId: request.requestId,
      jobId: matchedJob?.jobId,
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
        jobId: job.jobId,
        buyer: job.buyer,
        job,
      });
    }
  });

  function handleAcceptRequest(requestId: bigint) {
    acceptMutation.mutate(requestId, {
      onSuccess: () => {
        toast.success("Request accepted");

        // Notify parent to open the job processor modal
        // The modal will handle matching the request to its job declaratively
        if (onRequestAccepted) {
          onRequestAccepted(requestId);
        }
      },
      onError: (error) => {
        console.error("Failed to accept request:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to accept request"
        );
      },
    });
  }

  function handleRejectRequest(requestId: bigint) {
    rejectMutation.mutate(requestId, {
      onSuccess: () => {
        toast.success("Request rejected");
      },
      onError: (error) => {
        console.error("Failed to reject request:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to reject request"
        );
      },
    });
  }

  function handleCancelRequest(requestId: bigint) {
    cancelMutation.mutate(requestId, {
      onSuccess: () => {
        toast.success("Request cancelled");
      },
      onError: (error) => {
        console.error("Failed to cancel request:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to cancel request"
        );
      },
    });
  }

  function getStatusBadge(status: RequestStatus) {
    const variants: Record<
      RequestStatus,
      {
        variant: "default" | "secondary" | "destructive" | "outline";
        label: string;
      }
    > = {
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
      onConfirm: async () => handleRejectRequest(requestId),
      variant: "destructive",
    });
  }

  function handleCancelClick(requestId: bigint) {
    setConfirmModal({
      open: true,
      title: "Cancel Request",
      description:
        "Are you sure you want to cancel this request? Your payment will be refunded.",
      onConfirm: async () => handleCancelRequest(requestId),
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
            {activityRows.map((row, index) => {
              const isAccepting =
                acceptMutation.isPending &&
                acceptMutation.variables === row.requestId;
              const isRejecting =
                rejectMutation.isPending &&
                rejectMutation.variables === row.requestId;
              const isCancelling =
                cancelMutation.isPending &&
                cancelMutation.variables === row.requestId;

              return (
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
                    {row.status !== undefined
                      ? getStatusBadge(row.status)
                      : "-"}
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
                                  className="h-8 w-8 disabled:cursor-not-allowed"
                                  disabled={isAccepting || isRejecting}
                                  onClick={() =>
                                    handleAcceptRequest(row.requestId!)
                                  }
                                >
                                  {isAccepting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Accept Request</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 disabled:cursor-disabled"
                                  disabled={isAccepting || isRejecting}
                                  onClick={() =>
                                    handleRejectClick(row.requestId!)
                                  }
                                >
                                  {isRejecting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <X className="h-4 w-4" />
                                  )}
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
                        row.buyer?.toLowerCase() ===
                          currentUserAddress.toLowerCase() && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 disabled:cursor-not-allowed"
                                disabled={isCancelling}
                                onClick={() =>
                                  handleCancelClick(row.requestId!)
                                }
                              >
                                {isCancelling ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Ban className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Cancel Request</TooltipContent>
                          </Tooltip>
                        )}

                      {/* Owner actions for accepted requests */}
                      {isOwner &&
                        row.request &&
                        row.status === RequestStatus.ACCEPTED &&
                        onProcessJob && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 disabled:cursor-not-allowed"
                                onClick={() => onProcessJob(row.requestId!)}
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Process Job</TooltipContent>
                          </Tooltip>
                        )}

                      {/* View Status/Result button for buyers */}
                      {row.request &&
                        currentUserAddress &&
                        row.buyer?.toLowerCase() ===
                          currentUserAddress.toLowerCase() && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 disabled:cursor-not-allowed"
                                onClick={() =>
                                  setViewResultModal({
                                    open: true,
                                    requestId: row.requestId,
                                    jobId: row.jobId,
                                  })
                                }
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {row.status === RequestStatus.COMPLETED
                                ? "View Result"
                                : row.status === RequestStatus.ACCEPTED
                                  ? "View Progress & Manage Allowance"
                                  : "View Status"}
                            </TooltipContent>
                          </Tooltip>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
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

      <ViewResultModal
        open={viewResultModal.open}
        onOpenChange={(open) =>
          setViewResultModal({ ...viewResultModal, open })
        }
        request={currentModalRequest}
        job={currentModalJob}
      />
    </>
  );
}
