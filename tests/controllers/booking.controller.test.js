import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mockRequest, mockResponse, createMockBooking } from "../helpers/testHelpers.js";

// ---- Mock all dependencies BEFORE import ----
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

jest.unstable_mockModule("../../src/config/commission.js", () => ({
  BOOKING_COMMISSION_RATE: 0.10,
  MISSION_COMMISSION_RATE: 0.07,
  getCommissionRate: jest.fn().mockReturnValue(0.10),
}));

// Dynamic import AFTER mocking
const {
  listBookings,
  getBooking,
  cancelBooking,
  confirmBooking,
  declineBooking,
  refundBooking,
} = await import("../../src/controllers/booking.controller.js");

describe("Booking Controller", () => {
  beforeEach(() => jest.clearAllMocks());

  // ======== LIST BOOKINGS ========
  describe("listBookings", () => {
    it("should return bookings for user", async () => {
      const bookings = [createMockBooking(), createMockBooking({ id: "b-2" })];
      mockGetBookings.mockResolvedValue(bookings);

      const req = mockRequest({ query: { scope: "customer" } });
      const res = mockResponse();
      await listBookings(req, res);

      expect(res._status).toBe(200);
      expect(res._json.data).toHaveLength(2);
    });

    it("should return 500 when service throws", async () => {
      mockGetBookings.mockRejectedValue(new Error("db down"));

      const req = mockRequest();
      const res = mockResponse();
      await listBookings(req, res);

      expect(res._status).toBe(500);
    });
  });

  // ======== GET BOOKING ========
  describe("getBooking", () => {
    it("should return a booking by id", async () => {
      const booking = createMockBooking();
      mockGetBookingDetail.mockResolvedValue(booking);

      const req = mockRequest({ params: { id: "booking-1" } });
      const res = mockResponse();
      await getBooking(req, res);

      expect(res._status).toBe(200);
      expect(res._json.id).toBe("booking-1");
    });
  });

  // ======== CANCEL BOOKING ========
  describe("cancelBooking", () => {
    it("should cancel if user is customer owner", async () => {
      const booking = createMockBooking();
      mockGetBookingDetail.mockResolvedValue(booking);
      mockUpdateBookingStatus.mockResolvedValue(true);

      const req = mockRequest({
        params: { id: "booking-1" },
        user: { id: "user-1", role: "customer" },
      });
      const res = mockResponse();
      await cancelBooking(req, res);

      expect(res._status).toBe(200);
      expect(res._json.success).toBe(true);
    });

    it("should return 403 if user is not owner", async () => {
      const booking = createMockBooking();
      mockGetBookingDetail.mockResolvedValue(booking);

      const req = mockRequest({
        params: { id: "booking-1" },
        user: { id: "user-999", role: "customer" },
      });
      const res = mockResponse();
      await cancelBooking(req, res);

      expect(res._status).toBe(403);
    });

    it("should return 404 if booking not found", async () => {
      mockGetBookingDetail.mockResolvedValue(null);

      const req = mockRequest({
        params: { id: "nonexistent" },
        user: { id: "user-1", role: "customer" },
      });
      const res = mockResponse();
      await cancelBooking(req, res);

      expect(res._status).toBe(404);
    });
  });

  // ======== CONFIRM BOOKING ========
  describe("confirmBooking", () => {
    it("should return 403 if not provider", async () => {
      const req = mockRequest({
        params: { id: "booking-1" },
        user: { id: "user-1", role: "customer" },
      });
      const res = mockResponse();
      await confirmBooking(req, res);

      expect(res._status).toBe(403);
    });

    it("should return 400 if booking not preauthorized", async () => {
      // getProviderProfileIdsForUser queries provider_profiles by user_id
      // It returns { id: null, userId: data.user_id }
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { user_id: "prov-user-1" },
              error: null,
            }),
          }),
        }),
      });

      // isBookingOwnedByProvider checks booking.provider_id === providerProfile.userId
      const booking = createMockBooking({
        provider_id: "prov-user-1",
        payment_status: "pending",
        payment_intent_id: "pi_123",
        created_at: new Date().toISOString(), // recent, so not expired
      });
      mockGetBookingDetail.mockResolvedValue(booking);

      const req = mockRequest({
        params: { id: "booking-1" },
        user: { id: "prov-user-1", role: "provider" },
      });
      const res = mockResponse();
      await confirmBooking(req, res);

      expect(res._status).toBe(400);
    });
  });

  // ======== DECLINE BOOKING ========
  describe("declineBooking", () => {
    it("should return 403 for non-provider", async () => {
      const req = mockRequest({
        params: { id: "booking-1" },
        user: { id: "user-1", role: "customer" },
      });
      const res = mockResponse();
      await declineBooking(req, res);

      expect(res._status).toBe(403);
    });
  });

  // ======== REFUND BOOKING ========
  describe("refundBooking", () => {
    it("should return 403 for non-provider/non-admin", async () => {
      const req = mockRequest({
        params: { id: "booking-1" },
        user: { id: "user-1", role: "customer" },
      });
      const res = mockResponse();
      await refundBooking(req, res);

      expect(res._status).toBe(403);
    });
  });
});
