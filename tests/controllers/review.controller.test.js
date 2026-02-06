import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mockRequest, mockResponse, createMockReview } from "../helpers/testHelpers.js";

// ---- Mock dependencies BEFORE import ----
const mockCreateReviewForProvider = jest.fn();

jest.unstable_mockModule("../../src/services/review.service.js", () => ({
  createReviewForProvider: mockCreateReviewForProvider,
}));

const mockSupabaseFrom = jest.fn();
jest.unstable_mockModule("../../src/config/supabase.js", () => ({
  supabase: { auth: { getUser: jest.fn() }, from: mockSupabaseFrom },
  supabaseAdmin: { from: mockSupabaseFrom },
}));

const { createReview } = await import(
  "../../src/controllers/review.controller.js"
);

describe("Review Controller", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("createReview", () => {
    it("should return 401 if user has no id", async () => {
      const req = mockRequest({
        user: {}, // no 'id' field
        body: { providerId: "p-1", rating: 5 },
      });
      const res = mockResponse();
      await createReview(req, res);
      expect(res._status).toBe(401);
    });

    it("should return 400 if providerId is missing", async () => {
      const req = mockRequest({
        user: { id: "u1" },
        body: { rating: 5 },
      });
      const res = mockResponse();
      await createReview(req, res);
      expect(res._status).toBe(400);
    });

    it("should return 400 if rating is missing", async () => {
      const req = mockRequest({
        user: { id: "u1" },
        body: { providerId: "p-1" },
      });
      const res = mockResponse();
      await createReview(req, res);
      expect(res._status).toBe(400);
    });

    it("should return 400 if rating out of range (0)", async () => {
      const req = mockRequest({
        user: { id: "u1" },
        body: { providerId: "p-1", rating: 0 },
      });
      const res = mockResponse();
      await createReview(req, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toContain("between 1 and 5");
    });

    it("should return 400 if rating out of range (6)", async () => {
      const req = mockRequest({
        user: { id: "u1" },
        body: { providerId: "p-1", rating: 6 },
      });
      const res = mockResponse();
      await createReview(req, res);
      expect(res._status).toBe(400);
    });

    it("should return 400 if comment is too long", async () => {
      const req = mockRequest({
        user: { id: "u1" },
        body: {
          providerId: "p-1",
          rating: 4,
          comment: "a".repeat(2001),
        },
      });
      const res = mockResponse();
      await createReview(req, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toContain("too long");
    });

    it("should create a review successfully (without bookingId)", async () => {
      const review = createMockReview();
      mockCreateReviewForProvider.mockResolvedValue(review);

      const req = mockRequest({
        user: { id: "u1" },
        body: { providerId: "provider-1", rating: 4, comment: "Tres bon" },
      });
      const res = mockResponse();
      await createReview(req, res);

      expect(res._status).toBe(201);
      expect(res._json.data.id).toBe("review-1");
      expect(res._json.data.rating).toBe(4);
    });

    it("should return 500 if service throws", async () => {
      mockCreateReviewForProvider.mockRejectedValue(new Error("DB error"));

      const req = mockRequest({
        user: { id: "u1" },
        body: { providerId: "p-1", rating: 3 },
      });
      const res = mockResponse();
      await createReview(req, res);

      expect(res._status).toBe(500);
    });
  });
});
