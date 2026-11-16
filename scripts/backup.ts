import { BackupOperationError, backupDatabase } from "../src/db/backup.ts";

const [sourceFile, backupDirectory, ...extra] = process.argv.slice(2);

if (!sourceFile || !backupDirectory || extra.length > 0) {
  console.error(
    JSON.stringify({
      status: "rejected",
      code: "USAGE",
      usage: "pnpm backup -- <absolute-database-file> <new-backup-directory>",
    }),
  );
  process.exitCode = 2;
} else {
  try {
    console.log(
      JSON.stringify(
        await backupDatabase(sourceFile, backupDirectory),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "rejected",
        operation: "backup",
        code:
          error instanceof BackupOperationError ? error.code : "BACKUP_FAILED",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  }
}
