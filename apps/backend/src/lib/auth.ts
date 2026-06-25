import bcrypt from "bcryptjs";
import type { Request } from "express";
import { prisma } from "@king-wms/database";
import {
  signToken,
  verifyToken,
  SESSION_COOKIE,
  type SessionUser,
} from "./session";
import { AuthError, ForbiddenError } from "./errors";

export { SESSION_COOKIE };
export const SESSION_HOURS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Issue a signed session token for the given user. */
export async function issueToken(user: SessionUser): Promise<string> {
  return signToken(user, SESSION_HOURS);
}

/** Extract + verify the Bearer token from an Express request. */
export async function getSessionUser(
  req: Request,
): Promise<SessionUser | null> {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Resolve the current user for a route, re-validating against the DB so a
 * deactivated account is rejected immediately.
 */
export async function requireUser(req: Request): Promise<SessionUser> {
  const session = await getSessionUser(req);
  if (!session) throw new AuthError();
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) throw new AuthError("Account is inactive.");
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    fullName: user.fullName,
  };
}

export async function requireAdmin(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  if (user.role !== "ADMIN")
    throw new ForbiddenError("Administrator access required.");
  return user;
}

export type { SessionUser };
