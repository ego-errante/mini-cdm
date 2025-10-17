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
  estimateJobAllowance,
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
    const baseFee = ethers.parseEther("0.01");
    const totalValue = ethers.parseEther("0.1");

    const nextRequestId = await jobManagerContract.nextRequestId();
    await expect(jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue }))
      .to.emit(jobManagerContract, "RequestSubmitted")
      .withArgs(nextRequestId, datasetId, buyer.address);
  });

  it("buyer should be able to cancel a request if a job has not been started yet", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const requestId = await jobManagerContract.nextRequestId();
    const baseFee = ethers.parseEther("0.01");
    const totalValue = ethers.parseEther("0.1");

    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

    await expect(jobManagerContract.connect(buyer).cancelRequest(requestId))
      .to.emit(jobManagerContract, "RequestCancelled")
      .withArgs(requestId);
  });

  it("seller should be able to accept a buyer's request and start a job", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const seller = signers.alice;
    const requestId = await jobManagerContract.nextRequestId();
    const baseFee = ethers.parseEther("0.01");
    const totalValue = ethers.parseEther("0.1");

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

    // Seller accepts request
    const nextJobId = await jobManagerContract.nextJobId();
    await expect(jobManagerContract.connect(seller).acceptRequest(requestId))
      .to.emit(jobManagerContract, "RequestAccepted")
      .withArgs(requestId, nextJobId); // requestId, jobId
  });

  it("seller should be able to reject a buyer's request", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const seller = signers.alice;
    const requestId = await jobManagerContract.nextRequestId();
    const baseFee = ethers.parseEther("0.01");
    const totalValue = ethers.parseEther("0.1");

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

    // Seller rejects request
    await expect(jobManagerContract.connect(seller).rejectRequest(requestId))
      .to.emit(jobManagerContract, "RequestRejected")
      .withArgs(requestId);
  });

  it("should be able to retrieve request details", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const requestId = await jobManagerContract.nextRequestId();
    const baseFee = ethers.parseEther("0.01");
    const totalValue = ethers.parseEther("0.1");

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

    // Get request details
    const request = await jobManagerContract.getRequest(requestId);

    expect(request.datasetId).to.equal(datasetId);
    expect(request.buyer).to.equal(buyer.address);
    expect(request.status).to.equal(0); // PENDING = 0
    expect(request.timestamp).to.be.gt(0);
    expect(request.baseFee).to.equal(baseFee);
    expect(request.computeAllowance).to.equal(totalValue - baseFee);
  });

  it("should be able to retrieve buyer's requests for a dataset", async () => {
    const jobParams1 = createDefaultJobParams();
    const jobParams2 = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const baseFee = ethers.parseEther("0.01");
    const totalValue = ethers.parseEther("0.1");

    // Submit multiple requests
    const requestId1 = await jobManagerContract.nextRequestId();
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams1, baseFee, { value: totalValue });
    const requestId2 = await jobManagerContract.nextRequestId();
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams2, baseFee, { value: totalValue });

    // Get buyer's requests
    const buyerRequests = await jobManagerContract.getBuyerRequests(buyer.address, datasetId);

    expect(buyerRequests.length).to.equal(2);
    expect(buyerRequests[0]).to.equal(requestId1);
    expect(buyerRequests[1]).to.equal(requestId2);
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
    const requestId = await jobManagerContract.nextRequestId();
    const jobId = await jobManagerContract.nextJobId();
    const baseFee = ethers.parseEther("0.01");

    // Use gas estimation with 2x safety margin
    const gasPrice = (await ethers.provider.getFeeData()).gasPrice || ethers.parseUnits("20", "gwei");
    const computeAllowance = estimateJobAllowance(
      testDataset.rows.length,
      testDataset.numColumns,
      "COUNT",
      0, // no filter
      gasPrice,
    );
    const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

    // Seller accepts and starts job
    await jobManagerContract.connect(seller).acceptRequest(requestId);

    // Check request status before finalization
    let request = await jobManagerContract.getRequest(requestId);
    expect(request.status).to.equal(1); // ACCEPTED = 1

    // Push all rows to the job to allow finalization
    for (let i = 0; i < testDataset.rows.length; i++) {
      await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
    }

    await jobManagerContract.connect(seller).finalize(jobId);

    // Check request status after finalization
    request = await jobManagerContract.getRequest(requestId);
    expect(request.status).to.equal(3); // COMPLETED = 3
  });

  it("should prevent operations on non-pending requests", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const seller = signers.alice;
    const requestId = await jobManagerContract.nextRequestId();
    const baseFee = ethers.parseEther("0.01");
    const totalValue = ethers.parseEther("0.1");

    // Submit request
    await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

    // Accept the request
    await jobManagerContract.connect(seller).acceptRequest(requestId);

    // Try to reject an already accepted request - should fail
    await expect(jobManagerContract.connect(seller).rejectRequest(requestId)).to.be.revertedWithCustomError(
      jobManagerContract,
      "RequestNotPending",
    );

    // Try to accept an already accepted request - should fail
    await expect(jobManagerContract.connect(seller).acceptRequest(requestId)).to.be.revertedWithCustomError(
      jobManagerContract,
      "RequestNotPending",
    );

    // Try to cancel an already accepted request - should fail
    await expect(jobManagerContract.connect(buyer).cancelRequest(requestId)).to.be.revertedWithCustomError(
      jobManagerContract,
      "RequestNotPending",
    );
  });

  describe("Payment System", () => {
    it("should revert submitRequest if payment is less than base fee", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const baseFee = ethers.parseEther("0.1");
      const valueSent = ethers.parseEther("0.05"); // less than baseFee

      await expect(
        jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: valueSent }),
      ).to.be.revertedWithCustomError(jobManagerContract, "InsufficientPayment");
    });

    it("should pay base fee to seller upon acceptRequest", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = await jobManagerContract.nextRequestId();

      const baseFee = ethers.parseEther("0.1");
      const computeAllowance = ethers.parseEther("0.5");
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

      await expect(await jobManagerContract.connect(seller).acceptRequest(requestId)).to.changeEtherBalance(
        seller,
        baseFee,
      );
    });

    it("should refund buyer on cancelRequest", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const requestId = await jobManagerContract.nextRequestId();

      const baseFee = ethers.parseEther("0.1");
      const computeAllowance = ethers.parseEther("0.5");
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

      await expect(await jobManagerContract.connect(buyer).cancelRequest(requestId)).to.changeEtherBalance(
        buyer,
        totalValue,
      );
    });

    it("should refund remaining allowance to buyer on finalize", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = await jobManagerContract.nextRequestId();
      const jobId = await jobManagerContract.nextJobId();

      const baseFee = ethers.parseEther("0.1");

      // Use gas estimation with 2x safety margin
      const gasPrice = (await ethers.provider.getFeeData()).gasPrice || ethers.parseUnits("20", "gwei");
      const computeAllowance = estimateJobAllowance(
        testDataset.rows.length,
        testDataset.numColumns,
        "COUNT",
        0, // no filter
        gasPrice,
      );
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });
      await jobManagerContract.connect(seller).acceptRequest(requestId);

      // Push all rows to the job to allow finalization
      for (let i = 0; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
      }

      // Gas will be consumed during operations, so buyer gets back less than initial allowance
      const requestBeforeFinalize = await jobManagerContract.getRequest(requestId);
      const remainingAllowance = requestBeforeFinalize.computeAllowance;

      // The finalize call itself consumes gas from the allowance before refunding,
      // so the actual refund will be slightly less than what we see before the call
      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);
      await jobManagerContract.connect(seller).finalize(jobId);
      const buyerBalanceAfter = await ethers.provider.getBalance(buyer.address);

      const actualRefund = buyerBalanceAfter - buyerBalanceBefore;
      // Should be close to remainingAllowance, allowing for finalize gas consumption
      expect(actualRefund).to.be.gt(0);
      expect(actualRefund).to.be.lte(remainingAllowance);
    });

    it("should allow buyer to reclaim funds from stalled job", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = await jobManagerContract.nextRequestId();

      const baseFee = ethers.parseEther("0.1");
      const computeAllowance = ethers.parseEther("0.5");
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });
      await jobManagerContract.connect(seller).acceptRequest(requestId);

      const STALL_TIMEOUT = 24 * 60 * 60; // 24 hours in seconds
      await ethers.provider.send("evm_increaseTime", [STALL_TIMEOUT + 1]);
      await ethers.provider.send("evm_mine", []);

      // Get remaining allowance before reclaim (acceptRequest consumed some)
      const requestBefore = await jobManagerContract.getRequest(requestId);
      const remainingAllowance = requestBefore.computeAllowance;

      await expect(await jobManagerContract.connect(buyer).reclaimStalled(requestId)).to.changeEtherBalance(
        buyer,
        remainingAllowance,
      );
    });

    it("should allow buyer to top up compute allowance", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = await jobManagerContract.nextRequestId();

      const baseFee = ethers.parseEther("0.1");
      const computeAllowance = ethers.parseEther("0.5");
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });
      await jobManagerContract.connect(seller).acceptRequest(requestId);

      const requestBeforeTopUp = await jobManagerContract.getRequest(requestId);
      // Accept request consumes gas, so allowance will be less than initial
      expect(requestBeforeTopUp.computeAllowance).to.be.lt(computeAllowance);
      expect(requestBeforeTopUp.computeAllowance).to.be.gt(0);

      const topUpAmount = ethers.parseEther("0.2");
      await jobManagerContract.connect(buyer).topUpAllowance(requestId, { value: topUpAmount });

      const requestAfterTopUp = await jobManagerContract.getRequest(requestId);
      const expectedAllowance = BigInt(requestBeforeTopUp.computeAllowance) + BigInt(topUpAmount);
      expect(requestAfterTopUp.computeAllowance).to.equal(expectedAllowance);
    });

    it("should dynamically catch InsufficientAllowance and top up during processing", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = await jobManagerContract.nextRequestId();
      let jobId = await jobManagerContract.nextJobId();

      const baseFee = ethers.parseEther("0.001");
      // Very small allowance - should fail on first or second pushRow
      const initialAllowance = ethers.parseEther("0.002");
      const totalValue = BigInt(baseFee) + BigInt(initialAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

      // Accept might work with this allowance
      try {
        jobId = await jobManagerContract.nextJobId();
        await jobManagerContract.connect(seller).acceptRequest(requestId);
      } catch (error: any) {
        if (error.message.includes("InsufficientAllowance")) {
          // If acceptRequest fails, top up and retry
          await jobManagerContract.connect(buyer).topUpAllowance(requestId, { value: ethers.parseEther("0.01") });
          jobId = await jobManagerContract.nextJobId();
          await jobManagerContract.connect(seller).acceptRequest(requestId);
        } else {
          throw error;
        }
      }

      let topUpCount = 0;
      const maxTopUps = 5;
      const topUpAmount = ethers.parseEther("0.01");

      // Push all rows with automatic top-up on insufficient allowance
      for (let i = 0; i < testDataset.rows.length; i++) {
        let success = false;
        let attempts = 0;

        while (!success && attempts < maxTopUps) {
          try {
            await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
            success = true;
          } catch (error: any) {
            // Check if error is InsufficientAllowance
            if (error.message.includes("InsufficientAllowance")) {
              topUpCount++;
              attempts++;
              console.log(`Row ${i}: InsufficientAllowance detected, topping up (attempt ${attempts})`);

              // Buyer tops up allowance
              await jobManagerContract.connect(buyer).topUpAllowance(requestId, { value: topUpAmount });

              // Retry the operation
            } else {
              // Different error, rethrow
              throw error;
            }
          }
        }

        if (!success) {
          throw new Error(`Failed to process row ${i} after ${maxTopUps} top-up attempts`);
        }
      }

      // Should have triggered at least one top-up
      expect(topUpCount).to.be.gt(0);
      console.log(`Total top-ups required: ${topUpCount}`);

      // Try to finalize (might also need a top-up)
      let finalizeSuccess = false;
      let finalizeAttempts = 0;

      while (!finalizeSuccess && finalizeAttempts < maxTopUps) {
        try {
          await jobManagerContract.connect(seller).finalize(jobId);
          finalizeSuccess = true;
        } catch (error: any) {
          if (error.message.includes("InsufficientAllowance")) {
            topUpCount++;
            finalizeAttempts++;
            console.log(`Finalize: InsufficientAllowance detected, topping up (attempt ${finalizeAttempts})`);
            await jobManagerContract.connect(buyer).topUpAllowance(requestId, { value: topUpAmount });
          } else {
            throw error;
          }
        }
      }

      expect(finalizeSuccess).to.be.true;

      // Verify job was completed
      const request = await jobManagerContract.getRequest(requestId);
      expect(request.status).to.equal(3); // COMPLETED
    });
  });
});
