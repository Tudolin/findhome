-- Two more portals: Chaves na Mão and ImovelWeb.
--
-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction (which is how
-- Prisma runs a migration) as long as the new value is not USED in that same
-- transaction. Nothing below references them, so this is safe.

-- AlterEnum
ALTER TYPE "PropertySource" ADD VALUE IF NOT EXISTS 'CHAVES_NA_MAO';

-- AlterEnum
ALTER TYPE "PropertySource" ADD VALUE IF NOT EXISTS 'IMOVELWEB';
