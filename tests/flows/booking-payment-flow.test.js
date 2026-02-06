/**
 * Tests du flux complet de paiement booking :
 * Customer paie → Préautorisation → Provider confirme (capture) → Transfer au provider (10% commission)
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ---- Mock Stripe ----
const mockStripeTransfersCreate = jest.fn();
const mockStripePaymentIntentsCapture = jest.fn();
const mockStripePaymentIntentsCreate = jest.fn();
const mockStripeRefundsCreate = jest.fn();
const mockStripeCustomersCreate = jest.fn();

jest.unstable_mockModule("stripe", () => {
  const StripeMock = jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockStripePaymentIntentsCreate,
      capture: mockStripePaymentIntentsCapture,
      retrieve: jest.fn(),
    },
    transfers: { create: mockStripeTransfersCreate },
    refunds: { create: mockStripeRefundsCreate },
    customers: {
      create: mockStripeCustomersCreate,
      retrieve: jest.fn(),
      update: jest.fn(),
    },
    ephemeralKeys: { create: jest.fn() },
    setupIntents: { create: jest.fn() },
    paymentMethods: { list: jest.fn(), detach: jest.fn() },
  }));
  StripeMock.default = StripeMock;
  return { default: StripeMock };
});

// ---- Mock Supabase ----
const mockSupabaseFrom = jest.fn();

/**
 * Crée un objet Supabase chainable universel.
 * Chaque méthode retourne this, sauf les terminaux (maybeSingle, single) qui résolvent la data.
 */
function supabaseChain(resolvedData, resolvedError = null) {
  const resolved = Promise.resolve({ data: resolvedData, error: resolvedError });
  const chain = {};
  const methods = ["select", "eq", "not", "is", "or", "gte", "lte", "lt", "gt",
    "in", "neq", "like", "ilike", "order", "limit", "insert", "update", "delete"];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  // Terminaux
  chain.single = jest.fn().mockImplementation(() => resolved);
  chain.maybeSingle = jest.fn().mockImplementation(() => resolved);
  // Quand on await directement la chaîne (sans terminal)
  chain.then = (onResolve) => resolved.then(onResolve);
  return chain;
}

jest.unstable_mockModule("../../src/config/supabase.js", () => ({
  supabase: { auth: { getUser: jest.fn() }, from: mockSupabaseFrom },
  supabaseAdmin: { from: mockSupabaseFrom },
}));

jest.unstable_mockModule("../../src/config/commission.js", () => ({
  BOOKING_COMMISSION_RATE: 0.10,
  MISSION_COMMISSION_RATE: 0.07,
  getCommissionRate: jest.fn().mockReturnValue(0.10),
}));

// ---- Import modules under test ----
const { transferBookingToProviderCron } = await import(
  "../../src/cron/transferBookingToProvider.js"
);

describe("Booking Payment Flow — Transfer to Provider", () => {
  beforeEach(() => jest.clearAllMocks());

  // ============================================================
  // TRANSFER BOOKING TO PROVIDER CRON
  // ============================================================
  describe("transferBookingToProviderCron", () => {
    function pastBooking(overrides = {}) {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 5); // 5h dans le passé
      return {
        id: "booking-123",
        provider_id: "provider-abc",
        price: 100,
        currency: "eur",
        date: pastDate.toISOString().split("T")[0],
        start_time: String(pastDate.getHours()).padStart(2, "0") + ":00",
        stripe_charge_id: "ch_test123",
        provider_transfer_id: null,
        ...overrides,
      };
    }

    it("should transfer net amount (90%) to provider after 3h", async () => {
      const booking = pastBooking();

      // 1. getBookingsEligibleForTransfer
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain([booking]));
      // 2. getProviderStripeAccountId
      mockSupabaseFrom.mockReturnValueOnce(
        supabaseChain({ stripe_account_id: "acct_provider_123" })
      );
      // 3. update booking
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain(null));

      mockStripeTransfersCreate.mockResolvedValue({
        id: "tr_test_transfer",
        amount: 9000,
        destination: "acct_provider_123",
      });

      const result = await transferBookingToProviderCron();

      expect(result.transferred).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);

      // 100€ - 10% = 90€ net = 9000 centimes
      expect(mockStripeTransfersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 9000,
          currency: "eur",
          destination: "acct_provider_123",
          source_transaction: "ch_test123",
          metadata: expect.objectContaining({
            booking_id: "booking-123",
            type: "booking_payout",
            commission_rate: "0.1",
            commission_amount: "10",
          }),
        })
      );
    });

    it("should skip booking if provider has no Stripe account", async () => {
      const booking = pastBooking({ id: "booking-noaccount", provider_id: "provider-nope" });

      mockSupabaseFrom.mockReturnValueOnce(supabaseChain([booking]));
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain(null)); // No stripe account

      const result = await transferBookingToProviderCron();

      expect(result.transferred).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockStripeTransfersCreate).not.toHaveBeenCalled();
    });

    it("should skip booking if net amount is zero", async () => {
      const booking = pastBooking({ id: "booking-zero", price: 0 });

      mockSupabaseFrom.mockReturnValueOnce(supabaseChain([booking]));
      mockSupabaseFrom.mockReturnValueOnce(
        supabaseChain({ stripe_account_id: "acct_prov" })
      );

      const result = await transferBookingToProviderCron();

      expect(result.skipped).toBe(1);
      expect(mockStripeTransfersCreate).not.toHaveBeenCalled();
    });

    it("should handle Stripe transfer error gracefully", async () => {
      const booking = pastBooking({ id: "booking-fail", price: 200 });

      mockSupabaseFrom.mockReturnValueOnce(supabaseChain([booking]));
      mockSupabaseFrom.mockReturnValueOnce(
        supabaseChain({ stripe_account_id: "acct_prov_err" })
      );

      mockStripeTransfersCreate.mockRejectedValue(
        new Error("Insufficient funds in Stripe account")
      );

      const result = await transferBookingToProviderCron();

      expect(result.transferred).toBe(0);
      expect(result.failed).toBe(1);
    });

    it("should not transfer bookings that are not yet 3h old", async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 1);
      const booking = pastBooking({
        id: "booking-future",
        date: futureDate.toISOString().split("T")[0],
        start_time: String(futureDate.getHours()).padStart(2, "0") + ":00",
      });

      mockSupabaseFrom.mockReturnValueOnce(supabaseChain([booking]));

      const result = await transferBookingToProviderCron();

      expect(result.transferred).toBe(0);
      expect(mockStripeTransfersCreate).not.toHaveBeenCalled();
    });

    it("should calculate correct commission amounts", async () => {
      const booking = pastBooking({
        id: "booking-commission",
        price: 250.50,
        stripe_charge_id: "ch_calc",
      });

      mockSupabaseFrom.mockReturnValueOnce(supabaseChain([booking]));
      mockSupabaseFrom.mockReturnValueOnce(
        supabaseChain({ stripe_account_id: "acct_calc" })
      );
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain(null)); // update

      mockStripeTransfersCreate.mockResolvedValue({
        id: "tr_calc",
        amount: 22545,
      });

      await transferBookingToProviderCron();

      // 250.50€ * 10% = 25.05€ → net = 225.45€ = 22545 centimes
      expect(mockStripeTransfersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 22545,
          metadata: expect.objectContaining({
            commission_rate: "0.1",
            commission_amount: "25.05",
          }),
        })
      );
    });

    it("should handle multiple bookings in one cron run", async () => {
      const b1 = pastBooking({ id: "b1", provider_id: "p1", price: 100, stripe_charge_id: "ch1" });
      const b2 = pastBooking({ id: "b2", provider_id: "p2", price: 200, stripe_charge_id: "ch2" });

      mockSupabaseFrom.mockReturnValueOnce(supabaseChain([b1, b2]));
      // Provider 1
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain({ stripe_account_id: "acct_p1" }));
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain(null)); // update b1
      // Provider 2
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain({ stripe_account_id: "acct_p2" }));
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain(null)); // update b2

      mockStripeTransfersCreate
        .mockResolvedValueOnce({ id: "tr_1", amount: 9000 })
        .mockResolvedValueOnce({ id: "tr_2", amount: 18000 });

      const result = await transferBookingToProviderCron();

      expect(result.transferred).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockStripeTransfersCreate).toHaveBeenCalledTimes(2);
    });
  });
});
