// Test helpers: factories and mock request/response objects

/**
 * Create a mock Express request object
 */
export function mockRequest(overrides = {}) {
  return {
    user: { id: "user-1", email: "test@example.com", role: "customer" },
    body: {},
    params: {},
    query: {},
    headers: { authorization: "Bearer test-token" },
    ...overrides,
  };
}

/**
 * Create a mock Express response object
 */
export function mockResponse() {
  const res = {
    _status: 200,
    _json: null,
    _sent: false,
  };

  res.status = (code) => {
    res._status = code;
    return res;
  };
  res.json = (data) => {
    res._json = data;
    res._sent = true;
    return res;
  };
  res.send = (data) => {
    res._json = data;
    res._sent = true;
    return res;
  };
  res.setHeader = () => res;
  res.set = () => res;

  return res;
}

/**
 * Factory: create a mock user
 */
export function createMockUser(overrides = {}) {
  return {
    id: "user-1",
    email: "test@example.com",
    phone: "+32470000000",
    role: "customer",
    vat_number: null,
    is_vat_valid: null,
    stripe_customer_id: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Factory: create a mock booking
 */
export function createMockBooking(overrides = {}) {
  return {
    id: "booking-1",
    provider_id: "provider-1",
    customer_id: "user-1",
    service_id: "service-1",
    provider_name: "Test Provider",
    service_name: "Test Service",
    price: 100,
    currency: "eur",
    date: "2026-03-15",
    start_time: "10:00",
    end_time: "12:00",
    address: "123 Rue Test, Bruxelles",
    status: "pending",
    payment_status: "pending",
    payment_intent_id: null,
    commission_rate: 0.10,
    created_at: "2025-12-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Factory: create a mock review
 */
export function createMockReview(overrides = {}) {
  return {
    id: "review-1",
    provider_id: "provider-1",
    customer_id: "user-1",
    booking_id: "booking-1",
    rating: 4,
    comment: "Tres bon service",
    created_at: "2025-12-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Factory: create a mock provider profile
 */
export function createMockProviderProfile(overrides = {}) {
  return {
    id: "provider-1",
    user_id: "provider-user-1",
    display_name: "Test Detailer",
    bio: "Pro detailer",
    base_city: "Bruxelles",
    postal_code: "1000",
    rating: 4.5,
    review_count: 12,
    stripe_account_id: "acct_test123",
    ...overrides,
  };
}
