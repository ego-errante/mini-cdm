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
  estimateJobAllowance,
  estimateJobGas,
} from "../utils";
import { TestDataset, DEFAULT_GAS_PRICE } from "@fhevm/shared";

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

  it("request should be marked completed when job finalizes", async () => {
    const jobParams = createDefaultJobParams();
    const datasetId = testDataset.id;
    const buyer = signers.bob;
    const seller = signers.alice;
    const requestId = await jobManagerContract.nextRequestId();
    const jobId = await jobManagerContract.nextJobId();
    const baseFee = ethers.parseEther("0.01");

    // Use gas estimation with 2x safety margin
    const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
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

    it("should hold base fee in escrow (not paid on accept)", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = await jobManagerContract.nextRequestId();

      const baseFee = ethers.parseEther("0.1");
      const computeAllowance = ethers.parseEther("0.5");
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

      // Verify base fee is stored in request
      const requestBefore = await jobManagerContract.getRequest(requestId);
      expect(requestBefore.baseFee).to.equal(baseFee);

      // Accept should NOT pay base fee (it's held in escrow until finalize)
      await jobManagerContract.connect(seller).acceptRequest(requestId);

      // Base fee should still be in the contract
      const requestAfter = await jobManagerContract.getRequest(requestId);
      expect(requestAfter.baseFee).to.equal(baseFee);
    });

    it("should pay base fee to seller on finalize", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = await jobManagerContract.nextRequestId();

      const baseFee = ethers.parseEther("0.1");
      const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
      const computeAllowance = estimateJobAllowance(
        testDataset.rows.length,
        testDataset.numColumns,
        "COUNT",
        0,
        gasPrice,
      );

      await jobManagerContract
        .connect(buyer)
        .submitRequest(datasetId, jobParams, baseFee, { value: baseFee + computeAllowance });

      await jobManagerContract.connect(seller).acceptRequest(requestId);

      const request = await jobManagerContract.getRequest(requestId);
      const jobId = request.jobId;

      // Process all rows
      for (let i = 0; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
      }

      // Track seller balance before finalize
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

      // Finalize the job
      const tx = await jobManagerContract.connect(seller).finalize(jobId);
      const receipt = await tx.wait();

      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);

      // Calculate what seller actually gained (accounting for gas spent on finalize)
      const gasCost = receipt?.gasUsed ? receipt.gasUsed * receipt.gasPrice : 0;
      const sellerNetGain = sellerBalanceAfter - sellerBalanceBefore + BigInt(gasCost);

      // Seller should receive: base fee + gas debt reimbursement
      // The net gain should be at least the base fee (gas debt reimbursement is close to gas spent)
      expect(sellerNetGain).to.be.gte(baseFee);

      // Verify base fee was paid (should be 0 now)
      const finalRequest = await jobManagerContract.getRequest(requestId);
      expect(finalRequest.baseFee).to.equal(0);
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
      const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
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

      // Get remaining allowance and base fee before reclaim (acceptRequest consumed some allowance)
      const requestBefore = await jobManagerContract.getRequest(requestId);
      const remainingAllowance = requestBefore.computeAllowance;
      const baseFeeStored = requestBefore.baseFee;

      // Buyer should get back: remaining allowance + base fee (job incomplete)
      const expectedRefund = remainingAllowance + baseFeeStored;

      await expect(await jobManagerContract.connect(buyer).reclaimStalled(requestId)).to.changeEtherBalance(
        buyer,
        expectedRefund,
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

  describe("Seller Balance Protection (CRITICAL)", () => {
    it("should ensure seller is never owed more than payment threshold before auto-payout", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const baseFee = ethers.parseEther("0.1");

      // Large allowance to ensure we can process all rows
      const computeAllowance = ethers.parseEther("1.0");
      const requestId = await jobManagerContract.nextRequestId();

      await jobManagerContract
        .connect(buyer)
        .submitRequest(datasetId, jobParams, baseFee, { value: baseFee + computeAllowance });

      await jobManagerContract.connect(seller).acceptRequest(requestId);
      const request = await jobManagerContract.getRequest(requestId);
      const jobId = request.jobId;

      const paymentThreshold = await jobManagerContract.paymentThreshold();
      let maxDebtSeen = 0n;

      // Process all rows and track debt accumulation
      for (let i = 0; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);

        const currentRequest = await jobManagerContract.getRequest(requestId);
        const currentDebt = currentRequest.gasDebtToSeller;

        if (currentDebt > maxDebtSeen) {
          maxDebtSeen = currentDebt;
        }

        // Critical: debt should never exceed threshold (would trigger auto-payout)
        expect(currentDebt).to.be.lte(paymentThreshold);
      }

      // Verify some debt was accumulated (seller did work)
      expect(maxDebtSeen).to.be.gt(0);
    });

    it("should ensure seller ends with approximately original balance + base fee after job completion", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const baseFee = ethers.parseEther("0.1");

      // Use gas estimation to ensure sufficient allowance
      const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
      const computeAllowance = estimateJobAllowance(
        testDataset.rows.length,
        testDataset.numColumns,
        "COUNT",
        0,
        gasPrice,
      );

      const requestId = await jobManagerContract.nextRequestId();

      // Capture seller's balance BEFORE any operations
      const sellerBalanceInitial = await ethers.provider.getBalance(seller.address);

      await jobManagerContract
        .connect(buyer)
        .submitRequest(datasetId, jobParams, baseFee, { value: baseFee + computeAllowance });

      // Accept request
      await jobManagerContract.connect(seller).acceptRequest(requestId);

      const request = await jobManagerContract.getRequest(requestId);
      const jobId = request.jobId;

      // Process all rows
      for (let i = 0; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
      }

      // Finalize
      await jobManagerContract.connect(seller).finalize(jobId);

      // Final seller balance
      const sellerBalanceFinal = await ethers.provider.getBalance(seller.address);

      // Calculate what seller actually gained/lost
      const sellerNetChange = sellerBalanceFinal - sellerBalanceInitial;

      // Seller should have gained approximately the base fee
      // There will be small discrepancies due to:
      // - 21000 base transaction cost per tx (not reimbursed)
      // - Gas overhead for tracking/payout operations
      // - Rounding in gas calculations

      // Allow 5% margin (seller might lose a bit due to overhead)
      const minExpected = (baseFee * 95n) / 100n; // 95% of base fee
      const maxExpected = baseFee; // Should never exceed base fee

      expect(sellerNetChange).to.be.gte(minExpected);
      expect(sellerNetChange).to.be.lte(maxExpected);

      // Verify no debt remains
      const finalRequest = await jobManagerContract.getRequest(requestId);
      expect(finalRequest.gasDebtToSeller).to.equal(0);
    });

    it("should track that gas costs come from buyer's allowance and accumulate as debt to seller", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const baseFee = ethers.parseEther("0.05");
      const computeAllowance = ethers.parseEther("0.5");

      const requestId = await jobManagerContract.nextRequestId();

      await jobManagerContract
        .connect(buyer)
        .submitRequest(datasetId, jobParams, baseFee, { value: baseFee + computeAllowance });

      const allowanceInitial = (await jobManagerContract.getRequest(requestId)).computeAllowance;
      expect(allowanceInitial).to.equal(computeAllowance);

      await jobManagerContract.connect(seller).acceptRequest(requestId);
      const request = await jobManagerContract.getRequest(requestId);
      const jobId = request.jobId;

      // Track allowance depletion during accept
      const allowanceAfterAccept = (await jobManagerContract.getRequest(requestId)).computeAllowance;
      const allowanceUsedByAccept = allowanceInitial - allowanceAfterAccept;
      expect(allowanceUsedByAccept).to.be.gt(0); // Accept consumed some allowance

      // Process one row
      await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0);

      const requestAfterPush = await jobManagerContract.getRequest(requestId);
      const allowanceAfterPush = requestAfterPush.computeAllowance;
      const totalAllowanceUsed = allowanceInitial - allowanceAfterPush;

      // Check that debt was accumulated (seller will be reimbursed)
      expect(requestAfterPush.gasDebtToSeller).to.be.gt(0);

      // The total debt should match total allowance used
      // (proving buyer's funds are covering all gas costs)
      expect(requestAfterPush.gasDebtToSeller).to.equal(totalAllowanceUsed);

      // Verify allowance decreased proportionally to work done
      expect(totalAllowanceUsed).to.be.lt(computeAllowance); // Didn't use everything
      expect(totalAllowanceUsed).to.be.gt(allowanceUsedByAccept); // pushRow used additional allowance
    });

    it("should automatically pay seller when debt reaches payment threshold", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const baseFee = ethers.parseEther("0.01");
      const computeAllowance = ethers.parseEther("1.0");

      // Set a very low threshold to ensure payout triggers quickly
      // Note: acceptRequest itself will likely exceed this threshold
      const lowThreshold = ethers.parseEther("0.0001");
      await jobManagerContract.connect(signers.deployer).setPaymentThreshold(lowThreshold);

      const requestId = await jobManagerContract.nextRequestId();

      await jobManagerContract
        .connect(buyer)
        .submitRequest(datasetId, jobParams, baseFee, { value: baseFee + computeAllowance });

      // Track debt before and after operations
      const requestBeforeAccept = await jobManagerContract.getRequest(requestId);
      expect(requestBeforeAccept.gasDebtToSeller).to.equal(0);

      await jobManagerContract.connect(seller).acceptRequest(requestId);

      // After accept, debt should have been accumulated and likely paid out due to low threshold
      const requestAfterAccept = await jobManagerContract.getRequest(requestId);

      // If threshold was hit during accept, debt should be cleared
      // Otherwise, debt should be below threshold
      expect(requestAfterAccept.gasDebtToSeller).to.be.lte(lowThreshold);

      const request = await jobManagerContract.getRequest(requestId);
      const jobId = request.jobId;

      // Process first row - with such a low threshold, this should definitely trigger payout
      await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0);

      // After pushRow, debt should again be below threshold (payout triggered)
      const requestAfterPush = await jobManagerContract.getRequest(requestId);
      expect(requestAfterPush.gasDebtToSeller).to.be.lte(lowThreshold);

      // Verify that some payout event occurred by checking that allowance was used
      expect(requestAfterPush.computeAllowance).to.be.lt(computeAllowance);
    });
  });

  describe("Admin Functions", () => {
    it("owner should be able to set payment threshold", async () => {
      const newThreshold = ethers.parseEther("0.08");
      const owner = signers.deployer; // deployer is the owner

      await expect(jobManagerContract.connect(owner).setPaymentThreshold(newThreshold))
        .to.emit(jobManagerContract, "ThresholdUpdated")
        .withArgs(newThreshold);

      expect(await jobManagerContract.paymentThreshold()).to.equal(newThreshold);
    });

    it("non-owner should not be able to set payment threshold", async () => {
      const newThreshold = ethers.parseEther("0.08");
      const nonOwner = signers.bob;

      await expect(
        jobManagerContract.connect(nonOwner).setPaymentThreshold(newThreshold),
      ).to.be.revertedWithCustomError(jobManagerContract, "OwnableUnauthorizedAccount");
    });

    it("owner should be able to set threshold to any value including zero", async () => {
      const owner = signers.deployer;

      // Test very low threshold
      const lowThreshold = ethers.parseEther("0.001");
      await jobManagerContract.connect(owner).setPaymentThreshold(lowThreshold);
      expect(await jobManagerContract.paymentThreshold()).to.equal(lowThreshold);

      // Test very high threshold
      const highThreshold = ethers.parseEther("10");
      await jobManagerContract.connect(owner).setPaymentThreshold(highThreshold);
      expect(await jobManagerContract.paymentThreshold()).to.equal(highThreshold);

      // Test zero threshold
      await jobManagerContract.connect(owner).setPaymentThreshold(0);
      expect(await jobManagerContract.paymentThreshold()).to.equal(0);
    });
  });

  describe("Manual Payout", () => {
    it("seller should be able to request manual payout", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = 1; // IDs start at 1
      const jobId = 1; // IDs start at 1

      const baseFee = ethers.parseEther("0.01");
      const computeAllowance = ethers.parseEther("0.1");
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });
      await jobManagerContract.connect(seller).acceptRequest(requestId);

      // Process one row to accumulate some debt
      await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0);

      const requestBefore = await jobManagerContract.getRequest(requestId);
      const debtBefore = requestBefore.gasDebtToSeller;

      expect(debtBefore).to.be.gt(0);

      // Seller requests manual payout
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
      const tx = await jobManagerContract.connect(seller).requestPayout(requestId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);

      // Check that debt was paid out
      const requestAfter = await jobManagerContract.getRequest(requestId);
      expect(requestAfter.gasDebtToSeller).to.equal(0);

      // Check seller received the payment (minus gas for the requestPayout call)
      const netGain = sellerBalanceAfter - sellerBalanceBefore + gasUsed;
      expect(netGain).to.equal(debtBefore);
    });

    it("non-seller should not be able to request payout", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const nonSeller = signers.deployer;
      const requestId = 1; // IDs start at 1

      const baseFee = ethers.parseEther("0.01");
      const computeAllowance = ethers.parseEther("0.1");
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });
      await jobManagerContract.connect(seller).acceptRequest(requestId);

      await expect(jobManagerContract.connect(nonSeller).requestPayout(requestId)).to.be.revertedWithCustomError(
        jobManagerContract,
        "NotDatasetOwner",
      );
    });

    it("should not allow payout on non-accepted request", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const requestId = 1; // IDs start at 1

      const baseFee = ethers.parseEther("0.01");
      const computeAllowance = ethers.parseEther("0.1");
      const totalValue = BigInt(baseFee) + BigInt(computeAllowance);

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });
      // Don't accept the request

      // Should fail because request is not in ACCEPTED state
      await expect(jobManagerContract.connect(seller).requestPayout(requestId)).to.be.revertedWithCustomError(
        jobManagerContract,
        "RequestNotPending",
      );
    });
  });

  describe("View Functions", () => {
    it("should return correct nextRequestId", async () => {
      const nextId = await jobManagerContract.nextRequestId();
      expect(nextId).to.equal(1); // Starts at 1

      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const baseFee = ethers.parseEther("0.01");
      const totalValue = ethers.parseEther("0.1");

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });

      const nextIdAfter = await jobManagerContract.nextRequestId();
      expect(nextIdAfter).to.equal(2);
    });

    it("should track job progress correctly", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const baseFee = ethers.parseEther("0.01");
      const totalValue = ethers.parseEther("0.1");

      await jobManagerContract.connect(buyer).submitRequest(datasetId, jobParams, baseFee, { value: totalValue });
      await jobManagerContract.connect(seller).acceptRequest(1);

      const request = await jobManagerContract.getRequest(1);
      const jobId = request.jobId;

      // Check initial progress (no rows processed)
      let progress = await jobManagerContract.getJobProgress(jobId);
      expect(progress.totalRows).to.equal(testDataset.rows.length);
      expect(progress.processedRows).to.equal(0);
      expect(progress.remainingRows).to.equal(testDataset.rows.length);

      // Process first row
      await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0);

      progress = await jobManagerContract.getJobProgress(jobId);
      expect(progress.totalRows).to.equal(testDataset.rows.length);
      expect(progress.processedRows).to.equal(1);
      expect(progress.remainingRows).to.equal(testDataset.rows.length - 1);

      // Process second row
      await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[1], testDataset.proofs[1], 1);

      progress = await jobManagerContract.getJobProgress(jobId);
      expect(progress.processedRows).to.equal(2);
      expect(progress.remainingRows).to.equal(testDataset.rows.length - 2);

      // Process all remaining rows
      for (let i = 2; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(seller).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
      }

      progress = await jobManagerContract.getJobProgress(jobId);
      expect(progress.processedRows).to.equal(testDataset.rows.length);
      expect(progress.remainingRows).to.equal(0);
    });
  });

  describe("Proactive vs Reactive Allowance Management", () => {
    it("should fail without monitoring and succeed with proactive top-ups", async () => {
      const jobParams = createDefaultJobParams();
      const datasetId = testDataset.id;
      const buyer = signers.bob;
      const seller = signers.alice;
      const baseFee = ethers.parseEther("0.01");

      // Intentionally low allowance that won't cover all rows
      // This should cover acceptRequest + 1-2 rows before running out
      const insufficientAllowance = ethers.parseEther("0.001");

      // ========================================
      // JOB 1: No monitoring - should FAIL
      // ========================================
      console.log("\n--- Job 1: No monitoring (will fail) ---");

      await jobManagerContract
        .connect(buyer)
        .submitRequest(datasetId, jobParams, baseFee, { value: baseFee + insufficientAllowance });

      const requestId1 = 1;
      await jobManagerContract.connect(seller).acceptRequest(requestId1);

      const request1 = await jobManagerContract.getRequest(requestId1);
      const jobId1 = request1.jobId;

      // Seller tries to process rows without buyer monitoring
      let job1Failed = false;
      let job1RowsProcessed = 0;

      for (let i = 0; i < testDataset.rows.length; i++) {
        try {
          await jobManagerContract.connect(seller).pushRow(jobId1, testDataset.rows[i], testDataset.proofs[i], i);
          job1RowsProcessed++;
          console.log(`Row ${i}: Success`);
        } catch (error: any) {
          if (error.message.includes("InsufficientAllowance")) {
            console.log(`Row ${i}: Failed - InsufficientAllowance`);
            job1Failed = true;
            break;
          }
          throw error;
        }
      }

      expect(job1Failed).to.be.true;
      expect(job1RowsProcessed).to.be.lt(testDataset.rows.length);
      console.log(`Job 1 processed ${job1RowsProcessed}/${testDataset.rows.length} rows before failing`);

      // ========================================
      // JOB 2: Proactive monitoring - should SUCCEED
      // ========================================
      console.log("\n--- Job 2: Proactive monitoring (will succeed) ---");

      await jobManagerContract
        .connect(buyer)
        .submitRequest(datasetId, jobParams, baseFee, { value: baseFee + insufficientAllowance });

      const requestId2 = 2;
      await jobManagerContract.connect(seller).acceptRequest(requestId2);

      const request2 = await jobManagerContract.getRequest(requestId2);
      const jobId2 = request2.jobId;

      let totalToppedUp = 0n;
      let topUpCount = 0;

      // Seller processes rows with buyer actively monitoring
      for (let i = 0; i < testDataset.rows.length; i++) {
        // BEFORE each pushRow, buyer checks and tops up if needed
        const currentRequest = await jobManagerContract.getRequest(requestId2);
        const progress = await jobManagerContract.getJobProgress(jobId2);

        // Estimate remaining cost
        const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
        const estimatedGas = estimateJobGas(1, testDataset.numColumns, "COUNT", 0);
        const estimatedCostPerRow = estimatedGas * gasPrice;
        const remainingRows = progress.remainingRows;
        const estimatedRemainingCost = estimatedCostPerRow * BigInt(remainingRows);

        // Top up if allowance won't cover remaining work (with 2x safety margin)
        const requiredAllowance = estimatedRemainingCost * 2n;

        if (currentRequest.computeAllowance < requiredAllowance) {
          const topUpAmount = requiredAllowance - currentRequest.computeAllowance;
          console.log(
            `Row ${i}: Allowance ${ethers.formatEther(currentRequest.computeAllowance)} too low, topping up ${ethers.formatEther(topUpAmount)}`,
          );

          await jobManagerContract.connect(buyer).topUpAllowance(requestId2, { value: topUpAmount });
          totalToppedUp += topUpAmount;
          topUpCount++;
        }

        // Now seller can safely push the row
        await jobManagerContract.connect(seller).pushRow(jobId2, testDataset.rows[i], testDataset.proofs[i], i);
        console.log(`Row ${i}: Success`);
      }

      // Check allowance one more time before finalize
      const finalRequest = await jobManagerContract.getRequest(requestId2);
      const finalProgress = await jobManagerContract.getJobProgress(jobId2);
      const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
      const finalizeGas = estimateJobGas(1, testDataset.numColumns, "COUNT", 0);
      const finalizeGasEstimate = finalizeGas * gasPrice * 2n;

      if (finalRequest.computeAllowance < finalizeGasEstimate) {
        const topUpAmount = finalizeGasEstimate - finalRequest.computeAllowance;
        console.log(`Finalize: Topping up ${ethers.formatEther(topUpAmount)} for finalize operation`);
        await jobManagerContract.connect(buyer).topUpAllowance(requestId2, { value: topUpAmount });
        totalToppedUp += topUpAmount;
        topUpCount++;
      }

      // Finalize should succeed
      await jobManagerContract.connect(seller).finalize(jobId2);

      console.log(`\nJob 2 succeeded!`);
      console.log(`Total topped up: ${ethers.formatEther(totalToppedUp)} ETH in ${topUpCount} top-ups`);

      // Verify job 2 completed successfully
      const completedRequest = await jobManagerContract.getRequest(requestId2);
      expect(completedRequest.status).to.equal(3); // COMPLETED
      expect(topUpCount).to.be.gt(0); // Should have required at least one top-up

      const completedProgress = await jobManagerContract.getJobProgress(jobId2);
      expect(completedProgress.processedRows).to.equal(testDataset.rows.length);
      expect(completedProgress.remainingRows).to.equal(0);
    });
  });
});
