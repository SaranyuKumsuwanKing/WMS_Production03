// Domain errors. API routes map these to friendly messages + HTTP status codes.

export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, opts?: { status?: number; code?: string }) {
    super(message);
    this.name = "AppError";
    this.status = opts?.status ?? 400;
    this.code = opts?.code ?? "BAD_REQUEST";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, { status: 400, code: "VALIDATION" });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, { status: 404, code: "NOT_FOUND" });
    this.name = "NotFoundError";
  }
}

export class InsufficientStockError extends AppError {
  constructor(message: string) {
    super(message, { status: 409, code: "INSUFFICIENT_STOCK" });
    this.name = "InsufficientStockError";
  }
}

export class AuthError extends AppError {
  constructor(message = "Not authenticated") {
    super(message, { status: 401, code: "UNAUTHENTICATED" });
    this.name = "AuthError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not allowed") {
    super(message, { status: 403, code: "FORBIDDEN" });
    this.name = "ForbiddenError";
  }
}
