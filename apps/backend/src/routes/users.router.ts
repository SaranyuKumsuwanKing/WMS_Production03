import { Router } from "express";
import { z } from "zod";
import { prisma } from "@king-wms/database";
import { requireUser, requireAdmin, hashPassword } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { logAudit } from "../lib/audit";
import { NotFoundError, ValidationError } from "../lib/errors";
import { ROLES } from "../lib/constants";

export const usersRouter = Router();

usersRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireAdmin(req);
    const users = await prisma.user.findMany({
      orderBy: { username: "asc" },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });
    return ok(res, { users });
  }),
);

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, "Username: letters, numbers, . _ - only"),
  fullName: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(100),
});

usersRouter.post(
  "/",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const body = createSchema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        username: body.username.toLowerCase(),
        fullName: body.fullName,
        role: body.role,
        passwordHash: await hashPassword(body.password),
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        active: true,
      },
    });
    await logAudit({
      userId: admin.userId,
      action: "CREATE",
      entity: "User",
      entityId: user.id,
      detail: { username: user.username, role: user.role },
    });
    return ok(res, { user }, 201);
  }),
);

// Minimal user list (id + name) for filter dropdowns — any signed-in user.
// Registered BEFORE "/:id" so it is not captured by the param route.
usersRouter.get(
  "/options",
  wrap(async (req, res) => {
    await requireUser(req);
    const users = await prisma.user.findMany({
      where: { active: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    });
    return ok(res, { users });
  }),
);

const updateSchema = z.object({
  fullName: z.string().trim().min(1).max(80).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(100).optional(),
});

usersRouter.patch(
  "/:id",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const userId = Number(req.params.id);
    if (Number.isNaN(userId)) throw new ValidationError("Invalid user id.");
    const body = updateSchema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundError("User not found.");

    // Self-lockout guards.
    if (userId === admin.userId) {
      if (body.active === false)
        throw new ValidationError("You cannot deactivate your own account.");
      if (body.role && body.role !== "ADMIN")
        throw new ValidationError("You cannot remove your own admin role.");
    }
    // Keep at least one active admin.
    const losingAdmin =
      target.role === "ADMIN" &&
      ((body.role && body.role !== "ADMIN") || body.active === false);
    if (losingAdmin) {
      const otherAdmins = await prisma.user.count({
        where: { role: "ADMIN", active: true, id: { not: userId } },
      });
      if (otherAdmins === 0)
        throw new ValidationError(
          "There must be at least one active administrator.",
        );
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.password
          ? { passwordHash: await hashPassword(body.password) }
          : {}),
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        active: true,
      },
    });
    await logAudit({
      userId: admin.userId,
      action: body.password ? "RESET_PASSWORD" : "UPDATE",
      entity: "User",
      entityId: userId,
      detail: { ...body, password: body.password ? "***" : undefined },
    });
    return ok(res, { user });
  }),
);
