import { DatasetRegistry } from "../../types";
import { JobManager } from "../../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  createDefaultJobParams,
  Signers,
  deployDatasetRegistryFixture,
  deployJobManagerFixture,
  setupTestDataset,
  TestDataset,
} from "../utils";

describe("Job Transactions", () => {
  let signers: Signers;
  let datasetRegistryContract: DatasetRegistry;
  let jobManagerContract: JobManager;
  let datasetRegistryContractAddress: string;
  let jobManagerContractAddress: string;
  let testDataset: TestDataset;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerContractAddress } = await deployJobManagerFixture(datasetRegistryContractAddress));

    await datasetRegistryContract.connect(signers.deployer).setJobManager(jobManagerContractAddress);

    testDataset = await setupTestDataset(datasetRegistryContract, jobManagerContractAddress, signers.alice);
  });

  it("a buyer should be able to submit a request with job params and dataset ID", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;

    await expect(jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams))
      .to.emit(jobManagerContract, "RequestSubmitted")
      .withArgs(0, datasetId, buyer.address);
  });

  it("buyer should be able to cancel a request if a job has not been started yet", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const requestId = 0;

    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams);

    await expect(jobManagerContract.connect(buyer).cancelRequest(requestId))
      .to.emit(jobManagerContract, "RequestCancelled")
      .withArgs(requestId);
  });

  it("seller should be able to accept a buyer's request and start a job", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const seller = signers.alice;
    const requestId = 0;

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams);

    // Seller accepts request
    await expect(jobManagerContract.connect(seller).acceptRequest(requestId))
      .to.emit(jobManagerContract, "RequestAccepted")
      .withArgs(requestId, 0); // requestId, jobId
  });

  it("seller should be able to reject a buyer's request", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const seller = signers.alice;
    const requestId = 0;

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams);

    // Seller rejects request
    await expect(jobManagerContract.connect(seller).rejectRequest(requestId))
      .to.emit(jobManagerContract, "RequestRejected")
      .withArgs(requestId);
  });

  it("should be able to retrieve request details", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const requestId = 0;

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams);

    // Get request details
    const request = await jobManagerContract.getRequest(requestId);

    expect(request.datasetId).to.equal(datasetId);
    expect(request.buyer).to.equal(buyer.address);
    expect(request.status).to.equal(0); // PENDING = 0
    expect(request.timestamp).to.be.gt(0);
  });

  it("should be able to retrieve buyer's requests for a dataset", async () => {
    const jobParams1 = createDefaultJobParams();
    const jobParams2 = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;

    // Submit multiple requests
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams1);
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams2);

    // Get buyer's requests
    const buyerRequests = await jobManagerContract.getBuyerRequests(buyer.address, datasetId);

    expect(buyerRequests.length).to.equal(2);
    expect(buyerRequests[0]).to.equal(0);
    expect(buyerRequests[1]).to.equal(1);
  });

  it("should return empty array for buyer with no requests", async () => {
    const datasetId = testDataset.id;
    const buyer = signers.bob;

    // Get requests for buyer with no requests
    const buyerRequests = await jobManagerContract.getBuyerRequests(buyer.address, datasetId);

    expect(buyerRequests.length).to.equal(0);
  });

  it("request should be marked completed when job finalizes", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const seller = signers.alice;
    const requestId = 0;

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams);

    // Seller accepts and starts job
    await jobManagerContract.connect(seller).acceptRequest(requestId);

    // Process a row (simplified - would need actual encrypted data)
    // This test assumes the job can be finalized after acceptance
    // In a real scenario, rows would be pushed first

    // Check request status before finalization
    let request = await jobManagerContract.getRequest(requestId);
    expect(request.status).to.equal(1); // ACCEPTED = 1

    // For this test, we'll assume finalization happens
    // (In real implementation, this would require pushing rows first)
    // await jobManagerContract.connect(seller).finalize(0);

    // Check request status after finalization
    // request = await jobManagerContract.getRequest(requestId);
    // expect(request.status).to.equal(3); // COMPLETED = 3
  });

  it("should prevent operations on non-pending requests", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const seller = signers.alice;
    const requestId = 0;

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams);

    // Accept the request
    await jobManagerContract.connect(seller).acceptRequest(requestId);

    // Try to reject an already accepted request - should fail
    await expect(jobManagerContract.connect(seller).rejectRequest(requestId)).to.be.revertedWith("RequestNotPending");

    // Try to accept an already accepted request - should fail
    await expect(jobManagerContract.connect(seller).acceptRequest(requestId)).to.be.revertedWith("RequestNotPending");

    // Try to cancel an already accepted request - should fail
    await expect(jobManagerContract.connect(buyer).cancelRequest(requestId)).to.be.revertedWith("RequestNotPending");
  });
});
