import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { env } from "./env.js";

/**
 * Claims embedded in the short-lived access token. We keep this lean: the
 * authoritative outlet assignments are loaded per-request from the DB by the
 * authorize middleware, so a revoked assignment takes effect immediately.
 */
export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
}

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: "peppernet",
  });

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: "peppernet",
  });
  return decoded as AccessTokenPayload;
};

/**
 * Refresh tokens are opaque random strings. We store only their SHA-256 hash in
 * the DB (RefreshToken.tokenHash), so a DB leak never exposes a usable token.
 * Rotation: every refresh issues a new token and revokes the old one.
 */
export const generateRefreshToken = (): { token: string; tokenHash: string } => {
  const token = crypto.randomBytes(48).toString("base64url");
  const tokenHash = hashToken(token);
  return { token, tokenHash };
};

export const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

export const refreshTokenExpiry = (): Date =>
  new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
