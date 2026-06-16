import type { UserRole } from "@prisma/client";

/**
 * The authenticated principal attached to every protected request.
 * `outletRoles` maps outletId -> effective role (assignment override or global
 * role), loaded fresh from the DB by the authenticate middleware.
 */
export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  outletRoles: Record<string, UserRole>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
