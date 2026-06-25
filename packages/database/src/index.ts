import { PrismaClient, Prisma } from "./generated/client";

// Singleton Prisma client — shared by the API (and any other workspace consumer).
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// No per-connection bootstrap is needed on PostgreSQL (foreign keys are always
// enforced; there is no WAL/busy_timeout to set). Kept as a no-op so call sites
// stay unchanged. Concurrency safety for read-modify-write stock posts comes from
// running postMovement at Serializable isolation + the retry loop below.
export function ensureDbReady(): Promise<void> {
  return Promise.resolve();
}

function isRetryableConflict(err: unknown): boolean {
  // Prisma surfaces Postgres write conflicts/deadlocks as P2034; the raw SQLSTATEs
  // are 40001 (serialization_failure) and 40P01 (deadlock_detected).
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2034"
  )
    return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b40001\b|\b40P01\b|could not serialize|deadlock detected|write conflict/i.test(
    msg,
  );
}

/**
 * Run a database operation with a small retry loop for the rare write-conflict /
 * serialization failure when two operators post against the same row at once.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableConflict(err) || i === attempts - 1) throw err;
      // brief, increasing backoff (deterministic — no Math.random)
      await new Promise((r) => setTimeout(r, 25 * (i + 1)));
    }
  }
  throw lastErr;
}

export { Prisma };
export const Decimal = Prisma.Decimal;
export type DecimalValue = Prisma.Decimal;
export type { PrismaClient };
