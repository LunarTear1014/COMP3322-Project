import { ApiError } from "../shared/errors.js";

function envelope(error, request_id) {
  return {
    error: {
      code: error.code,
      message: error.message,
      fields: error.fields || {},
      request_id: request_id ?? null,
    },
  };
}

function not_found_handler(_req, _res, next) {
  next(new ApiError("NOT_FOUND", "That resource does not exist."));
}

// Maps body-parser and database failures; never leaks internals.
function normalize(error) {
  if (error instanceof ApiError) return error;
  if (error?.type === "entity.parse.failed") {
    return new ApiError("INVALID_JSON", "The request body is not valid JSON.");
  }
  if (error?.type === "entity.too.large") {
    return new ApiError("PAYLOAD_TOO_LARGE", "The request body is too large.");
  }
  if (error?.type === "encoding.unsupported" || error?.type === "charset.unsupported") {
    return new ApiError("UNSUPPORTED_MEDIA_TYPE", "Use UTF-8 JSON.");
  }
  if (["ECONNREFUSED", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT"].includes(error?.code)) {
    return new ApiError("DATABASE_UNAVAILABLE", "The database is unavailable.");
  }
  return null;
}

function error_handler({ logger = console } = {}) {
  // Express identifies error middleware by its four-argument arity.
  return (error, req, res, _next) => {
    let api_error = normalize(error);
    if (!api_error) {
      logger.error(`[${req.request_id}] unexpected error`, error?.message);
      api_error = new ApiError("INTERNAL_ERROR", "Something went wrong. Try again.");
    }
    if (res.headersSent) return res.end();
    for (const [name, value] of Object.entries(api_error.headers)) {
      res.setHeader(name, value);
    }
    res.status(api_error.status).json(envelope(api_error, req.request_id));
  };
}

export { error_handler, not_found_handler, envelope };
