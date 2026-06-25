import { mkdirSync } from "fs";
import { prisma, ensureDbReady } from "@king-wms/database";

export function backupDir(): string {
  return (process.env.WMS_BACKUP_DIR || "C:/WMS/backups").replace(/\\/g, "/");
}

/**
 * Create a consistent SQLite snapshot via VACUUM INTO. The snapshot is a clean,
 * standalone .db file that is safe to copy off-box (e.g. into OneDrive) — unlike
 * the live database, which must never be copied while open.
 */
export async function runBackup(stamp: string): Promise<{ file: string }> {
  await ensureDbReady();
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/wms-${stamp}.db`;
  await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return { file };
}
