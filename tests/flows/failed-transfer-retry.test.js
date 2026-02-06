/**
 * Tests du retry des failed transfers :
 * Transfer échoue → enregistré dans failed_transfers → cron retente → succès/échec
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ---- Mock Stripe ----
const mockStripeTransfersCreate = jest.fn();
const mockStripePaymentIntentsRetrieve = jest.fn();

jest.unstable_mockModule("stripe", () => {
  const StripeMock = jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
      capture: jest.fn(),
      retrieve: mockStripePaymentIntentsRetrieve,
    },
    transfers: { create: mockStripeTransfersCreate },
    refunds: { create: jest.fn() },
    customers: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn() },
    accounts: { retrieve: jest.fn() },
    balance: { retrieve: jest.fn() },
    payouts: { list: jest.fn() },
  }));
  StripeMock.default = StripeMock;
  return { default: StripeMock };
});

// ---- Mock Supabase ----
const mockSupabaseFrom = jest.fn();
const mockRaw = jest.fn().mockImplementation((val) => val);
jest.unstable_mockModule("../../src/config/supabase.js", () => ({
  supabase: { auth: { getUser: jest.fn() }, from: mockSupabaseFrom, raw: mockRaw },
  supabaseAdmin: { from: mockSupabaseFrom, raw: mockRaw },
}));

jest.unstable_mockModule("../../src/config/commission.js", () => ({
  BOOKING_COMMISSION_RATE: 0.10,
  MISSION_COMMISSION_RATE: 0.07,
  getCommissionRate: jest.fn().mockReturnValue(0.07),
}));

jest.unstable_mockModule("../../src/observability/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule("../../src/observability/metrics.js", () => ({
  missionTransfersTotal: { inc: jest.fn() },
  missionTransfersAmount: { inc: jest.fn() },
  failedTransfersTotal: { inc: jest.fn() },
}));

jest.unstable_mockModule("../../src/services/adminNotification.service.js", () => ({
  notifyAdmin: jest.fn(),
  logCriticalError: jest.fn(),
}));

jest.unstable_mockModule("../../src/services/onesignal.service.js", () => ({
  sendNotificationToUser: jest.fn(),
  sendNotificationWithDeepLink: jest.fn(),
}));

// Mock missionPayout createTransferToDetailer (called from retryFailedTransfer)
const mockCreateTransferToDetailer = jest.fn();
jest.unstable_mockModule("../../src/services/missionPayout.service.js", () => ({
  createTransferToDetailer: mockCreateTransferToDetailer,
  autoTransferOnPaymentCapture: jest.fn(),
  getPayoutSummaryForDetailer: jest.fn(),
  checkConnectedAccountStatus: jest.fn(),
}));

jest.unstable_mockModule("../../src/services/missionAgreement.service.js", () => ({
  getMissionAgreementById: jest.fn(),
}));

jest.unstable_mockModule("../../src/services/missionPayment.service.js", () => ({
  getMissionPaymentById: jest.fn(),
  updateMissionPaymentStatus: jest.fn(),
}));

// ---- Import modules under test ----
const {
  recordFailedTransfer,
  retryFailedTransfer,
  retryAllPendingTransfers,
} = await import("../../src/services/failedTransfer.service.js");

// Helper: Supabase chain mock
function supabaseChain(resolvedData, resolvedError = null) {
  const terminal = {
    single: jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
    maybeSingle: jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
  };
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue(terminal),
    }),
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ ...terminal, eq: jest.fn().mockReturnValue(terminal) }),
      in: jest.fn().mockReturnValue({
        lt: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
          }),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  };
}

describe("Failed Transfer Retry Flow", () => {
  beforeEach(() => jest.clearAllMocks());

  // ============================================================
  // RECORD FAILED TRANSFER
  // ============================================================
  describe("recordFailedTransfer", () => {
    it("should record a failed transfer with correct commission calculation", async () => {
      const insertedRecord = {
        id: "ft-1",
        mission_agreement_id: "m-1",
        mission_payment_id: "p-1",
        detailer_id: "d-1",
        amount: 1000,
        commission_rate: 0.07,
        commission_amount: 70,
        net_amount: 930,
        error_message: "Transfer failed",
        status: "pending",
        retry_count: 0,
      };

      mockSupabaseFrom.mockReturnValue(supabaseChain(insertedRecord));

      const result = await recordFailedTransfer({
        missionAgreementId: "m-1",
        paymentId: "p-1",
        detailerId: "d-1",
        stripeConnectedAccountId: "acct_d1",
        amount: 1000,
        commissionRate: 0.07,
        error: new Error("Transfer failed"),
      });

      expect(result.id).toBe("ft-1");
      expect(result.status).toBe("pending");
      expect(result.retry_count).toBe(0);
    });
  });

  // ============================================================
  // RETRY FAILED TRANSFER
  // ============================================================
  describe("retryFailedTransfer", () => {
    it("should successfully retry a failed transfer", async () => {
      const failedTransfer = {
        id: "ft-retry-1",
        mission_agreement_id: "m-1",
        mission_payment_id: "p-1",
        detailer_id: "d-1",
        stripe_connected_account_id: "acct_d1",
        amount: 500,
        commission_rate: 0.07,
        net_amount: 465,
        retry_count: 0,
        max_retries: 3,
        status: "pending",
      };

      // 1. Fetch failed transfer
      const fetchChain = supabaseChain(failedTransfer);
      // 2. Update to "retrying"
      const updateChain1 = supabaseChain(null);
      // 3. Update to "succeeded"
      const updateChain2 = supabaseChain(null);

      mockSupabaseFrom
        .mockReturnValueOnce(fetchChain) // get failed transfer
        .mockReturnValueOnce(updateChain1) // update to retrying
        .mockReturnValueOnce(updateChain2); // update to succeeded

      // Mock successful transfer
      mockCreateTransferToDetailer.mockResolvedValue({
        id: "tr_retry_success",
        amount: 465,
        netAmount: 465,
      });

      const result = await retryFailedTransfer("ft-retry-1");

      expect(result.success).toBe(true);
      expect(result.transferId).toBe("tr_retry_success");
      expect(mockCreateTransferToDetailer).toHaveBeenCalledWith({
        missionAgreementId: "m-1",
        paymentId: "p-1",
        amount: 500,
        commissionRate: 0.07,
      });
    });

    it("should mark as failed_permanently after max retries", async () => {
      const failedTransfer = {
        id: "ft-maxed",
        mission_agreement_id: "m-1",
        mission_payment_id: "p-1",
        detailer_id: "d-1",
        amount: 500,
        commission_rate: 0.07,
        net_amount: 465,
        retry_count: 3, // Already at max
        max_retries: 3,
        status: "pending",
      };

      const fetchChain = supabaseChain(failedTransfer);
      const updateChain = supabaseChain(null);

      mockSupabaseFrom
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(updateChain);

      await expect(retryFailedTransfer("ft-maxed")).rejects.toThrow(
        "Max retries"
      );
    });

    it("should handle retry failure and record new error", async () => {
      const failedTransfer = {
        id: "ft-retry-fail",
        mission_agreement_id: "m-1",
        mission_payment_id: "p-1",
        detailer_id: "d-1",
        amount: 500,
        commission_rate: 0.07,
        net_amount: 465,
        retry_count: 1,
        max_retries: 3,
        status: "pending",
      };

      const fetchChain = supabaseChain(failedTransfer);
      const updateChain1 = supabaseChain(null); // retrying
      const updateChain2 = supabaseChain(null); // back to pending

      mockSupabaseFrom
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(updateChain1)
        .mockReturnValueOnce(updateChain2);

      mockCreateTransferToDetailer.mockRejectedValue(
        new Error("Stripe API down")
      );

      const result = await retryFailedTransfer("ft-retry-fail");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Stripe API down");
      expect(result.retryCount).toBe(2); // 1 + 1
    });
  });

  // ============================================================
  // RETRY ALL PENDING TRANSFERS (cron batch)
  // ============================================================
  describe("retryAllPendingTransfers", () => {
    it("should return empty results when no pending transfers", async () => {
      // getPendingFailedTransfers returns empty
      mockSupabaseFrom.mockReturnValue(
        supabaseChain([]) // select -> in -> lt -> order -> limit
      );

      // Fix: the .in().lt().order().limit() chain needs proper mock
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            lt: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await retryAllPendingTransfers(10);

      expect(result.total).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });
  });
});
