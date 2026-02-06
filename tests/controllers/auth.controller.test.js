import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mockRequest, mockResponse } from "../helpers/testHelpers.js";

// ---- Mock supabase BEFORE import ----
const mockAuthSignUp = jest.fn();
const mockAuthSignIn = jest.fn();
const mockAuthRefresh = jest.fn();
const mockSupabaseFrom = jest.fn();

jest.unstable_mockModule("../../src/config/supabase.js", () => ({
  supabase: {
    auth: {
      signUp: mockAuthSignUp,
      signInWithPassword: mockAuthSignIn,
      refreshSession: mockAuthRefresh,
      getUser: jest.fn(),
      admin: { signOut: jest.fn() },
    },
    from: mockSupabaseFrom,
  },
  supabaseAdmin: {
    from: mockSupabaseFrom,
  },
}));

// Dynamic import AFTER mocking
const { register, login, refreshToken } = await import(
  "../../src/controllers/auth.controller.js"
);

describe("Auth Controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // REGISTER
  // ============================================================
  describe("register", () => {
    it("should return 400 if email is missing", async () => {
      const req = mockRequest({ body: { password: "Test1234!" } });
      const res = mockResponse();
      await register(req, res);
      expect(res._status).toBe(400);
    });

    it("should return 400 if password is missing", async () => {
      const req = mockRequest({ body: { email: "test@test.com" } });
      const res = mockResponse();
      await register(req, res);
      expect(res._status).toBe(400);
    });

    it("should return 400 if VAT missing for provider", async () => {
      const req = mockRequest({
        body: { email: "p@test.com", password: "Test1234!", role: "provider" },
      });
      const res = mockResponse();
      await register(req, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toContain("VAT");
    });

    it("should return 400 if VAT missing for company", async () => {
      const req = mockRequest({
        body: { email: "c@test.com", password: "Test1234!", role: "company" },
      });
      const res = mockResponse();
      await register(req, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toContain("VAT");
    });

    it("should register customer successfully", async () => {
      mockAuthSignUp.mockResolvedValue({
        data: { user: { id: "u1", email: "test@test.com" } },
        error: null,
      });

      // The register controller calls supabaseAdmin.from(...) multiple times:
      // 1) users.insert  2) referral select/update  3) customer_profiles.insert
      // We return a generic chainable mock for all calls
      const chainable = {
        insert: jest.fn().mockResolvedValue({ error: null }),
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      };
      mockSupabaseFrom.mockReturnValue(chainable);

      const req = mockRequest({
        body: { email: "test@test.com", password: "Test1234!", role: "customer" },
      });
      const res = mockResponse();
      await register(req, res);

      expect(res._status).toBe(201);
      expect(res._json.success).toBe(true);
      expect(res._json.role).toBe("customer");
    });

    it("should return 400 if supabase signup fails", async () => {
      mockAuthSignUp.mockResolvedValue({
        data: { user: null },
        error: { message: "Email already registered" },
      });

      const req = mockRequest({
        body: { email: "dup@test.com", password: "Test1234!" },
      });
      const res = mockResponse();
      await register(req, res);

      expect(res._status).toBe(400);
    });
  });

  // ============================================================
  // LOGIN
  // ============================================================
  describe("login", () => {
    it("should return 400 if email is missing", async () => {
      const req = mockRequest({ body: { password: "Test1234!" } });
      const res = mockResponse();
      await login(req, res);
      expect(res._status).toBe(400);
    });

    it("should return 401 if credentials are wrong", async () => {
      mockAuthSignIn.mockResolvedValue({
        data: null,
        error: { message: "Invalid login credentials" },
      });

      const req = mockRequest({
        body: { email: "test@test.com", password: "wrong" },
      });
      const res = mockResponse();
      await login(req, res);
      expect(res._status).toBe(401);
    });

    it("should login and return tokens", async () => {
      mockAuthSignIn.mockResolvedValue({
        data: {
          session: {
            access_token: "at_123",
            refresh_token: "rt_123",
            token_type: "bearer",
            expires_in: 3600,
          },
          user: { id: "u1", email: "test@test.com" },
        },
        error: null,
      });

      // from("users").select("*").eq("id", ...).maybeSingle()
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: "u1", email: "test@test.com", role: "customer", phone: "", vat_number: null, is_vat_valid: null },
              error: null,
            }),
          }),
        }),
      });

      const req = mockRequest({
        body: { email: "test@test.com", password: "Test1234!" },
      });
      const res = mockResponse();
      await login(req, res);

      expect(res._status).toBe(200);
      expect(res._json.accessToken).toBe("at_123");
      expect(res._json.user.role).toBe("customer");
    });
  });

  // ============================================================
  // REFRESH TOKEN
  // ============================================================
  describe("refreshToken", () => {
    it("should return 400 if refreshToken is missing", async () => {
      const req = mockRequest({ body: {} });
      const res = mockResponse();
      await refreshToken(req, res);
      expect(res._status).toBe(400);
    });

    it("should return 401 if refresh fails", async () => {
      mockAuthRefresh.mockResolvedValue({
        data: null,
        error: { message: "Token expired" },
      });

      const req = mockRequest({ body: { refreshToken: "expired" } });
      const res = mockResponse();
      await refreshToken(req, res);
      expect(res._status).toBe(401);
    });

    it("should refresh tokens successfully", async () => {
      mockAuthRefresh.mockResolvedValue({
        data: {
          session: {
            access_token: "new_at",
            refresh_token: "new_rt",
            token_type: "bearer",
            expires_in: 3600,
          },
          user: { id: "u1", email: "test@test.com" },
        },
        error: null,
      });

      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: "u1", role: "customer", phone: "", vat_number: null, is_vat_valid: null },
              error: null,
            }),
          }),
        }),
      });

      const req = mockRequest({ body: { refreshToken: "valid_rt" } });
      const res = mockResponse();
      await refreshToken(req, res);

      expect(res._status).toBe(200);
      expect(res._json.accessToken).toBe("new_at");
    });
  });
});
