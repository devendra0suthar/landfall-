import { PrismaClient } from '@prisma/client';

/**
 * One client per process.
 *
 * `tsx watch` reloads this module on every save, and a fresh PrismaClient per
 * reload exhausts the connection pool within a minute of editing. Stashing it
 * on globalThis survives the reload; production gets a single instance anyway.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
