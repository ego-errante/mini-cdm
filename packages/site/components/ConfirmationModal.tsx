"use client";

import { useState } from "react";
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
import { useCDMContext } from "@/hooks/useCDMContext";

interface ConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => Promise<void> | void;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  // Optional props for delete dataset functionality
  datasetId?: bigint;
}

export function ConfirmationModal({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "destructive",
  datasetId,
}: ConfirmationModalProps) {
  const { datasetRegistry } = useCDMContext();
  const deleteMutation = datasetRegistry.deleteDatasetMutation;

  function handleConfirm() {
    // If this is a delete dataset confirmation, use the mutation directly
    if (datasetId && variant === "destructive") {
      deleteMutation.mutate(datasetId, {
        onSuccess: () => {
          toast.success("Dataset deleted successfully");
          onOpenChange(false);
        },
        onError: (error) => {
          console.error("Failed to delete dataset:", error);
          toast.error(
            error instanceof Error ? error.message : "Failed to delete dataset"
          );
        },
      });
    } else {
      onConfirm();
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleteMutation.isPending}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Processing..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
