import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  createPaymentIntent,
  capturePayment,
  refundPayment,
  createSetupIntent,
  listPaymentMethods,
} from "../../src/services/payment.service.js";
import { supabaseAdmin as supabase } from "../../src/config/supabase.js";
import Stripe from "stripe";

jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
      capture: jest.fn(),
    },
    refunds: {
      create: jest.fn(),
    },
    ephemeralKeys: {
      create: jest.fn(),
    },
    setupIntents: {
      create: jest.fn(),
    },
    customers: {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
    },
    paymentMethods: {
      list: jest.fn(),
      detach: jest.fn(),
    },
  }));
});

jest.mock("../../src/config/supabase.js", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

describe("Payment Service", () => {
  let mockStripe;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStripe = new Stripe("sk_test_...");
  });

  describe("createPaymentIntent", () => {
    it("should create a payment intent successfully", async () => {
      const mockUser = {
        id: "user1",
        email: "test@example.com",
        phone: "+32470000000",
        stripe_customer_id: "cus_test123",
      };

      const mockPaymentIntent = {
        id: "pi_test123",
        client_secret: "pi_test123_secret",
        status: "requires_capture",
        amount: 10000,
        currency: "eur",
      };

      mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent);

      const mockSelect = {
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockUser, error: null }),
      };

      supabase.from.mockReturnValue(mockSelect);

      const result = await createPaymentIntent({
        amount: 100,
        currency: "eur",
        user: mockUser,
      });

      expect(result.id).toBe("pi_test123");
      expect(result.clientSecret).toBe("pi_test123_secret");
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000,
          currency: "eur",
          customer: "cus_test123",
          capture_method: "manual",
        })
      );
    });

    it("should create Stripe customer if not exists", async () => {
      const mockUser = {
        id: "user1",
        email: "test@example.com",
        phone: null,
        stripe_customer_id: null,
      };

      const mockNewCustomer = {
        id: "cus_new123",
        email: "test@example.com",
      };

      const mockPaymentIntent = {
        id: "pi_test123",
        client_secret: "pi_test123_secret",
        status: "requires_capture",
      };

      const mockSelect1 = {
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockUser, error: null }),
      };

      const mockUpdate = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };

      supabase.from.mockReturnValueOnce(mockSelect1).mockReturnValueOnce(mockUpdate);

      mockStripe.customers.create.mockResolvedValue(mockNewCustomer);
      mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent);

      const result = await createPaymentIntent({
        amount: 100,
        currency: "eur",
        user: mockUser,
      });

      expect(mockStripe.customers.create).toHaveBeenCalled();
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "cus_new123",
        })
      );
      expect(result.id).toBe("pi_test123");
    });
  });

  describe("capturePayment", () => {
    it("should capture a payment intent successfully", async () => {
      const mockCapturedIntent = {
        id: "pi_test123",
        status: "succeeded",
      };

      mockStripe.paymentIntents.capture.mockResolvedValue(mockCapturedIntent);

      const result = await capturePayment("pi_test123");

      expect(result).toBe(true);
      expect(mockStripe.paymentIntents.capture).toHaveBeenCalledWith("pi_test123");
    });

    it("should return false if capture fails", async () => {
      mockStripe.paymentIntents.capture.mockRejectedValue(new Error("Capture failed"));

      const result = await capturePayment("pi_test123");

      expect(result).toBe(false);
    });
  });

  describe("refundPayment", () => {
    it("should refund a payment intent successfully", async () => {
      const mockRefund = {
        id: "re_test123",
        status: "succeeded",
      };

      mockStripe.refunds.create.mockResolvedValue(mockRefund);

      const result = await refundPayment("pi_test123");

      expect(result).toBe(true);
      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: "pi_test123",
      });
    });

    it("should return false if refund fails", async () => {
      mockStripe.refunds.create.mockRejectedValue(new Error("Refund failed"));

      const result = await refundPayment("pi_test123");

      expect(result).toBe(false);
    });
  });

  describe("createSetupIntent", () => {
    it("should create a setup intent successfully", async () => {
      const mockUser = {
        id: "user1",
        email: "test@example.com",
        stripe_customer_id: "cus_test123",
      };

      const mockEphemeralKey = {
        secret: "ek_test123",
      };

      const mockSetupIntent = {
        id: "seti_test123",
        client_secret: "seti_test123_secret",
      };

      mockStripe.ephemeralKeys.create.mockResolvedValue(mockEphemeralKey);
      mockStripe.setupIntents.create.mockResolvedValue(mockSetupIntent);

      const mockSelect = {
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockUser, error: null }),
      };

      supabase.from.mockReturnValue(mockSelect);

      const result = await createSetupIntent(mockUser);

      expect(result.customerId).toBe("cus_test123");
      expect(result.ephemeralKeySecret).toBe("ek_test123");
      expect(result.setupIntentClientSecret).toBe("seti_test123_secret");
    });
  });

  describe("listPaymentMethods", () => {
    it("should list payment methods for a customer", async () => {
      const mockUser = {
        id: "user1",
        stripe_customer_id: "cus_test123",
      };

      const mockCustomer = {
        id: "cus_test123",
        invoice_settings: {
          default_payment_method: "pm_default123",
        },
      };

      const mockPaymentMethods = {
        data: [
          {
            id: "pm_test123",
            card: {
              brand: "visa",
              last4: "4242",
              exp_month: 12,
              exp_year: 2025,
            },
          },
        ],
      };

      const mockSelect = {
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockUser, error: null }),
      };

      supabase.from.mockReturnValue(mockSelect);
      mockStripe.customers.retrieve.mockResolvedValue(mockCustomer);
      mockStripe.paymentMethods.list.mockResolvedValue(mockPaymentMethods);

      const result = await listPaymentMethods(mockUser);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("pm_test123");
      expect(result[0].brand).toBe("visa");
      expect(result[0].isDefault).toBe(false);
    });

    it("should return empty array if no customer", async () => {
      const mockUser = {
        id: "user1",
        stripe_customer_id: null,
      };

      const mockSelect = {
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockUser, error: null }),
      };

      supabase.from.mockReturnValue(mockSelect);

      const result = await listPaymentMethods(mockUser);

      expect(result).toEqual([]);
    });
  });
});
