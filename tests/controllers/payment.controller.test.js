import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mockRequest, mockResponse } from "../helpers/testHelpers.js";

// ---- Mock all dependencies BEFORE import ----
const mockCreatePaymentIntent = jest.fn();
const mockCapturePayment = jest.fn();
const mockRefundPayment = jest.fn();
const mockCreateSetupIntent = jest.fn();
const mockListPaymentMethods = jest.fn();
const mockListUserTransactions = jest.fn();
const mockDetachPaymentMethod = jest.fn();

jest.unstable_mockModule("../../src/services/payment.service.js", () => ({
  createPaymentIntent: mockCreatePaymentIntent,
  capturePayment: mockCapturePayment,
  refundPayment: mockRefundPayment,
  createSetupIntent: mockCreateSetupIntent,
  listPaymentMethods: mockListPaymentMethods,
  listUserTransactions: mockListUserTransactions,
  detachPaymentMethod: mockDetachPaymentMethod,
}));

const mockSupabaseFrom = jest.fn();
jest.unstable_mockModule("../../src/config/supabase.js", () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: mockSupabaseFrom,
  },
  supabaseAdmin: {
    from: mockSupabaseFrom,
  },
}));

const {
  createPaymentIntentController,
  capturePaymentController,
  refundPaymentController,
  createSetupIntentController,
  listPaymentMethodsController,
  listTransactionsController,
  deletePaymentMethodController,
} = await import("../../src/controllers/payment.controller.js");

// Helper: creates a deeply chainable Supabase mock
function supabaseChain(resolvedData, resolvedError = null) {
  const terminal = {
    single: jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
    maybeSingle: jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
  };
  const chain = {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ ...terminal, eq: jest.fn().mockReturnValue(terminal) }),
    }),
  };
  return chain;
}

describe("Payment Controller", () => {
  beforeEach(() => jest.clearAllMocks());

  // ======== CREATE PAYMENT INTENT ========
  describe("createPaymentIntentController", () => {
    it("should return 400 if amount is missing", async () => {
      const req = mockRequest({ body: { currency: "eur" } });
      const res = mockResponse();
      await createPaymentIntentController(req, res);
      expect(res._status).toBe(400);
    });

    it("should return 400 if currency is missing", async () => {
      const req = mockRequest({ body: { amount: 100 } });
      const res = mockResponse();
      await createPaymentIntentController(req, res);
      expect(res._status).toBe(400);
    });

    it("should create payment intent successfully", async () => {
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "u1", email: "t@t.com", phone: "", stripe_customer_id: "cus_t" })
      );

      mockCreatePaymentIntent.mockResolvedValue({
        id: "pi_test",
        clientSecret: "cs_test",
        amount: 100,
        currency: "eur",
        status: "requires_capture",
      });

      const req = mockRequest({
        body: { amount: 100, currency: "eur" },
        user: { id: "u1" },
      });
      const res = mockResponse();
      await createPaymentIntentController(req, res);

      expect(res._status).toBe(200);
      expect(res._json.id).toBe("pi_test");
    });

    it("should return 404 if user not found", async () => {
      mockSupabaseFrom.mockReturnValue(
        supabaseChain(null, { message: "not found" })
      );

      const req = mockRequest({
        body: { amount: 100, currency: "eur" },
        user: { id: "nonexistent" },
      });
      const res = mockResponse();
      await createPaymentIntentController(req, res);

      expect(res._status).toBe(404);
    });
  });

  // ======== CAPTURE PAYMENT ========
  describe("capturePaymentController", () => {
    it("should return 400 if paymentIntentId missing", async () => {
      const req = mockRequest({ body: {} });
      const res = mockResponse();
      await capturePaymentController(req, res);
      expect(res._status).toBe(400);
    });

    it("should capture successfully when user is provider", async () => {
      // Mock booking lookup
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "b1", provider_id: "u1", customer_id: "c1" })
      );
      mockCapturePayment.mockResolvedValue(true);

      const req = mockRequest({
        body: { paymentIntentId: "pi_test" },
        user: { id: "u1", role: "provider" },
      });
      const res = mockResponse();
      await capturePaymentController(req, res);

      expect(res._status).toBe(200);
      expect(res._json.success).toBe(true);
    });

    it("should return 403 if user is not involved in booking", async () => {
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "b1", provider_id: "other", customer_id: "other" })
      );

      const req = mockRequest({
        body: { paymentIntentId: "pi_test" },
        user: { id: "u1", role: "provider" },
      });
      const res = mockResponse();
      await capturePaymentController(req, res);

      expect(res._status).toBe(403);
    });

    it("should return 404 if booking not found", async () => {
      mockSupabaseFrom.mockReturnValue(supabaseChain(null));

      const req = mockRequest({
        body: { paymentIntentId: "pi_ghost" },
        user: { id: "u1" },
      });
      const res = mockResponse();
      await capturePaymentController(req, res);

      expect(res._status).toBe(404);
    });
  });

  // ======== REFUND PAYMENT ========
  describe("refundPaymentController", () => {
    it("should return 400 if paymentIntentId missing", async () => {
      const req = mockRequest({ body: {} });
      const res = mockResponse();
      await refundPaymentController(req, res);
      expect(res._status).toBe(400);
    });

    it("should refund successfully when user is customer", async () => {
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "b1", provider_id: "p1", customer_id: "u1" })
      );
      mockRefundPayment.mockResolvedValue(true);

      const req = mockRequest({
        body: { paymentIntentId: "pi_test" },
        user: { id: "u1", role: "customer" },
      });
      const res = mockResponse();
      await refundPaymentController(req, res);

      expect(res._status).toBe(200);
      expect(res._json.success).toBe(true);
    });

    it("should return 403 if user is not involved", async () => {
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "b1", provider_id: "other", customer_id: "other" })
      );

      const req = mockRequest({
        body: { paymentIntentId: "pi_test" },
        user: { id: "u1" },
      });
      const res = mockResponse();
      await refundPaymentController(req, res);

      expect(res._status).toBe(403);
    });
  });

  // ======== SETUP INTENT ========
  describe("createSetupIntentController", () => {
    it("should create setup intent", async () => {
      mockCreateSetupIntent.mockResolvedValue({
        customerId: "cus_t",
        ephemeralKeySecret: "ek_s",
        setupIntentClientSecret: "si_s",
      });

      const req = mockRequest({ user: { id: "u1", stripe_customer_id: "cus_t" } });
      const res = mockResponse();
      await createSetupIntentController(req, res);

      expect(res._status).toBe(200);
      expect(res._json.customerId).toBe("cus_t");
    });
  });

  // ======== LIST PAYMENT METHODS ========
  describe("listPaymentMethodsController", () => {
    it("should return list of cards", async () => {
      mockListPaymentMethods.mockResolvedValue([
        { id: "pm_1", brand: "visa", last4: "4242", isDefault: true },
      ]);

      const req = mockRequest({ user: { id: "u1" } });
      const res = mockResponse();
      await listPaymentMethodsController(req, res);

      expect(res._status).toBe(200);
      expect(res._json.data).toHaveLength(1);
    });
  });

  // ======== LIST TRANSACTIONS ========
  describe("listTransactionsController", () => {
    it("should return transactions", async () => {
      mockListUserTransactions.mockResolvedValue([{ id: "tx-1", amount: 50 }]);

      const req = mockRequest({ user: { id: "u1" } });
      const res = mockResponse();
      await listTransactionsController(req, res);

      expect(res._status).toBe(200);
      expect(res._json.data).toHaveLength(1);
    });
  });

  // ======== DELETE PAYMENT METHOD ========
  describe("deletePaymentMethodController", () => {
    it("should delete a payment method", async () => {
      // Controller fetches full user from DB
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "u1", email: "t@t.com", stripe_customer_id: "cus_t" })
      );
      mockDetachPaymentMethod.mockResolvedValue(true);

      const req = mockRequest({
        params: { paymentMethodId: "pm_1" },
        user: { id: "u1" },
      });
      const res = mockResponse();
      await deletePaymentMethodController(req, res);

      expect(res._status).toBe(200);
      expect(res._json.success).toBe(true);
    });

    it("should return 404 if user not found in DB", async () => {
      mockSupabaseFrom.mockReturnValue(supabaseChain(null, { message: "not found" }));

      const req = mockRequest({
        params: { paymentMethodId: "pm_1" },
        user: { id: "ghost" },
      });
      const res = mockResponse();
      await deletePaymentMethodController(req, res);

      expect(res._status).toBe(404);
    });

    it("should return 400 if detach fails", async () => {
      mockSupabaseFrom.mockReturnValue(
        supabaseChain({ id: "u1", email: "t@t.com", stripe_customer_id: "cus_t" })
      );
      mockDetachPaymentMethod.mockRejectedValue(
        new Error("Cannot delete default")
      );

      const req = mockRequest({
        params: { paymentMethodId: "pm_d" },
        user: { id: "u1" },
      });
      const res = mockResponse();
      await deletePaymentMethodController(req, res);

      expect(res._status).toBe(400);
    });
  });
});
