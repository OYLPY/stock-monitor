import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openDatabase } from "./index";

export async function createTestDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "stock-monitor-test-"));
  const resolvedTempRoot = resolve(tmpdir());
  const resolvedDirectory = resolve(directory);
  if (!resolvedDirectory.startsWith(`${resolvedTempRoot}${sep}`)) {
    await rm(directory, { recursive: true, force: true });
    throw new Error("test_database_path_outside_temp_directory");
  }

  try {
    const filePath = join(directory, "test.sqlite");
    const database = await openDatabase(filePath);
    return {
      database,
      filePath,
      async cleanup() {
        if (database.client.open) database.client.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
