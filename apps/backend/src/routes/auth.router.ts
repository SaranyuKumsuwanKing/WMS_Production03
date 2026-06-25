import { Router } from "express";
import { z } from "zod";
import { prisma } from "@king-wms/database";
import { verifyPassword, issueToken } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { AuthError } from "../lib/errors";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

authRouter.post(
  "/login",
  wrap(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { username: username.trim() },
    });
    const valid =
      user &&
      user.active &&
      (await verifyPassword(password, user.passwordHash));
    if (!user || !valid) throw new AuthError("Invalid username or password.");

    const token = await issueToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName,
    });
    return ok(res, {
      token,
      user: {
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    });
  }),
);

// Token auth is stateless: logout is the client dropping its token. This endpoint
// exists for symmetry/audit and always succeeds.
authRouter.post(
  "/logout",
  wrap(async (_req, res) => ok(res, { ok: true })),
);
