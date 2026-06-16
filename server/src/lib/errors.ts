/**
 * Typed application error with an HTTP status code. The global error handler
 * translates these into clean JSON responses.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const Unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", message);

export const Forbidden = (message = "You do not have permission to do that") =>
  new AppError(403, "FORBIDDEN", message);

export const NotFound = (message = "Resource not found") =>
  new AppError(404, "NOT_FOUND", message);

export const Conflict = (message: string) => new AppError(409, "CONFLICT", message);
