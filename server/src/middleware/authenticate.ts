import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { Unauthorized } from "../lib/errors.js";
import { asyncHandler } from "../lib/async-handler.js";

/**
 * Verifies the Bearer access token, then loads the user's live outlet
 * assignments from the DB and attaches a fully-resolved AuthContext to the
 * request. Loading assignments per-request (rather than trusting token claims)
 * means revoked access takes effect immediately.
 */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw Unauthorized("Missing or malformed Authorization header");
    }

    const token = header.slice("Bearer ".length).trim();

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw Unauthorized("Invalid or expired access token");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        outletAssignments: {
          where: { isActive: true },
          select: { outletId: true, roleOverride: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw Unauthorized("Account is inactive or no longer exists");
    }

    // Build outletId -> effective role map (assignment override or global role).
    const outletRoles: Record<string, UserRole> = {};
    for (const assignment of user.outletAssignments) {
      outletRoles[assignment.outletId] = assignment.roleOverride ?? user.role;
    }

    req.auth = {
      userId: user.id,
      email: user.email,
      role: user.role,
      outletRoles,
    };

    next();
  },
);
