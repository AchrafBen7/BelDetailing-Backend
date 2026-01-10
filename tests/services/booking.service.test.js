import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  getBookings,
  getBookingDetail,
  createBookingService,
  updateBookingService,
  updateBookingStatus,
} from "../../src/services/booking.service.js";
import { supabaseAdmin as supabase } from "../../src/config/supabase.js";

jest.mock("../../src/config/supabase.js", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

describe("Booking Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getBookings", () => {
    it("should return bookings for customer scope", async () => {
      const mockBookings = [
        {
          id: "booking1",
          customer_id: "customer1",
          provider_id: "provider1",
          status: "confirmed",
        },
        {
          id: "booking2",
          customer_id: "customer1",
          provider_id: "provider2",
          status: "pending",
        },
      ];

      const mockSelect = {
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: mockBookings, error: null }),
      };

      supabase.from.mockReturnValue(mockSelect);

      const result = await getBookings({ userId: "customer1", scope: "customer" });

      expect(result).toEqual(mockBookings);
      expect(mockSelect.eq).toHaveBeenCalledWith("customer_id", "customer1");
    });

    it("should return bookings for provider scope", async () => {
      const mockProviderProfile = { id: "provider_profile_id" };
      const mockBookings = [
        {
          id: "booking1",
          provider_id: "provider_profile_id",
          customer_id: "customer1",
          status: "confirmed",
        },
      ];

      const mockProviderSelect = {
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockProviderProfile, error: null }),
      };

      const mockBookingsSelect = {
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: mockBookings, error: null }),
      };

      supabase.from
        .mockReturnValueOnce(mockProviderSelect)
        .mockReturnValueOnce(mockBookingsSelect);

      const result = await getBookings({ userId: "provider_user_id", scope: "provider" });

      expect(result).toEqual(mockBookings);
      expect(mockBookingsSelect.eq).toHaveBeenCalledWith(
        "provider_id",
        "provider_profile_id"
      );
    });

    it("should filter by status when provided", async () => {
      const mockBookings = [{ id: "booking1", status: "confirmed" }];

      const mockSelect = {
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: mockBookings, error: null }),
      };

      supabase.from.mockReturnValue(mockSelect);

      const result = await getBookings({
        userId: "customer1",
        scope: "customer",
        status: "confirmed",
      });

      expect(result).toEqual(mockBookings);
      expect(mockSelect.eq).toHaveBeenCalledWith("status", "confirmed");
    });
  });

  describe("getBookingDetail", () => {
    it("should return a single booking by id", async () => {
      const mockBooking = {
        id: "booking1",
        customer_id: "customer1",
        provider_id: "provider1",
        status: "confirmed",
      };

      const mockSelect = {
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockBooking, error: null }),
      };

      supabase.from.mockReturnValue(mockSelect);

      const result = await getBookingDetail("booking1");

      expect(result).toEqual(mockBooking);
      expect(mockSelect.eq).toHaveBeenCalledWith("id", "booking1");
    });

    it("should throw error if booking not found", async () => {
      const mockSelect = {
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: "Not found" },
        }),
      };

      supabase.from.mockReturnValue(mockSelect);

      await expect(getBookingDetail("invalid_id")).rejects.toThrow();
    });
  });

  describe("createBookingService", () => {
    it("should create a booking successfully", async () => {
      const mockBooking = {
        id: "booking1",
        customer_id: "customer1",
        provider_id: "provider1",
        service_id: "service1",
        status: "pending",
        payment_status: "pending",
      };

      const payload = {
        provider_id: "provider1",
        service_id: "service1",
        provider_name: "Test Provider",
        service_name: "Test Service",
        price: 100,
        date: "2025-12-15",
        start_time: "10:00",
        end_time: "12:00",
        address: "123 Main St",
      };

      const customer = { id: "customer1" };

      const mockInsert = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockBooking, error: null }),
      };

      supabase.from.mockReturnValue(mockInsert);

      const result = await createBookingService(payload, customer);

      expect(result).toEqual(mockBooking);
      expect(mockInsert.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: "customer1",
          provider_id: "provider1",
          status: "pending",
        })
      );
    });
  });

  describe("updateBookingService", () => {
    it("should update a booking successfully", async () => {
      const mockUpdatedBooking = {
        id: "booking1",
        status: "confirmed",
        payment_status: "paid",
      };

      const mockUpdate = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockUpdatedBooking, error: null }),
      };

      supabase.from.mockReturnValue(mockUpdate);

      const result = await updateBookingService("booking1", {
        status: "confirmed",
        payment_status: "paid",
      });

      expect(result).toEqual(mockUpdatedBooking);
      expect(mockUpdate.update).toHaveBeenCalledWith({
        status: "confirmed",
        payment_status: "paid",
      });
      expect(mockUpdate.eq).toHaveBeenCalledWith("id", "booking1");
    });
  });

  describe("updateBookingStatus", () => {
    it("should update booking status successfully", async () => {
      const mockUpdatedBooking = {
        id: "booking1",
        status: "cancelled",
      };

      const mockUpdate = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockUpdatedBooking, error: null }),
      };

      supabase.from.mockReturnValue(mockUpdate);

      const result = await updateBookingStatus("booking1", "cancelled");

      expect(result).toBe(true);
      expect(mockUpdate.update).toHaveBeenCalledWith({ status: "cancelled" });
    });

    it("should return false if update fails", async () => {
      const mockUpdate = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: "Error" },
        }),
      };

      supabase.from.mockReturnValue(mockUpdate);

      await expect(updateBookingStatus("booking1", "cancelled")).rejects.toThrow();
    });
  });
});
