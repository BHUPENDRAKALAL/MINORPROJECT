import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";

/** Error body used by every route: { error: { code, message, details? } } */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Throw this from a handler to send a specific status and error code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, res) => {
  const body: ApiErrorBody = { error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } };
  res.status(404).json(body);
};

/** Last middleware: turns any thrown error into the standard error body. Express 5 forwards async errors here. */
export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ApiError) {
      const body: ApiErrorBody = { error: { code: err.code, message: err.message, details: err.details } };
      res.status(err.status).json(body);
      return;
    }
    // Bad JSON in the request body (from express.json()).
    if ((err as { type?: string }).type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "INVALID_JSON", message: "The request body is not valid JSON." } });
      return;
    }
    if ((err as { type?: string }).type === "entity.too.large") {
      res.status(413).json({ error: { code: "TOO_LARGE", message: "The request body is too large." } });
      return;
    }
    log.error({ err, reqId: req.id }, "unhandled error");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again." } });
  };
}
