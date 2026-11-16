import { getLocalDatabasePath, openDatabase } from "../../db";
import { listMarketEvents } from "./repository";

export async function loadMarketEvents(databasePath = getLocalDatabasePath()) {
  const database = await openDatabase(databasePath);
  try {
    return listMarketEvents(database);
  } finally {
    database.client.close();
  }
}
