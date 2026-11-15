// Structured API errors for the v1 contract (handoff/api.md section 1).
const STATUS_BY_CODE = {
  INVALID_JSON: 400,
  AUTHENTICATION_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  ORIGIN_INVALID: 403,
  SELF_DECISION_FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  STALE_VERSION: 409,
  INVALID_STATE: 409,
  VENUE_UNAVAILABLE: 409,
  EVENT_FULL: 409,
  WAITLIST_FULL: 409,
  REGISTRATION_CLOSED: 409,
  MEMBERSHIP_REQUIRED: 409,
  ACTIVE_MEMBER_REGISTRATIONS: 409,
  COMMITTEE_MEMBERSHIP_PROTECTED: 409,
  PUBLISHED_FIELDS_FROZEN: 409,
  EVENT_STARTED: 409,
  EMAIL_IN_USE: 409,
  STUDENT_ID_IN_USE: 409,
  PRESIDENT_TRANSFER_REQUIRED: 409,
  API_VERSION_RETIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  DATABASE_UNAVAILABLE: 503,
  AUTH_BUSY: 503,
  TRANSACTION_RETRY_EXHAUSTED: 503,
};

class ApiError extends Error {
  constructor(code, message, { fields = {}, headers = {}, status } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code] ?? 500;
    this.fields = fields;
    this.headers = headers;
  }
}

function validation_error(fields, message = "Check the highlighted fields.") {
  return new ApiError("VALIDATION_FAILED", message, { fields });
}

export { ApiError, STATUS_BY_CODE, validation_error };
