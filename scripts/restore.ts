import {
  BackupOperationError,
  preflightBackup,
  restoreDatabase,
} from "../src/db/backup.ts";

const args = process.argv.slice(2);

try {
  if (args.length === 2 && args[0] === "--check") {
    console.log(JSON.stringify(await preflightBackup(args[1]!), null, 2));
  } else if (args.length === 2) {
    console.log(
      JSON.stringify(await restoreDatabase(args[0]!, args[1]!), null, 2),
    );
  } else {
    console.error(
      JSON.stringify({
        status: "rejected",
        code: "USAGE",
        usage: [
          "pnpm restore -- --check <backup-directory>",
          "pnpm restore -- <backup-directory> <new-absolute-database-file>",
        ],
      }),
    );
    process.exitCode = 2;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      status: "rejected",
      operation: "restore",
      code:
        error instanceof BackupOperationError ? error.code : "RESTORE_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
