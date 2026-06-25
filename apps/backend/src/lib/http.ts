import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "./errors";

/** Standard success JSON response. */
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json(data as object);
}

/** Map thrown errors (AppError, ZodError, unexpected) to JSON responses. */
export function sendError(res: Response, err: unknown): Response {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path?.join(".");
    return res.status(400).json({
      error: `${path ? path + ": " : ""}${first?.message ?? "Invalid input."}`,
      code: "VALIDATION",
    });
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/Unique constraint failed/i.test(msg)) {
    return res
      .status(409)
      .json({ error: "That record already exists.", code: "DUPLICATE" });
  }
  console.error("[API error]", err);
  return res
    .status(500)
    .json({ error: "Something went wrong.", code: "INTERNAL" });
}

/** Wrap an async route handler so thrown errors become JSON error responses. */
export function wrap(
  fn: (req: Request, res: Response) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response): void => {
    Promise.resolve(fn(req, res)).catch((e) => sendError(res, e));
  };
}
