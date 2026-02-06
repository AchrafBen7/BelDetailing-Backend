/**
 * Tests de la politique d'annulation/remboursement NIOS :
 * - Plus de 48h avant : 100% remboursé
 * - 24h-48h avant : Total - frais NIOS (5%, min 10€)
 * - Moins de 24h : Service seulement (transport + frais NIOS retenus)
 * - Preauthorization → cancel = refund intégral
 * - Decline par provider → refund intégral de la preauth
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ---- Mock Stripe ----
const mockStripePaymentIntentsCapture = jest.fn();
const mockStripeRefundsCreate = jest.fn();
const mockStripeCustomersCreate = jest.fn();

jest.unstable_mockModule("stripe", () => {
  const StripeMock = jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
      capture: mockStripePaymentIntentsCapture,
      retrieve: jest.fn(),
    },
    transfers: { create: jest.fn() },
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

function supabaseChain(resolvedData, resolvedError = null) {
  const resolved = Promise.resolve({ data: resolvedData, error: resolvedError });
  const chain = {};
  const methods = ["select", "eq", "not", "is", "or", "gte", "lte", "lt", "gt",
    "in", "neq", "like", "ilike", "order", "limit", "insert", "update", "delete"];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockReturnValue(resolved);
  chain.maybeSingle = jest.fn().mockReturnValue(resolved);
  chain.then = (onResolve, onReject) => resolved.then(onResolve, onReject);
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

// Mock services used by booking.controller
const mockGetBookings = jest.fn();
const mockGetBookingDetail = jest.fn();
const mockUpdateBookingService = jest.fn();
const mockUpdateBookingStatus = jest.fn();
const mockCleanupExpiredBookings = jest.fn();

jest.unstable_mockModule("../../src/services/booking.service.js", () => ({
  getBookings: mockGetBookings,
  getBookingDetail: mockGetBookingDetail,
  updateBookingService: mockUpdateBookingService,
  updateBookingStatus: mockUpdateBookingStatus,
  cleanupExpiredBookings: mockCleanupExpiredBookings,
}));

const mockCreatePaymentIntent = jest.fn();
const mockRefundPayment = jest.fn();
const mockCapturePayment = jest.fn();

jest.unstable_mockModule("../../src/services/payment.service.js", () => ({
  createPaymentIntent: mockCreatePaymentIntent,
  refundPayment: mockRefundPayment,
  capturePayment: mockCapturePayment,
}));

jest.unstable_mockModule("../../src/services/onesignal.service.js", () => ({
  sendNotificationToUser: jest.fn(),
  sendNotificationWithDeepLink: jest.fn(),
}));

jest.unstable_mockModule("../../src/services/peppol.service.js", () => ({
  sendPeppolInvoice: jest.fn(),
}));

// ---- Import ----
const {
  cancelBooking,
  declineBooking,
  confirmBooking,
  refundBooking,
} = await import("../../src/controllers/booking.controller.js");

// ---- Helpers ----
function mockRequest(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: { authorization: "Bearer test-token" },
    user: { id: "u1", email: "test@test.com", role: "customer" },
    ...overrides,
  };
}

function mockResponse() {
  const res = {};
  res._status = 200;
  res._json = null;
  res.status = jest.fn().mockImplementation((s) => { res._status = s; return res; });
  res.json = jest.fn().mockImplementation((d) => { res._json = d; return res; });
  return res;
}

function futureBooking(hoursFromNow, overrides = {}) {
  const bookingDate = new Date();
  bookingDate.setHours(bookingDate.getHours() + hoursFromNow);
  return {
    id: "booking-cancel",
    customer_id: "u1",
    provider_id: "prov-1",
    provider_name: "TestDetailer",
    service_name: "Full Wash",
    price: 200,
    transport_fee: 20,
    currency: "eur",
    date: bookingDate.toISOString().split("T")[0],
    start_time: String(bookingDate.getHours()).padStart(2, "0") + ":00",
    end_time: String(bookingDate.getHours() + 1).padStart(2, "0") + ":00",
    status: "confirmed",
    payment_status: "paid",
    payment_intent_id: "pi_cancel_test",
    created_at: new Date(Date.now() - 3600 * 1000).toISOString(), // 1h ago
    ...overrides,
  };
}

describe("NIOS Cancellation & Refund Policy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseFrom.mockReset();
    mockGetBookingDetail.mockReset();
    mockUpdateBookingService.mockReset();
    mockUpdateBookingStatus.mockReset();
    mockRefundPayment.mockReset();
    mockCapturePayment.mockReset();
  });

  // ============================================================
  // CANCEL BOOKING (customer)
  // ============================================================
  describe("cancelBooking", () => {
    it("should refund 100% when booking is > 48h away", async () => {
      const booking = futureBooking(72); // 72h dans le futur
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingStatus.mockResolvedValue(true);

      const req = mockRequest({ params: { id: booking.id } });
      const res = mockResponse();

      await cancelBooking(req, res);

      expect(res._status).toBe(200);
      // > 48h = refund intégral (pas de montant partiel)
      expect(mockRefundPayment).toHaveBeenCalledWith("pi_cancel_test");
    });

    it("should retain NIOS fee (5%, min 10€) when 24-48h before booking", async () => {
      const booking = futureBooking(36, { price: 200, transport_fee: 20 }); // 36h
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingStatus.mockResolvedValue(true);

      const req = mockRequest({ params: { id: booking.id } });
      const res = mockResponse();

      await cancelBooking(req, res);

      expect(res._status).toBe(200);
      // 200€ * 5% = 10€ frais NIOS → refund = 200 - 10 = 190€ (partiel)
      expect(mockRefundPayment).toHaveBeenCalledWith("pi_cancel_test", 190);
    });

    it("should apply minimum 10€ NIOS fee for small bookings (24-48h)", async () => {
      const booking = futureBooking(36, { price: 50, transport_fee: 0 });
      // 50€ * 5% = 2.50€ → min 10€ → NIOS fee = 10€ → refund = 50 - 10 = 40€
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingStatus.mockResolvedValue(true);

      const req = mockRequest({ params: { id: booking.id } });
      const res = mockResponse();

      await cancelBooking(req, res);

      expect(mockRefundPayment).toHaveBeenCalledWith("pi_cancel_test", 40);
    });

    it("should only refund service price when < 24h before booking", async () => {
      const booking = futureBooking(12, { price: 200, transport_fee: 20 }); // 12h
      // < 24h → refund = service only = 200 - 20 = 180€
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingStatus.mockResolvedValue(true);

      const req = mockRequest({ params: { id: booking.id } });
      const res = mockResponse();

      await cancelBooking(req, res);

      expect(mockRefundPayment).toHaveBeenCalledWith("pi_cancel_test", 180);
    });

    it("should cancel preauthorization (full refund) when booking is preauthorized", async () => {
      const booking = futureBooking(12, {
        payment_status: "preauthorized",
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingStatus.mockResolvedValue(true);

      const req = mockRequest({ params: { id: booking.id } });
      const res = mockResponse();

      await cancelBooking(req, res);

      // Preautorisation = toujours annulation intégrale (pas de politique)
      expect(mockRefundPayment).toHaveBeenCalledWith("pi_cancel_test");
    });

    it("should not refund if payment status is pending", async () => {
      const booking = futureBooking(12, {
        payment_status: "pending",
        payment_intent_id: null,
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockUpdateBookingStatus.mockResolvedValue(true);

      const req = mockRequest({ params: { id: booking.id } });
      const res = mockResponse();

      await cancelBooking(req, res);

      expect(mockRefundPayment).not.toHaveBeenCalled();
    });

    it("should return 403 if user is not customer or provider of the booking", async () => {
      const booking = futureBooking(12, { customer_id: "other-user" });
      mockGetBookingDetail.mockResolvedValue(booking);

      const req = mockRequest({ params: { id: booking.id } });
      const res = mockResponse();

      await cancelBooking(req, res);

      expect(res._status).toBe(403);
    });

    it("should return 404 if booking not found", async () => {
      mockGetBookingDetail.mockResolvedValue(null);

      const req = mockRequest({ params: { id: "nonexistent" } });
      const res = mockResponse();

      await cancelBooking(req, res);

      expect(res._status).toBe(404);
    });
  });

  // ============================================================
  // DECLINE BOOKING (provider)
  // ============================================================
  describe("declineBooking", () => {
    it("should refund preauthorization when provider declines", async () => {
      const booking = futureBooking(72, {
        payment_status: "preauthorized",
        customer_id: "customer-1",
        provider_id: "prov-user-1",
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingService.mockResolvedValue({ ...booking, status: "declined" });

      // Mock provider profile lookup
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ user_id: "prov-user-1" })
      );

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();

      await declineBooking(req, res);

      expect(res._status).toBe(200);
      expect(mockRefundPayment).toHaveBeenCalledWith("pi_cancel_test");
      expect(mockUpdateBookingService).toHaveBeenCalledWith(
        booking.id,
        expect.objectContaining({
          status: "declined",
          payment_status: "refunded",
        })
      );
    });

    it("should not refund if no payment intent", async () => {
      const booking = futureBooking(72, {
        payment_status: "pending",
        payment_intent_id: null,
        customer_id: "customer-1",
        provider_id: "prov-user-1",
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockUpdateBookingService.mockResolvedValue({ ...booking, status: "declined" });

      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ user_id: "prov-user-1" })
      );

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();

      await declineBooking(req, res);

      expect(mockRefundPayment).not.toHaveBeenCalled();
      expect(mockUpdateBookingService).toHaveBeenCalledWith(
        booking.id,
        expect.objectContaining({
          status: "declined",
          payment_status: "pending",
        })
      );
    });

    it("should return 403 if user is not a provider", async () => {
      const req = mockRequest({
        params: { id: "b-1" },
        user: { id: "u1", role: "customer" },
      });
      const res = mockResponse();

      await declineBooking(req, res);

      expect(res._status).toBe(403);
    });
  });

  // ============================================================
  // CONFIRM BOOKING (provider captures payment)
  // ============================================================
  describe("confirmBooking", () => {
    it("should capture payment and set status to confirmed/paid", async () => {
      const booking = futureBooking(72, {
        payment_status: "preauthorized",
        customer_id: "customer-1",
        provider_id: "prov-user-1",
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockCapturePayment.mockResolvedValue(true);

      // provider_profiles lookup
      mockSupabaseFrom.mockReturnValueOnce(
        supabaseChain({ user_id: "prov-user-1" })
      );
      // users update (welcoming offer)
      mockSupabaseFrom.mockReturnValueOnce(supabaseChain(null));
      // bookings update (confirmed)
      mockSupabaseFrom.mockReturnValueOnce(
        supabaseChain({ ...booking, status: "confirmed", payment_status: "paid" })
      );

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();

      await confirmBooking(req, res);

      expect(res._status).toBe(200);
      expect(mockCapturePayment).toHaveBeenCalledWith("pi_cancel_test");
      expect(res._json.success).toBe(true);
    });

    it("should auto-cancel expired bookings (> 24h old)", async () => {
      const booking = futureBooking(72, {
        payment_status: "preauthorized",
        customer_id: "customer-1",
        provider_id: "prov-user-1",
        created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), // 25h ago
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingService.mockResolvedValue({ ...booking, status: "cancelled" });

      // getProviderProfileIdsForUser → from("provider_profiles").select("user_id").eq().maybeSingle()
      mockSupabaseFrom.mockReturnValueOnce(
        supabaseChain({ user_id: "prov-user-1" })
      );

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();

      await confirmBooking(req, res);

      expect(res._status).toBe(200);
      expect(res._json.expiredAndCancelled).toBe(true);
      expect(mockRefundPayment).toHaveBeenCalled(); // Refund de la preauth
      expect(mockCapturePayment).not.toHaveBeenCalled(); // Pas de capture
    });

    it("should return 400 if booking is not preauthorized", async () => {
      const booking = futureBooking(72, {
        payment_status: "paid", // Already paid, not preauthorized
        customer_id: "customer-1",
        provider_id: "prov-user-1",
      });
      mockGetBookingDetail.mockResolvedValue(booking);

      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ user_id: "prov-user-1" })
      );

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();

      await confirmBooking(req, res);

      expect(res._status).toBe(400);
      expect(res._json.error).toContain("not in preauthorized state");
    });
  });

  // ============================================================
  // REFUND BOOKING (full refund by provider/admin)
  // ============================================================
  describe("refundBooking", () => {
    it("should fully refund a paid booking", async () => {
      const booking = futureBooking(0, {
        payment_status: "paid",
        customer_id: "customer-1",
        provider_id: "prov-user-1",
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingService.mockResolvedValue({
        ...booking,
        status: "cancelled",
        payment_status: "refunded",
      });

      // provider_profiles lookup
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "prov-user-1", user_id: "prov-user-1" })
      );

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();

      await refundBooking(req, res);

      expect(res._status).toBe(200);
      expect(res._json.success).toBe(true);
      expect(mockRefundPayment).toHaveBeenCalledWith("pi_cancel_test");
      expect(mockUpdateBookingService).toHaveBeenCalledWith(
        booking.id,
        expect.objectContaining({
          status: "cancelled",
          payment_status: "refunded",
        })
      );
    });

    it("should return 400 if no payment_intent linked", async () => {
      const booking = futureBooking(0, {
        payment_intent_id: null,
        customer_id: "customer-1",
        provider_id: "prov-user-1",
      });
      mockGetBookingDetail.mockResolvedValue(booking);

      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "prov-user-1", user_id: "prov-user-1" })
      );

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();

      await refundBooking(req, res);

      expect(res._status).toBe(400);
      expect(res._json.error).toContain("No payment_intent");
    });

    it("should return 500 if Stripe refund fails", async () => {
      const booking = futureBooking(0, {
        payment_status: "paid",
        customer_id: "customer-1",
        provider_id: "prov-user-1",
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(false); // Stripe failed

      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "prov-user-1", user_id: "prov-user-1" })
      );

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();

      await refundBooking(req, res);

      expect(res._status).toBe(500);
      expect(res._json.error).toContain("Stripe refund failed");
    });

    it("should return 403 if customer tries to refund", async () => {
      const req = mockRequest({
        params: { id: "b-1" },
        user: { id: "u1", role: "customer" },
      });
      const res = mockResponse();

      await refundBooking(req, res);

      expect(res._status).toBe(403);
    });

    it("should allow admin to refund any booking", async () => {
      const booking = futureBooking(0, {
        payment_status: "paid",
        customer_id: "customer-1",
        provider_id: "prov-other",
      });
      mockGetBookingDetail.mockResolvedValue(booking);
      mockRefundPayment.mockResolvedValue(true);
      mockUpdateBookingService.mockResolvedValue({
        ...booking,
        status: "cancelled",
        payment_status: "refunded",
      });

      const req = mockRequest({
        params: { id: booking.id },
        user: { id: "admin-1", role: "admin" },
      });
      const res = mockResponse();

      await refundBooking(req, res);

      expect(res._status).toBe(200);
      expect(res._json.success).toBe(true);
    });
  });
});
