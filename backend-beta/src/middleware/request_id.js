import { randomUUID } from "node:crypto";

// Always generate the ID server-side; client-supplied values are not trusted.
function request_id() {
  return (req, res, next) => {
    req.request_id = `req-${randomUUID()}`;
    res.setHeader("X-Request-Id", req.request_id);
    next();
  };
}

export default request_id;
