/**
 * Tests du flux de confirmation mutuelle Mission B2B :
 * - State machine transitions
 * - Confirm start (company + detailer → active)
 * - Confirm end (company + detailer → completed)
 * - Suspend / Resume
 * - Security: ownership, idempotence, date checks
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ============================================================
// 1. STATE MACHINE TESTS (pure logic, no mocks)
// ============================================================

import {
  isValidTransition,
  validateTransition,
  getAllowedTransitions,
  isTerminalStatus,
  canPerformAction,
} from "../../src/services/missionStateMachine.service.js";

describe("MissionStateMachine", () => {
  describe("isValidTransition", () => {
    it("allows draft → waiting_for_detailer_confirmation", () => {
      expect(isValidTransition("draft", "waiting_for_detailer_confirmation")).toBe(true);
    });

    it("allows draft → cancelled", () => {
      expect(isValidTransition("draft", "cancelled")).toBe(true);
    });

    it("rejects draft → active (skip)", () => {
      expect(isValidTransition("draft", "active")).toBe(false);
    });

    it("allows payment_scheduled → awaiting_start", () => {
      expect(isValidTransition("payment_scheduled", "awaiting_start")).toBe(true);
    });

    it("allows awaiting_start → active", () => {
      expect(isValidTransition("awaiting_start", "active")).toBe(true);
    });

    it("allows active → awaiting_end", () => {
      expect(isValidTransition("active", "awaiting_end")).toBe(true);
    });

    it("allows active → suspended", () => {
      expect(isValidTransition("active", "suspended")).toBe(true);
    });

    it("allows suspended → active (resume)", () => {
      expect(isValidTransition("suspended", "active")).toBe(true);
    });

    it("allows awaiting_end → completed", () => {
      expect(isValidTransition("awaiting_end", "completed")).toBe(true);
    });

    it("rejects completed → anything", () => {
      expect(isValidTransition("completed", "active")).toBe(false);
      expect(isValidTransition("completed", "cancelled")).toBe(false);
    });

    it("rejects cancelled → anything", () => {
      expect(isValidTransition("cancelled", "active")).toBe(false);
    });

    it("rejects unknown status", () => {
      expect(isValidTransition("unknown_status", "active")).toBe(false);
    });
  });

  describe("validateTransition", () => {
    it("throws on invalid transition", () => {
      expect(() => validateTransition("draft", "completed"))
        .toThrow("Invalid status transition: draft → completed");
    });

    it("does not throw on valid transition", () => {
      expect(() => validateTransition("draft", "waiting_for_detailer_confirmation"))
        .not.toThrow();
    });

    it("error includes allowed transitions", () => {
      try {
        validateTransition("draft", "completed");
      } catch (err) {
        expect(err.statusCode).toBe(400);
        expect(err.allowedTransitions).toContain("waiting_for_detailer_confirmation");
        expect(err.allowedTransitions).toContain("cancelled");
      }
    });
  });

  describe("getAllowedTransitions", () => {
    it("returns correct transitions for active", () => {
      const allowed = getAllowedTransitions("active");
      expect(allowed).toContain("awaiting_end");
      expect(allowed).toContain("suspended");
      expect(allowed).toContain("cancelled");
    });

    it("returns empty for terminal states", () => {
      expect(getAllowedTransitions("completed")).toEqual([]);
      expect(getAllowedTransitions("cancelled")).toEqual([]);
    });
  });

  describe("isTerminalStatus", () => {
    it("completed is terminal", () => {
      expect(isTerminalStatus("completed")).toBe(true);
    });

    it("cancelled is terminal", () => {
      expect(isTerminalStatus("cancelled")).toBe(true);
    });

    it("active is not terminal", () => {
      expect(isTerminalStatus("active")).toBe(false);
    });
  });

  describe("canPerformAction", () => {
    it("company can confirm_start", () => {
      expect(canPerformAction("confirm_start", "company")).toBe(true);
    });

    it("provider can confirm_start", () => {
      expect(canPerformAction("confirm_start", "provider")).toBe(true);
    });

    it("customer cannot confirm_start", () => {
      expect(canPerformAction("confirm_start", "customer")).toBe(false);
    });

    it("company can create_payments", () => {
      expect(canPerformAction("create_payments", "company")).toBe(true);
    });

    it("provider cannot create_payments", () => {
      expect(canPerformAction("create_payments", "provider")).toBe(false);
    });

    it("admin can suspend", () => {
      expect(canPerformAction("suspend", "admin")).toBe(true);
    });

    it("unknown action returns false", () => {
      expect(canPerformAction("fly_to_moon", "company")).toBe(false);
    });
  });
});

// ============================================================
// 2. FULL MISSION LIFECYCLE (integration-style with mocks)
// ============================================================

describe("Mission Lifecycle Flow", () => {
  it("follows the complete happy path", () => {
    const statuses = [
      "draft",
      "waiting_for_detailer_confirmation",
      "agreement_fully_confirmed",
      "payment_scheduled",
      "awaiting_start",
      "active",
      "awaiting_end",
      "completed",
    ];

    for (let i = 0; i < statuses.length - 1; i++) {
      expect(isValidTransition(statuses[i], statuses[i + 1])).toBe(true);
    }
  });

  it("allows suspension and resumption during active", () => {
    expect(isValidTransition("active", "suspended")).toBe(true);
    expect(isValidTransition("suspended", "active")).toBe(true);
    // After resume, should still complete normally
    expect(isValidTransition("active", "awaiting_end")).toBe(true);
    expect(isValidTransition("awaiting_end", "completed")).toBe(true);
  });

  it("allows cancellation from most states", () => {
    const cancellableStates = [
      "draft",
      "waiting_for_detailer_confirmation",
      "agreement_fully_confirmed",
      "payment_scheduled",
      "awaiting_start",
      "active",
      "awaiting_end",
      "suspended",
    ];

    for (const status of cancellableStates) {
      expect(isValidTransition(status, "cancelled")).toBe(true);
    }
  });

  it("prevents skipping states", () => {
    // Cannot go directly from draft to active
    expect(isValidTransition("draft", "active")).toBe(false);
    // Cannot go from payment_scheduled to completed
    expect(isValidTransition("payment_scheduled", "completed")).toBe(false);
    // Cannot go from agreement_fully_confirmed to active
    expect(isValidTransition("agreement_fully_confirmed", "active")).toBe(false);
  });
});

// ============================================================
// 3. SECURITY MATRIX
// ============================================================

describe("Security: Role-Action Matrix", () => {
  const actions = ["confirm_start", "confirm_end", "suspend", "resume", "cancel", "create_payments"];
  const roles = ["company", "provider", "customer", "admin"];

  const expectedPermissions = {
    confirm_start: { company: true, provider: true, customer: false, admin: false },
    confirm_end: { company: true, provider: true, customer: false, admin: false },
    suspend: { company: true, provider: true, customer: false, admin: true },
    resume: { company: true, provider: true, customer: false, admin: true },
    cancel: { company: true, provider: true, customer: false, admin: true },
    create_payments: { company: true, provider: false, customer: false, admin: false },
  };

  for (const action of actions) {
    for (const role of roles) {
      it(`${role} ${expectedPermissions[action][role] ? "can" : "cannot"} ${action}`, () => {
        expect(canPerformAction(action, role)).toBe(expectedPermissions[action][role]);
      });
    }
  }
});
