"use client";

import { useState, useMemo } from "react";
import { StatusBadgesPopover } from "@/components/StatusBadgesPopover";
import { Button } from "./ui/button";
import { CreateDatasetModal } from "@/components/CreateDatasetModal";
import { DatasetCard } from "@/components/DatasetCard";
import { DatasetDrawer } from "@/components/DatasetDrawer";
import { useCDMContext } from "@/hooks/useCDMContext";
import {
  getDatasetJobCount,
  getDatasetRequestCount,
  userHasRequestForDataset,
  getUserRequestCount,
  getUserPendingRequestCount,
  getUserAcceptedRequestCount,
  isDatasetOwner as checkIsDatasetOwner,
  getDatasetActivity,
} from "@/lib/datasetHelpers";

export default function ConfidentialDataMarketplace() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState<bigint | null>(
    null
  );

  const {
    chainId,
    isConnected,
    connect,
    datasetRegistry,
    jobManager,
    accounts,
    ethersSigner,
    fhevmInstance,
    fhevmStatus,
    fhevmError,
  } = useCDMContext();

  const { getDatasetsQuery } = datasetRegistry;
  const { getJobManagerActivity } = jobManager;

  const datasets = getDatasetsQuery.data || [];
  const activity = getJobManagerActivity.data;
  const currentUserAddress = accounts?.[0];

  // Reverse dataset order (newest first)
  const reversedDatasets = [...datasets].reverse();

  // Compute dataset stats once using useMemo
  // Now uses O(1) lookups from precomputed byDataset map
  const datasetStats = useMemo(() => {
    if (!activity) return new Map();

    const statsMap = new Map<
      bigint,
      {
        jobCount: number;
        requestCount: number;
        userRequestCount: number;
        userPendingRequestCount: number;
        userAcceptedRequestCount: number;
      }
    >();

    datasets.forEach((dataset) => {
      const jobCount = getDatasetJobCount(dataset.id, activity);
      const requestCount = getDatasetRequestCount(dataset.id, activity);
      const userRequestCount = getUserRequestCount(
        dataset.id,
        activity,
        currentUserAddress
      );
      const userPendingRequestCount = getUserPendingRequestCount(
        dataset.id,
        activity,
        currentUserAddress
      );
      const userAcceptedRequestCount = getUserAcceptedRequestCount(
        dataset.id,
        activity,
        currentUserAddress
      );

      statsMap.set(dataset.id, {
        jobCount,
        requestCount,
        userRequestCount,
        userPendingRequestCount,
        userAcceptedRequestCount,
      });
    });

    return statsMap;
  }, [activity, datasets, currentUserAddress]);

  // Find selected dataset
  const selectedDataset = selectedDatasetId
    ? datasets.find((d) => d.id === selectedDatasetId)
    : null;

  if (!isConnected) {
    return (
      <div className="flex justify-center items-center w-full">
        <Button
          size="lg"
          className="py-10"
          disabled={isConnected}
          onClick={connect}
        >
          <span className="text-2xl font-semibold">Connect to MetaMask</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 items-center sm:items-start w-full px-3 md:px-0">
      <StatusBadgesPopover
        className="absolute top-10 right-6"
        chainId={chainId}
        accounts={accounts}
        ethersSigner={ethersSigner}
        fhevmInstance={fhevmInstance}
        fhevmStatus={fhevmStatus}
        fhevmError={fhevmError || null}
        contracts={[
          {
            name: "DatasetRegistry",
            address: datasetRegistry.contractAddress,
            isDeployed: datasetRegistry.isDeployed,
          },
          {
            name: "JobManager",
            address: jobManager.contractAddress,
            isDeployed: jobManager.isDeployed,
          },
        ]}
      />

      <div className="flex gap-2 items-center w-full justify-between">
        <h1>Confidential Data Marketplace</h1>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          Create Dataset
        </Button>
      </div>

      {/* Dataset Grid */}
      {getDatasetsQuery.isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading datasets...
        </div>
      ) : datasets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground mx-auto">
          No datasets yet. Create one to get started!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
          {reversedDatasets.map((dataset) => {
            const stats = datasetStats.get(dataset.id) || {
              jobCount: 0,
              requestCount: 0,
              userRequestCount: 0,
              userPendingRequestCount: 0,
              userAcceptedRequestCount: 0,
            };

            return (
              <DatasetCard
                key={dataset.id.toString()}
                id={dataset.id}
                owner={dataset.owner}
                rowCount={dataset.rowCount}
                numColumns={dataset.numColumns}
                jobCount={stats.jobCount}
                requestCount={stats.requestCount}
                userRequestCount={stats.userRequestCount}
                userPendingRequestCount={stats.userPendingRequestCount}
                userAcceptedRequestCount={stats.userAcceptedRequestCount}
                onClick={() => setSelectedDatasetId(dataset.id)}
              />
            );
          })}
        </div>
      )}

      {/* Dataset Drawer */}
      {selectedDataset && activity && (
        <DatasetDrawer
          open={!!selectedDatasetId}
          onOpenChange={(open) => !open && setSelectedDatasetId(null)}
          dataset={selectedDataset}
          activity={getDatasetActivity(selectedDataset.id, activity)}
          isOwner={checkIsDatasetOwner(
            selectedDataset.owner,
            currentUserAddress
          )}
          currentUserAddress={currentUserAddress}
        />
      )}

      <CreateDatasetModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
      />
    </div>
  );
}
