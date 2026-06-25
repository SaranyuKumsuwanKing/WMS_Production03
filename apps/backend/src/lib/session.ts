import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./constants";

export const SESSION_COOKIE = "wms_session";

// Edge-safe session helpers (no next/headers, no bcrypt) so Next.js middleware
// can verify the session token without the Node runtime.

export type SessionUser = {
  userId: number;
  username: string;
  role: Role | string;
  fullName: string;
};

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return new TextEncoder().encode(secret);
}

export async function signToken(user: SessionUser, hours: number): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.userId === "number" &&
      typeof payload.username === "string" &&
      typeof payload.role === "string" &&
      typeof payload.fullName === "string"
    ) {
      return {
        userId: payload.userId,
        username: payload.username,
        role: payload.role,
        fullName: payload.fullName,
      };
    }
    return null;
  } catch {
    return null;
  }
}
