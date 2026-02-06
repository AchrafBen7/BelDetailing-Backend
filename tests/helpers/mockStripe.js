import { jest } from "@jest/globals";

export function createMockStripe() {
  return {
    paymentIntents: {
      create: jest.fn(),
      capture: jest.fn(),
      retrieve: jest.fn(),
    },
    refunds: {
      create: jest.fn(),
    },
    customers: {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
    },
    ephemeralKeys: {
      create: jest.fn(),
    },
    setupIntents: {
      create: jest.fn(),
    },
    paymentMethods: {
      list: jest.fn(),
      detach: jest.fn(),
    },
    accounts: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    accountLinks: {
      create: jest.fn(),
    },
    balance: {
      retrieve: jest.fn(),
    },
    payouts: {
      list: jest.fn(),
    },
  };
}
