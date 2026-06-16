import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

/**
 * Singleton Prisma client. In development, reuse across hot reloads to avoid
 * exhausting the connection pool.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProd ? ["error"] : ["warn", "error"],
  });

if (!env.isProd) {
  globalForPrisma.prisma = prisma;
}
