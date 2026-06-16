import type { Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} from "../../lib/jwt.js";
import { env } from "../../lib/env.js";
import { BadRequest, Conflict, Forbidden, Unauthorized } from "../../lib/errors.js";
import type { RegisterInput, LoginInput } from "./auth.schemas.js";

const REFRESH_COOKIE = "peppernet_rt";

const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/auth",
  maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
});

/** Issue a new refresh token, persist its hash, and set the cookie. */
const issueRefreshToken = async (res: Response, userId: string): Promise<void> => {
  const { token, tokenHash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt: refreshTokenExpiry() },
  });
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
};

const publicUser = (user: {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}) => ({ id: user.id, email: user.email, fullName: user.fullName, role: user.role });

/**
 * POST /auth/register
 * Public bootstrap: if no users exist, the first registration becomes the
 * SUPER_ADMIN. After that, only an authenticated SUPER_ADMIN may create users
 * or assign elevated roles.
 */
export const register = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as RegisterInput;

  const userCount = await prisma.user.count();
  const isBootstrap = userCount === 0;

  let role: UserRole = "CASHIER";
  if (isBootstrap) {
    role = "SUPER_ADMIN";
  } else {
    // Creating additional users requires SUPER_ADMIN.
    if (req.auth?.role !== "SUPER_ADMIN") {
      throw Forbidden("Only a SUPER_ADMIN can create new users");
    }
    if (input.role) role = input.role;
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw Conflict("A user with that email already exists");

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phone: input.phone,
      role,
      outletAssignments: input.outletIds?.length
        ? {
            create: input.outletIds.map((outletId) => ({ outletId })),
          }
        : undefined,
    },
  });

  res.status(201).json({ user: publicUser(user) });
};

/**
 * POST /auth/login
 * Verifies credentials, issues an access token (body) + rotating refresh token
 * (httpOnly cookie).
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as LoginInput;

  const user = await prisma.user.findUnique({ where: { email } });
  // Constant-ish response regardless of which check fails (avoid user enumeration).
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    throw Unauthorized("Invalid email or password");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await issueRefreshToken(res, user.id);
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  res.json({ accessToken, user: publicUser(user) });
};

/**
 * POST /auth/refresh
 * Validates the refresh cookie, ROTATES it (revoke old, issue new), and returns
 * a fresh access token. Reuse of a revoked token is rejected.
 */
export const refresh = async (req: Request, res: Response): Promise<void> => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!raw) throw Unauthorized("Missing refresh token");

  const tokenHash = hashToken(raw);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw Unauthorized("Refresh token is invalid or expired");
  }
  if (!stored.user.isActive) throw Unauthorized("Account is inactive");

  // Rotate: revoke the presented token, then issue a new one.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  await issueRefreshToken(res, stored.userId);

  const accessToken = signAccessToken({
    sub: stored.user.id,
    email: stored.user.email,
    role: stored.user.role,
  });

  res.json({ accessToken, user: publicUser(stored.user) });
};

/**
 * POST /auth/logout
 * Revokes the current refresh token and clears the cookie.
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (raw) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie(REFRESH_COOKIE, { path: "/auth" });
  res.json({ success: true });
};

/**
 * GET /auth/me
 * Returns the authenticated user plus their resolved per-outlet roles.
 */
export const me = async (req: Request, res: Response): Promise<void> => {
  if (!req.auth) throw Unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    include: {
      outletAssignments: {
        where: { isActive: true },
        include: { outlet: { select: { id: true, name: true, code: true } } },
      },
    },
  });
  if (!user) throw Unauthorized();

  res.json({
    user: publicUser(user),
    outlets: user.outletAssignments.map((a) => ({
      outletId: a.outlet.id,
      name: a.outlet.name,
      code: a.outlet.code,
      role: a.roleOverride ?? user.role,
    })),
  });
};
