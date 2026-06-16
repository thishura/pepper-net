import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { Forbidden, Unauthorized, BadRequest } from "../lib/errors.js";

/**
 * Role hierarchy used for "minimum role" checks within an outlet.
 * Higher number = more privilege.
 */
const ROLE_RANK: Record<UserRole, number> = {
  CASHIER: 1,
  CHEF: 1,
  OUTLET_MANAGER: 2,
  SUPER_ADMIN: 3,
};

const SUPER_ADMIN: UserRole = "SUPER_ADMIN";

/**
 * Global role gate. The user's GLOBAL role must be one of `allowed`.
 * Use for system-wide actions (e.g. creating outlets, managing users).
 */
export const requireRole =
  (...allowed: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) throw Unauthorized();
    if (req.auth.role === SUPER_ADMIN || allowed.includes(req.auth.role)) {
      return next();
    }
    throw Forbidden(`Requires one of: ${allowed.join(", ")}`);
  };

/**
 * Resolve the target outletId from params, body, or query (in that order).
 */
const resolveOutletId = (req: Request, key: string): string | undefined => {
  return (
    (req.params?.[key] as string | undefined) ??
    (req.body?.[key] as string | undefined) ??
    (req.query?.[key] as string | undefined)
  );
};

interface OutletAccessOptions {
  /** Where to read the outlet id from. Defaults to "outletId". */
  param?: string;
  /** Minimum effective role required *within that outlet*. */
  minRole?: UserRole;
}

/**
 * Outlet-scoped gate enforcing multi-tenancy. Confirms the authenticated user
 * is assigned to the requested outlet and (optionally) holds at least `minRole`
 * there. SUPER_ADMIN bypasses the assignment requirement entirely.
 */
export const requireOutletAccess =
  (options: OutletAccessOptions = {}) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) throw Unauthorized();

    const key = options.param ?? "outletId";
    const outletId = resolveOutletId(req, key);
    if (!outletId) {
      throw BadRequest(`Missing "${key}" to scope this request to an outlet`);
    }

    // SUPER_ADMIN has implicit access to every outlet.
    if (req.auth.role === SUPER_ADMIN) return next();

    const effectiveRole = req.auth.outletRoles[outletId];
    if (!effectiveRole) {
      throw Forbidden("You are not assigned to this outlet");
    }

    if (options.minRole && ROLE_RANK[effectiveRole] < ROLE_RANK[options.minRole]) {
      throw Forbidden(`Requires at least ${options.minRole} in this outlet`);
    }

    next();
  };

/**
 * Helper for use inside controllers: assert and return the effective role of
 * the current user within a given outlet (throws if unassigned).
 */
export const effectiveOutletRole = (req: Request, outletId: string): UserRole => {
  if (!req.auth) throw Unauthorized();
  if (req.auth.role === SUPER_ADMIN) return SUPER_ADMIN;
  const role = req.auth.outletRoles[outletId];
  if (!role) throw Forbidden("You are not assigned to this outlet");
  return role;
};
