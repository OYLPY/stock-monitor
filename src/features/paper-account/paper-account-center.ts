import { getLocalDatabasePath, openDatabase } from "../../db";
import { listPaperAccountLedger } from "../../db/paper-account-repository";

export type PaperLedgerSnapshot =
  | { state: "NOT_INITIALIZED" }
  | { state: "UNAVAILABLE" }
  | {
      state: "INITIALIZED";
      baseCurrency: string;
      initializedAtMs: string;
      entries: Array<{
        eventId: string;
        sequenceNo: string;
        eventType: string;
        effectiveAtMs: string;
        recordedAtMs: string;
        cashEntryId: string | null;
        bucket: string | null;
        currencyCode: string | null;
        currencyScale: number | null;
        amountMinor: string | null;
      }>;
    };

export async function loadPaperAccountLedger(
  databasePath = getLocalDatabasePath(),
): Promise<PaperLedgerSnapshot> {
  let database: Awaited<ReturnType<typeof openDatabase>> | undefined;
  try {
    database = await openDatabase(databasePath);
    const ledger = listPaperAccountLedger(database);
    if (!ledger) return { state: "NOT_INITIALIZED" };

    return {
      state: "INITIALIZED",
      baseCurrency: ledger.account.baseCurrency,
      initializedAtMs: String(ledger.account.initializedAtMs),
      entries: ledger.entries.map((entry) => ({
        ...entry,
        sequenceNo: String(entry.sequenceNo),
        effectiveAtMs: String(entry.effectiveAtMs),
        recordedAtMs: String(entry.recordedAtMs),
        amountMinor:
          entry.amountMinor === null ? null : String(entry.amountMinor),
      })),
    };
  } catch (error) {
    console.error("paper_account_ledger_read_failed", error);
    return { state: "UNAVAILABLE" };
  } finally {
    database?.client.close();
  }
}
