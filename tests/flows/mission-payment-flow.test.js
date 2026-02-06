/**
 * Tests du flux complet de paiement Mission B2B :
 * Company → Deposit/Monthly → Capture → Transfer au detailer (7% commission)
 * + Retry des failed transfers
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
jest.unstable_mockModule("../../src/config/supabase.js", () => ({
  supabase: { auth: { getUser: jest.fn() }, from: mockSupabaseFrom },
  supabaseAdmin: { from: mockSupabaseFrom },
}));

jest.unstable_mockModule("../../src/config/commission.js", () => ({
  BOOKING_COMMISSION_RATE: 0.10,
  MISSION_COMMISSION_RATE: 0.07,
  getCommissionRate: jest.fn().mockReturnValue(0.07),
}));

// ---- Mock dependencies of missionPayout.service ----
const mockGetMissionAgreementById = jest.fn();
jest.unstable_mockModule("../../src/services/missionAgreement.service.js", () => ({
  getMissionAgreementById: mockGetMissionAgreementById,
}));

const mockGetMissionPaymentById = jest.fn();
const mockUpdateMissionPaymentStatus = jest.fn();
jest.unstable_mockModule("../../src/services/missionPayment.service.js", () => ({
  getMissionPaymentById: mockGetMissionPaymentById,
  updateMissionPaymentStatus: mockUpdateMissionPaymentStatus,
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

// ---- Import modules under test ----
const { createTransferToDetailer } = await import(
  "../../src/services/missionPayout.service.js"
);

describe("Mission B2B Payment Flow — Transfer to Detailer", () => {
  beforeEach(() => jest.clearAllMocks());

  // ============================================================
  // CREATE TRANSFER TO DETAILER
  // ============================================================
  describe("createTransferToDetailer", () => {
    it("should transfer net amount (93%) to detailer after capture", async () => {
      // Mission Agreement
      mockGetMissionAgreementById.mockResolvedValue({
        id: "mission-123",
        detailerId: "detailer-user-1",
        stripeConnectedAccountId: "acct_detailer_123",
        companyId: "company-1",
        finalPrice: 1000,
      });

      // Mission Payment (captured)
      mockGetMissionPaymentById.mockResolvedValue({
        id: "payment-456",
        missionAgreementId: "mission-123",
        amount: 1000,
        status: "captured",
        stripePaymentIntentId: "pi_mission_test",
      });

      // Stripe: retrieve PI to get charge ID
      mockStripePaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_mission_test",
        latest_charge: "ch_mission_charge",
      });

      // Stripe: create transfer
      mockStripeTransfersCreate.mockResolvedValue({
        id: "tr_mission_transfer",
        amount: 93000, // 930€ en centimes
        destination: "acct_detailer_123",
        reversed: false,
        created: Date.now() / 1000,
      });

      const result = await createTransferToDetailer({
        missionAgreementId: "mission-123",
        paymentId: "payment-456",
        amount: 1000,
        commissionRate: 0.07,
      });

      // Vérifier le résultat
      expect(result.id).toBe("tr_mission_transfer");
      expect(result.netAmount).toBe(930); // 1000€ - 7% = 930€
      expect(result.commissionAmount).toBe(70); // 7% de 1000€
      expect(result.destination).toBe("acct_detailer_123");

      // Vérifier l'appel Stripe
      expect(mockStripeTransfersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 93000, // 930€ en centimes
          currency: "eur",
          destination: "acct_detailer_123",
          source_transaction: "ch_mission_charge",
          metadata: expect.objectContaining({
            missionAgreementId: "mission-123",
            paymentId: "payment-456",
            commissionRate: "0.07",
            commissionAmount: "70",
            netAmount: "930",
          }),
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining("transfer-payment-456-"),
        })
      );
    });

    it("should throw if mission agreement not found", async () => {
      mockGetMissionAgreementById.mockResolvedValue(null);

      await expect(
        createTransferToDetailer({
          missionAgreementId: "nonexistent",
          paymentId: "p-1",
          amount: 100,
        })
      ).rejects.toThrow("Mission Agreement not found");
    });

    it("should throw if detailer has no Stripe Connect account", async () => {
      mockGetMissionAgreementById.mockResolvedValue({
        id: "mission-nostripe",
        detailerId: "detailer-nostripe",
        stripeConnectedAccountId: null,
      });

      await expect(
        createTransferToDetailer({
          missionAgreementId: "mission-nostripe",
          paymentId: "p-2",
          amount: 500,
        })
      ).rejects.toThrow("Stripe Connected Account");
    });

    it("should throw if payment intent has no charge", async () => {
      mockGetMissionAgreementById.mockResolvedValue({
        id: "mission-nocharge",
        detailerId: "det-1",
        stripeConnectedAccountId: "acct_det_nocharge",
      });

      mockGetMissionPaymentById.mockResolvedValue({
        id: "pay-nocharge",
        missionAgreementId: "mission-nocharge",
        amount: 200,
        status: "captured",
        stripePaymentIntentId: "pi_nocharge",
      });

      mockStripePaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_nocharge",
        latest_charge: null, // No charge yet
      });

      await expect(
        createTransferToDetailer({
          missionAgreementId: "mission-nocharge",
          paymentId: "pay-nocharge",
          amount: 200,
        })
      ).rejects.toThrow("Charge ID not found");
    });

    it("should correctly calculate commission for various amounts", async () => {
      // 350.75€ at 7% → commission 24.55€, net 326.20€
      mockGetMissionAgreementById.mockResolvedValue({
        id: "mission-calc",
        detailerId: "det-calc",
        stripeConnectedAccountId: "acct_calc",
      });

      mockGetMissionPaymentById.mockResolvedValue({
        id: "pay-calc",
        missionAgreementId: "mission-calc",
        amount: 350.75,
        status: "captured",
        stripePaymentIntentId: "pi_calc",
      });

      mockStripePaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_calc",
        latest_charge: "ch_calc",
      });

      mockStripeTransfersCreate.mockResolvedValue({
        id: "tr_calc",
        amount: 32620,
        destination: "acct_calc",
        reversed: false,
        created: Date.now() / 1000,
      });

      const result = await createTransferToDetailer({
        missionAgreementId: "mission-calc",
        paymentId: "pay-calc",
        amount: 350.75,
        commissionRate: 0.07,
      });

      // 350.75 * 0.07 = 24.5525 → arrondi à 24.55
      expect(result.commissionAmount).toBe(24.55);
      // 350.75 - 24.55 = 326.20
      expect(result.netAmount).toBe(326.2);

      expect(mockStripeTransfersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 32620, // 326.20€ en centimes
        }),
        expect.any(Object)
      );
    });
  });
});
