import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient singleton, created lazily and only when DATABASE_URL is set.
 * Returns null when persistence is unavailable so callers can fail honestly
 * (503) or fall back to non-persistent behavior instead of throwing at
 * construction time.
 */
const globalForPrisma = globalThis as unknown as { __mcPrisma?: PrismaClient };

export function createPrismaClient(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (!globalForPrisma.__mcPrisma) {
    globalForPrisma.__mcPrisma = new PrismaClient();
  }
  return globalForPrisma.__mcPrisma;
}

export type { PrismaClient };
